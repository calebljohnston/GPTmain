// api.js — Anthropic API streaming client

import * as storage from './storage.js';
import { buildSystemPrompt } from './health-record.js';
import { TOOL_DEFINITIONS } from './tools.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export class ApiError extends Error {
  constructor(type, message, status) {
    super(message);
    this.type = type;
    this.status = status;
    this.name = 'ApiError';
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

export async function validateApiKey(apiKey) {
  const response = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new ApiError(
      err.error?.type || 'api_error',
      err.error?.message || `HTTP ${response.status}`,
      response.status
    );
  }
  return true;
}

// ── Streaming Chat ────────────────────────────────────────────────────────────

// Returns an async generator yielding parsed SSE event objects
export async function* streamChatCompletion(messages, config) {
  const systemPrompt = buildSystemPrompt();

  const body = {
    model: config.model || 'claude-opus-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    tools: TOOL_DEFINITIONS,
    messages,
    stream: true,
  };

  const response = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: buildHeaders(config.apiKey),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new ApiError(
      err.error?.type || 'api_error',
      err.error?.message || `HTTP ${response.status}`,
      response.status
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            yield data;
          } catch {
            // skip malformed SSE
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Tool Result Follow-up ────────────────────────────────────────────────────

// After tool confirmations are resolved, send the tool_result blocks back
// and get Claude's follow-up response
export async function* streamToolResults(messages, toolResultBlocks, config) {
  // Append the tool_result message to the conversation
  const messagesWithResults = [
    ...messages,
    { role: 'user', content: toolResultBlocks },
  ];

  yield* streamChatCompletion(messagesWithResults, config);
}

// ── Headers ──────────────────────────────────────────────────────────────────

function buildHeaders(apiKey) {
  return {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
    'content-type': 'application/json',
  };
}
