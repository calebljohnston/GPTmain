// server.js — Vita Telegram Bot
// Uses polling mode — no webhook, no ngrok needed in development.
//
// State machine per chat ID:
//   IDLE → (message) → PROCESSING → (no tools) → reply → IDLE
//                                 → (confirm tool) → "Reply YES/NO" → AWAITING_CONFIRMATION
//   AWAITING_CONFIRMATION → (YES/Y) → execute + follow-up → IDLE
//                         → (NO/N)  → decline + follow-up → IDLE
//                         → (other) → re-prompt → AWAITING_CONFIRMATION

'use strict';

require('dotenv').config({ override: true });

// Validate required env vars
const REQUIRED_ENV = ['ANTHROPIC_API_KEY', 'TELEGRAM_BOT_TOKEN'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`ERROR: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const db = require('./lib/db');
const { runClaudeTurn, resumeAfterConfirmation } = require('./lib/anthropic');
const { setBot, sendMessage } = require('./lib/telegram');
const { initReminders } = require('./lib/reminders');

// ── Startup: reset any sessions stuck in PROCESSING from a previous crash ─────

db.resetStuckProcessingStates();

// ── Telegram bot (polling) ────────────────────────────────────────────────────

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
setBot(bot); // share the instance with lib/telegram.js

console.log('[bot] Telegram bot started (polling mode)');

// How long (ms) before a PROCESSING state is considered stuck and auto-reset
const PROCESSING_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

bot.on('message', async (msg) => {
  // Only handle text messages
  if (!msg.text) return;

  const chatId = String(msg.chat.id);
  const text = msg.text.trim();

  console.log(`[bot] Message from ${chatId}: "${text.slice(0, 80)}"`);

  let state = db.getSessionState(chatId);

  // Auto-reset if stuck in PROCESSING for too long (e.g. after a crash)
  if (state === 'PROCESSING') {
    const age = db.getSessionAge(chatId);
    if (age > PROCESSING_TIMEOUT_MS) {
      console.warn(`[bot] PROCESSING state for ${chatId} is ${Math.round(age / 1000)}s old — auto-resetting to IDLE`);
      db.setSessionState(chatId, 'IDLE');
      state = 'IDLE';
    }
  }

  if (state === 'AWAITING_CONFIRMATION') {
    await handleConfirmationReply(chatId, text);
  } else if (state === 'PROCESSING') {
    // Still within the timeout window — genuinely processing
    console.warn(`[bot] Message from ${chatId} while PROCESSING — ignoring`);
  } else {
    await handleInboundMessage(chatId, text);
  }
});

bot.on('polling_error', (err) => {
  console.error('[bot] Polling error:', err.message);
});

// ── Typing indicator helper ───────────────────────────────────────────────────

// Shows "Vita is typing..." in Telegram while waiting for Claude.
// Telegram hides it after ~5s, so we repeat every 4s until stopped.
function startTyping(chatId) {
  bot.sendChatAction(chatId, 'typing').catch(() => {});
  const interval = setInterval(() => {
    bot.sendChatAction(chatId, 'typing').catch(() => {});
  }, 4000);
  return interval; // caller must clearInterval() when done
}

// ── Handle normal inbound messages ────────────────────────────────────────────

async function handleInboundMessage(chatId, text) {
  db.setSessionState(chatId, 'PROCESSING');
  const typingInterval = startTyping(chatId);

  try {
    const result = await runClaudeTurn(chatId, text, db);
    clearInterval(typingInterval);

    if (result.type === 'text') {
      await sendMessage(chatId, result.text);
      db.setSessionState(chatId, 'IDLE');

    } else if (result.type === 'awaiting_confirmation') {
      const prefix = result.prefix ? `${result.prefix}\n` : '';
      const confirmMsg =
        `${prefix}` +
        `Vita wants to: ${result.summary}\n\n` +
        `Reply YES to confirm or NO to skip.`;
      await sendMessage(chatId, confirmMsg);
      db.setSessionState(chatId, 'AWAITING_CONFIRMATION');
    }

  } catch (err) {
    clearInterval(typingInterval);
    console.error(`[bot] Error processing message from ${chatId}:`, err);
    db.setSessionState(chatId, 'IDLE');
    try {
      await sendMessage(chatId, 'Sorry, something went wrong. Please try again in a moment.');
    } catch (sendErr) {
      console.error(`[bot] Also failed to send error message to ${chatId}:`, sendErr.message);
    }
  }
}

// ── Handle YES/NO confirmation replies ────────────────────────────────────────

async function handleConfirmationReply(chatId, text) {
  const pending = db.getPendingConfirmation(chatId);

  // No pending confirmation — treat as a new message
  if (!pending) {
    db.setSessionState(chatId, 'IDLE');
    await handleInboundMessage(chatId, text);
    return;
  }

  // Check expiry (10 minute window)
  if (new Date() > new Date(pending.expiresAt)) {
    db.deletePendingConfirmation(chatId);
    db.setSessionState(chatId, 'IDLE');
    await sendMessage(
      chatId,
      'That confirmation request expired (10 minute limit). What else can I help you with?'
    );
    return;
  }

  const normalized = text.toUpperCase().trim();
  const isYes = normalized === 'YES' || normalized === 'Y';
  const isNo = normalized === 'NO' || normalized === 'N';

  if (!isYes && !isNo) {
    await sendMessage(
      chatId,
      `Please reply YES to confirm or NO to skip.\n\nPending: ${pending.summary}`
    );
    return;
  }

  db.setSessionState(chatId, 'PROCESSING');
  const typingInterval = startTyping(chatId);

  try {
    const result = await resumeAfterConfirmation(chatId, isYes, db);
    clearInterval(typingInterval);

    if (result.type === 'text') {
      await sendMessage(chatId, result.text);
      db.setSessionState(chatId, 'IDLE');

    } else if (result.type === 'awaiting_confirmation') {
      const prefix = result.prefix ? `${result.prefix}\n` : '';
      const confirmMsg =
        `${prefix}` +
        `Vita wants to: ${result.summary}\n\n` +
        `Reply YES to confirm or NO to skip.`;
      await sendMessage(chatId, confirmMsg);
      db.setSessionState(chatId, 'AWAITING_CONFIRMATION');
    }

  } catch (err) {
    clearInterval(typingInterval);
    console.error(`[bot] Error resuming after confirmation for ${chatId}:`, err);
    db.deletePendingConfirmation(chatId);
    db.setSessionState(chatId, 'IDLE');
    try {
      await sendMessage(chatId, 'Sorry, something went wrong continuing the conversation. Please try again.');
    } catch (sendErr) {
      console.error(`[bot] Also failed to send error message to ${chatId}:`, sendErr.message);
    }
  }
}

// ── Health check endpoint ─────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.listen(PORT, () => console.log(`[server] Health check endpoint on port ${PORT}`));

// ── Start reminders ───────────────────────────────────────────────────────────

initReminders(db);
