// anthropic.js — Non-streaming Claude API loop with tool handling
// Mirrors chat.js handleToolCalls() / runStreamTurn() from the browser app
// but uses synchronous request/response instead of streaming.

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { buildSystemPrompt, TOOL_DEFINITIONS, requiresConfirmation, executeTool } = require('./vita-core');

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS       = 1024;
const MAX_TOKENS_MEDIA = 2048; // extra headroom for image/document analysis

// Lazy-initialized client
let _client = null;
function getClient() {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Run a complete Claude turn for an inbound SMS message.
 *
 * Returns either:
 *   { type: 'text', text: string }
 *   { type: 'awaiting_confirmation', summary: string }
 */
async function runClaudeTurn(phone, userText, db) {
  // 0. Ensure default program goals are seeded (idempotent — skips if already done)
  db.ensureDefaultGoals(phone);

  // 1. Persist the incoming user message
  db.appendMessage(phone, { role: 'user', content: userText });

  // 2. Build history + system prompt
  const messages = db.getApiMessages(phone);
  const systemPrompt = buildSystemPrompt(phone, db);

  // 3. Call Claude (non-streaming)
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    tools: TOOL_DEFINITIONS,
    messages,
  }, { timeout: 75_000 });

  // 4. Extract text and tool calls from response
  const textBlocks = response.content.filter((b) => b.type === 'text');
  const toolCalls = response.content.filter((b) => b.type === 'tool_use');
  const assistantText = textBlocks.map((b) => b.text).join('\n').trim();

  // 5. Persist assistant turn (text + any tool_use blocks)
  const toolBlocks = toolCalls.length > 0
    ? response.content.map((b) => {
        if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
        return { type: 'text', text: b.text || '' };
      })
    : null;

  db.appendMessage(phone, {
    role: 'assistant',
    content: assistantText,
    toolBlocks,
  });

  // 6. If no tool calls — return the text response directly
  if (toolCalls.length === 0) {
    return { type: 'text', text: stripMarkdown(assistantText) };
  }

  // 7. Auto-execute no-confirmation tools immediately
  const resolvedResults = [];
  const confirmTools = [];

  for (const tc of toolCalls) {
    if (!requiresConfirmation(tc.name)) {
      try {
        const data = executeTool(tc.name, tc.input, phone, db);
        resolvedResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: JSON.stringify(data ?? { success: true }),
        });
      } catch (e) {
        resolvedResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: JSON.stringify({ error: e.message }),
          is_error: true,
        });
      }
    } else {
      confirmTools.push(tc);
    }
  }

  // 8. If there are confirmation-required tools, queue the first one
  if (confirmTools.length > 0) {
    const firstConfirm = confirmTools[0];

    // Save the full tool call list — needed to resolve all results when YES/NO arrives
    db.savePendingConfirmation(phone, {
      toolUseId: firstConfirm.id,
      toolName: firstConfirm.name,
      toolInput: firstConfirm.input,
      summary: firstConfirm.input?.human_readable_summary || 'Update health data',
      allToolCalls: toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        input: tc.input,
        autoResolved: !requiresConfirmation(tc.name),
        resolvedResult: resolvedResults.find((r) => r.tool_use_id === tc.id) || null,
      })),
    });

    // If there was assistant text before the tool call, prepend it to the confirmation
    const prefix = assistantText ? `${stripMarkdown(assistantText)}\n\n` : '';
    return {
      type: 'awaiting_confirmation',
      summary: firstConfirm.input?.human_readable_summary || 'Update health data',
      prefix,
    };
  }

  // 9. All tools were auto-executed — persist tool_result message and continue
  db.appendMessage(phone, { role: 'user', content: resolvedResults });
  return followUpTurn(phone, db);
}

/**
 * Run a Claude turn that includes an image or PDF attachment.
 * The media block lives in memory only — conversation history stores a text placeholder.
 *
 * @param {string} phone
 * @param {{ base64: string, mimeType: string, isDocument: boolean, fileName: string|null }} mediaPayload
 * @param {string|null} caption   — optional user-supplied caption
 * @param {object} db
 * @returns {Promise<{ type: 'text'|'awaiting_confirmation', ... }>}
 */
async function runClaudeMediaTurn(phone, mediaPayload, caption, db) {
  const { base64, mimeType, isDocument, fileName } = mediaPayload;

  // 1. Build in-memory media block (never written to disk)
  const mediaBlock = isDocument
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image',    source: { type: 'base64', media_type: mimeType, data: base64 } };

  const fileLabel = fileName || mimeType;
  const mediaKind = isDocument ? 'document' : 'photo';

  const textPart = caption
    ? `The user sent a ${mediaKind} with caption: "${caption}". Please analyze it for health-relevant information and call process_health_document with whatever you can extract.`
    : `The user sent a ${mediaKind}. Please analyze it for health-relevant information and call process_health_document with whatever you can extract.`;

  // 2. Persist text placeholder to conversation history (no base64)
  const placeholder = caption
    ? `[User sent ${mediaKind}: ${fileLabel}] Caption: "${caption}"`
    : `[User sent ${mediaKind}: ${fileLabel}]`;
  db.appendMessage(phone, { role: 'user', content: placeholder });

  // 3. Build API messages: full history (with placeholder) → drop placeholder → insert real media block
  const historyMessages = db.getApiMessages(phone);
  const apiMessages = [
    ...historyMessages.slice(0, -1),  // drop the just-appended placeholder from the end
    { role: 'user', content: [mediaBlock, { type: 'text', text: textPart }] },
  ];

  // 4. Call Claude with higher token limit; PDFs require the beta header
  const requestOptions = {
    model: MODEL,
    max_tokens: MAX_TOKENS_MEDIA,
    system: buildSystemPrompt(phone, db),
    tools: TOOL_DEFINITIONS,
    messages: apiMessages,
  };
  if (isDocument) requestOptions.betas = ['pdfs-2024-09-25'];

  const response = await getClient().messages.create(requestOptions, { timeout: 75_000 });

  // 5–9. Identical to runClaudeTurn from here
  const textBlocks = response.content.filter((b) => b.type === 'text');
  const toolCalls  = response.content.filter((b) => b.type === 'tool_use');
  const assistantText = textBlocks.map((b) => b.text).join('\n').trim();

  const toolBlocks = toolCalls.length > 0
    ? response.content.map((b) => {
        if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
        return { type: 'text', text: b.text || '' };
      })
    : null;

  db.appendMessage(phone, { role: 'assistant', content: assistantText, toolBlocks });

  if (toolCalls.length === 0) {
    return { type: 'text', text: stripMarkdown(assistantText) };
  }

  const resolvedResults = [];
  const confirmTools   = [];

  for (const tc of toolCalls) {
    if (!requiresConfirmation(tc.name)) {
      try {
        const data = executeTool(tc.name, tc.input, phone, db);
        resolvedResults.push({
          type: 'tool_result', tool_use_id: tc.id,
          content: JSON.stringify(data ?? { success: true }),
        });
      } catch (e) {
        resolvedResults.push({
          type: 'tool_result', tool_use_id: tc.id,
          content: JSON.stringify({ error: e.message }), is_error: true,
        });
      }
    } else {
      confirmTools.push(tc);
    }
  }

  if (confirmTools.length > 0) {
    const firstConfirm = confirmTools[0];
    db.savePendingConfirmation(phone, {
      toolUseId: firstConfirm.id,
      toolName:  firstConfirm.name,
      toolInput: firstConfirm.input,
      summary:   firstConfirm.input?.human_readable_summary || 'Save extracted health data',
      allToolCalls: toolCalls.map((tc) => ({
        id: tc.id, name: tc.name, input: tc.input,
        autoResolved: !requiresConfirmation(tc.name),
        resolvedResult: resolvedResults.find((r) => r.tool_use_id === tc.id) || null,
      })),
    });

    const prefix = assistantText ? `${stripMarkdown(assistantText)}\n\n` : '';
    return {
      type: 'awaiting_confirmation',
      summary: firstConfirm.input?.human_readable_summary || 'Save extracted health data',
      prefix,
    };
  }

  db.appendMessage(phone, { role: 'user', content: resolvedResults });
  return followUpTurn(phone, db);
}

/**
 * Resume after the user replied YES or NO to a confirmation prompt.
 * Resolves all pending tool calls and runs a follow-up Claude turn.
 *
 * Returns { type: 'text', text: string }
 */
async function resumeAfterConfirmation(phone, confirmed, db) {
  const pending = db.getPendingConfirmation(phone);
  if (!pending) {
    throw new Error('No pending confirmation found');
  }

  const resolvedResults = [];

  for (const tc of pending.allToolCalls) {
    // If already auto-resolved (no-confirm tool), reuse the stored result
    if (tc.autoResolved && tc.resolvedResult) {
      resolvedResults.push(tc.resolvedResult);
      continue;
    }

    // This is the confirmation-required tool
    if (tc.id === pending.toolUseId) {
      if (confirmed) {
        try {
          const data = executeTool(tc.name, tc.input, phone, db);
          resolvedResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: JSON.stringify(data ?? { success: true }),
          });
        } catch (e) {
          resolvedResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: JSON.stringify({ error: e.message }),
            is_error: true,
          });
        }
      } else {
        resolvedResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: JSON.stringify({ declined: true, reason: 'User declined via SMS' }),
        });
      }
      continue;
    }

    // Any other confirmation-required tool in the same turn — auto-decline
    // (SMS can only handle one YES/NO prompt at a time)
    if (requiresConfirmation(tc.name)) {
      resolvedResults.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: JSON.stringify({ declined: true, reason: 'Auto-declined (only one confirmation per turn)' }),
      });
    }
  }

  // Clean up pending confirmation
  db.deletePendingConfirmation(phone);

  // THE CRITICAL STEP: persist tool_result user message before follow-up
  // Without this, the next Claude call sees tool_use blocks with no tool_result,
  // causing the "tool_use ids found without tool_result blocks" API error.
  db.appendMessage(phone, { role: 'user', content: resolvedResults });

  return followUpTurn(phone, db);
}

/**
 * Internal: run a follow-up Claude turn after tool results are saved.
 * Claude uses the tool results to formulate its final response.
 */
async function followUpTurn(phone, db) {
  const messages = db.getApiMessages(phone);
  const systemPrompt = buildSystemPrompt(phone, db);

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    tools: TOOL_DEFINITIONS,
    messages,
  }, { timeout: 75_000 });

  const textBlocks = response.content.filter((b) => b.type === 'text');
  const toolCalls = response.content.filter((b) => b.type === 'tool_use');
  const assistantText = textBlocks.map((b) => b.text).join('\n').trim();

  // Persist follow-up assistant message
  const toolBlocks = toolCalls.length > 0
    ? response.content.map((b) => {
        if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
        return { type: 'text', text: b.text || '' };
      })
    : null;

  db.appendMessage(phone, {
    role: 'assistant',
    content: assistantText,
    toolBlocks,
  });

  // If Claude is calling more tools in this follow-up, handle them too
  // (rare, but possible — e.g. get_health_summary after recording a weight)
  if (toolCalls.length > 0) {
    const autoResults = [];
    const confirmTools = [];

    for (const tc of toolCalls) {
      if (!requiresConfirmation(tc.name)) {
        try {
          const data = executeTool(tc.name, tc.input, phone, db);
          autoResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: JSON.stringify(data ?? { success: true }),
          });
        } catch (e) {
          autoResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: JSON.stringify({ error: e.message }),
            is_error: true,
          });
        }
      } else {
        confirmTools.push(tc);
      }
    }

    if (confirmTools.length > 0) {
      // Rare — queue the new confirmation and surface it
      const firstConfirm = confirmTools[0];
      db.savePendingConfirmation(phone, {
        toolUseId: firstConfirm.id,
        toolName: firstConfirm.name,
        toolInput: firstConfirm.input,
        summary: firstConfirm.input?.human_readable_summary || 'Update health data',
        allToolCalls: toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          input: tc.input,
          autoResolved: !requiresConfirmation(tc.name),
          resolvedResult: autoResults.find((r) => r.tool_use_id === tc.id) || null,
        })),
      });

      const prefix = assistantText ? `${stripMarkdown(assistantText)}\n\n` : '';
      return {
        type: 'awaiting_confirmation',
        summary: firstConfirm.input?.human_readable_summary || 'Update health data',
        prefix,
      };
    }

    // All auto-execute — persist and get final response
    db.appendMessage(phone, { role: 'user', content: autoResults });
    return followUpTurn(phone, db);
  }

  return { type: 'text', text: stripMarkdown(assistantText) };
}

// ── Markdown Stripping ────────────────────────────────────────────────────────

function stripMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/#{1,6}\s+/g, '')        // Remove headers
    .replace(/\*\*(.+?)\*\*/g, '$1')  // Bold
    .replace(/\*(.+?)\*/g, '$1')      // Italic
    .replace(/`(.+?)`/g, '$1')        // Inline code
    .replace(/^[*-]\s+/gm, '')        // Bullet points
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // Links
    .replace(/\n{3,}/g, '\n\n')       // Collapse excess newlines
    .trim();
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { runClaudeTurn, runClaudeMediaTurn, resumeAfterConfirmation };
