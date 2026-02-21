// chat.js — Stream handler, message rendering, and confirmation card flow

import * as storage from './storage.js';
import { streamChatCompletion, ApiError } from './api.js';
import { requiresConfirmation, executeTool, getToolIcon, getToolLabel } from './tools.js';
import { renderHealthSidebar, renderGoalsPanel, showToast, escHtml } from './ui.js';

// ── State ────────────────────────────────────────────────────────────────────

let isStreaming = false;

// ── Public API ───────────────────────────────────────────────────────────────

export function initChat() {
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || isStreaming) return;
    input.value = '';
    autoResize(input);
    sendMessage(text);
  });

  input?.addEventListener('input', () => autoResize(input));
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.dispatchEvent(new Event('submit'));
    }
  });

  window.addEventListener('vita:reminderActivated', (e) => {
    const { reminder } = e.detail;
    const prompt = `My reminder for "${reminder.title}" just went off. How am I doing?`;
    if (!isStreaming) sendMessage(prompt);
  });

  loadConversationHistory();
}

export async function sendMessage(text) {
  if (isStreaming) return;

  const config = storage.getConfig();
  if (!config?.apiKey) {
    showToast('No API key configured. Please check Settings.', 'error');
    return;
  }

  storage.appendMessage({ role: 'user', content: text });
  appendMessageBubble('user', text);
  scrollToBottom();

  await runStreamTurn(config);
}

// ── Core streaming turn — used for both initial and follow-up turns ───────────

async function runStreamTurn(config) {
  isStreaming = true;
  setInputLocked(true);

  const bubble = appendMessageBubble('assistant', '', true);
  let text = '';
  let currentBlock = null;
  const blocks = []; // all content blocks (text + tool_use)

  try {
    const stream = streamChatCompletion(storage.getApiMessages(), config);

    for await (const event of stream) {

      // ── Block start ──
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'text') {
          currentBlock = { type: 'text', text: '' };
          blocks.push(currentBlock);
        } else if (event.content_block.type === 'tool_use') {
          currentBlock = {
            type: 'tool_use',
            id: event.content_block.id,
            name: event.content_block.name,
            inputJson: '',
            input: null,
          };
          blocks.push(currentBlock);
        }
      }

      // ── Block delta ──
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta' && currentBlock?.type === 'text') {
          currentBlock.text += event.delta.text;
          text += event.delta.text;
          updateStreamingBubble(bubble, text);
        } else if (event.delta.type === 'input_json_delta' && currentBlock?.type === 'tool_use') {
          currentBlock.inputJson += event.delta.partial_json;
        }
      }

      // ── Block stop ──
      if (event.type === 'content_block_stop' && currentBlock?.type === 'tool_use') {
        try {
          currentBlock.input = JSON.parse(currentBlock.inputJson || '{}');
        } catch {
          currentBlock.input = {};
        }
        currentBlock = null;
      }

      // ── Message stop ──
      if (event.type === 'message_stop') {
        finalizeStreamingBubble(bubble, text);

        // Save assistant turn to storage (text + all tool_use blocks)
        const toolBlocks = blocks.map((b) =>
          b.type === 'tool_use'
            ? { type: 'tool_use', id: b.id, name: b.name, input: b.input }
            : { type: 'text', text: b.text }
        );
        storage.appendMessage({ role: 'assistant', content: text, toolBlocks });

        const toolCalls = blocks.filter((b) => b.type === 'tool_use');
        if (toolCalls.length > 0) {
          // Must resolve ALL tool calls and send results before unlocking
          await handleToolCalls(toolCalls, config);
        } else {
          isStreaming = false;
          setInputLocked(false);
        }
      }
    }
  } catch (e) {
    isStreaming = false;
    setInputLocked(false);
    bubble.remove();
    if (e instanceof ApiError && e.status === 401) {
      appendErrorBubble('Invalid API key. Click ⚙️ Settings to update it.');
    } else if (e instanceof ApiError) {
      appendErrorBubble(`API error: ${e.message}`);
    } else {
      appendErrorBubble('Something went wrong. Please try again.');
      console.error(e);
    }
  }
}

// ── Tool handling — collects results for ALL tools, saves to storage ──────────
// This is the critical fix: tool_result messages MUST be saved so that
// getApiMessages() returns a valid conversation on subsequent turns.

async function handleToolCalls(toolCalls, config) {
  const resolvedResults = [];

  // Auto-execute no-confirmation tools immediately
  for (const tc of toolCalls.filter((t) => !requiresConfirmation(t.name))) {
    try {
      const data = executeTool(tc.name, tc.input);
      resolvedResults.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: JSON.stringify(data ?? { success: true }),
      });
      renderHealthSidebar();
      renderGoalsPanel();
    } catch (e) {
      resolvedResults.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: JSON.stringify({ error: e.message }),
        is_error: true,
      });
    }
  }

  // Show confirmation cards for tools that require user approval
  const confirmTools = toolCalls.filter((t) => requiresConfirmation(t.name));
  if (confirmTools.length > 0) {
    setInputLocked(true, 'Waiting for your confirmation...');
    for (const tc of confirmTools) {
      const result = await renderConfirmationCard(tc);
      resolvedResults.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: result.confirmed
          ? JSON.stringify(result.data ?? { success: true })
          : JSON.stringify({ declined: true, reason: 'User declined' }),
      });
      if (result.confirmed) {
        renderHealthSidebar();
        renderGoalsPanel();
      }
    }
  }

  // *** THE FIX: persist tool_result message to storage ***
  // Without this, the next user turn sends tool_use blocks with no matching
  // tool_result blocks, causing the "tool_use ids found without tool_result" error.
  storage.appendMessage({ role: 'user', content: resolvedResults });

  // Stream Claude's follow-up response (it needs the tool results to continue)
  await runStreamTurn(config);
}

// ── Confirmation Card ────────────────────────────────────────────────────────

function renderConfirmationCard(toolCall) {
  return new Promise((resolve) => {
    const icon = getToolIcon(toolCall.name, toolCall.input);
    const label = getToolLabel(toolCall.name);
    const summary = toolCall.input?.human_readable_summary || 'Update health data';

    const card = document.createElement('div');
    card.className = 'confirmation-card';
    card.innerHTML = `
      <div class="conf-header">
        <span class="conf-icon">${icon}</span>
        <div class="conf-info">
          <div class="conf-label">Vita wants to ${escHtml(label.toLowerCase())}</div>
          <div class="conf-summary">${escHtml(summary)}</div>
        </div>
      </div>
      <div class="conf-actions">
        <button class="btn-confirm">Confirm</button>
        <button class="btn-deny">Deny</button>
      </div>
    `;

    document.getElementById('chat-thread').appendChild(card);
    scrollToBottom();

    const expire = setTimeout(() => {
      card.classList.add('conf-card--expired');
      card.querySelector('.conf-actions').innerHTML =
        '<span class="conf-status conf-status--deny">Expired — not saved</span>';
      resolve({ confirmed: false, data: null });
    }, 5 * 60 * 1000);

    card.querySelector('.btn-confirm').addEventListener('click', () => {
      clearTimeout(expire);
      try {
        const data = executeTool(toolCall.name, toolCall.input);
        card.classList.add('conf-card--confirmed');
        card.querySelector('.conf-actions').innerHTML =
          '<span class="conf-status conf-status--ok">✓ Confirmed</span>';
        showToast('Health record updated!', 'success');
        resolve({ confirmed: true, data });
      } catch (e) {
        card.classList.add('conf-card--error');
        card.querySelector('.conf-actions').innerHTML =
          `<span class="conf-status conf-status--err">Error: ${escHtml(e.message)}</span>`;
        resolve({ confirmed: false, data: null });
      }
    });

    card.querySelector('.btn-deny').addEventListener('click', () => {
      clearTimeout(expire);
      card.classList.add('conf-card--denied');
      card.querySelector('.conf-actions').innerHTML =
        '<span class="conf-status conf-status--deny">✗ Denied</span>';
      resolve({ confirmed: false, data: null });
    });
  });
}

// ── Message Rendering ────────────────────────────────────────────────────────

function appendMessageBubble(role, text, streaming = false) {
  const thread = document.getElementById('chat-thread');
  const wrapper = document.createElement('div');
  wrapper.className = `message message--${role}`;

  if (role === 'assistant') {
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = '💚';
    wrapper.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  const content = document.createElement('div');
  content.className = 'message-content';
  content.innerHTML = streaming
    ? '<span class="streaming-cursor"></span>'
    : renderMarkdown(text);
  bubble.appendChild(content);
  wrapper.appendChild(bubble);
  thread.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function updateStreamingBubble(wrapper, text) {
  const content = wrapper.querySelector('.message-content');
  if (content) {
    content.innerHTML = renderMarkdown(text) + '<span class="streaming-cursor"></span>';
    scrollToBottom();
  }
}

function finalizeStreamingBubble(wrapper, text) {
  const content = wrapper.querySelector('.message-content');
  if (content) content.innerHTML = renderMarkdown(text);
}

function appendErrorBubble(text) {
  const el = document.createElement('div');
  el.className = 'message message--error';
  el.innerHTML = `<div class="message-bubble"><div class="message-content">⚠️ ${escHtml(text)}</div></div>`;
  document.getElementById('chat-thread').appendChild(el);
  scrollToBottom();
}

// ── Conversation History ─────────────────────────────────────────────────────

function loadConversationHistory() {
  const session = storage.getCurrentSession();
  if (!session || session.messages.length === 0) {
    showWelcomeMessage();
    return;
  }

  session.messages.forEach((msg) => {
    // Skip tool_result messages (array content) — they have no visible UI
    if (msg.role === 'user' && Array.isArray(msg.content)) return;
    if (msg.role === 'user' || msg.role === 'assistant') {
      if (msg.content) appendMessageBubble(msg.role, msg.content);
    }
  });
  scrollToBottom();
}

function showWelcomeMessage() {
  const name = storage.getHealthRecord().demographics?.name;
  const greeting = name ? `Hi ${name}!` : 'Hi there!';

  const welcomeText = `${greeting} I'm Vita, your personal health coach. 👋

I'm here to help you:
- **Track** your health metrics and build your personal health record
- **Set** meaningful health goals and celebrate your progress
- **Stay consistent** with healthy habits through reminders
- **Learn** about your health patterns over time

Everything you share with me is stored privately on your device. I'll always ask for your confirmation before saving anything.

What's on your mind today?`;

  appendMessageBubble('assistant', welcomeText);
  storage.appendMessage({ role: 'assistant', content: welcomeText });
}

// ── Utilities ────────────────────────────────────────────────────────────────

function setInputLocked(locked, placeholder = '') {
  const input = document.getElementById('chat-input');
  const btn = document.getElementById('btn-send');
  if (input) {
    input.disabled = locked;
    input.placeholder = placeholder || 'Tell Vita something about your health...';
  }
  if (btn) btn.disabled = locked;
}

function scrollToBottom() {
  const thread = document.getElementById('chat-thread');
  if (thread) thread.scrollTop = thread.scrollHeight;
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>(\n|$))+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n/g, '<br>');
}
