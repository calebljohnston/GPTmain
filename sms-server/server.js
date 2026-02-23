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
const { runClaudeTurn, runClaudeMediaTurn, resumeAfterConfirmation } = require('./lib/anthropic');
const { setBot, sendMessage } = require('./lib/telegram');
const { prepareMediaForAnalysis } = require('./lib/media');
const { initReminders } = require('./lib/reminders');

// ── Startup: reset any sessions stuck in PROCESSING from a previous crash ─────

db.resetStuckProcessingStates();

// ── Startup: seed default program goals for all existing users ────────────────
// Idempotent — skips any user who already has system goals seeded.
// Runs before polling begins so goals are present before the first message.
try {
  const existingPhones = db.getAllHealthRecordPhones();
  for (const phone of existingPhones) {
    db.ensureDefaultGoals(phone);
  }
  if (existingPhones.length > 0) {
    console.log(`[db] Ensured default program goals for ${existingPhones.length} existing user(s)`);
  }
} catch (err) {
  console.error('[db] Error seeding default goals on startup:', err.message);
}

// ── Telegram bot (polling) ────────────────────────────────────────────────────

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
setBot(bot); // share the instance with lib/telegram.js

console.log('[bot] Telegram bot started (polling mode)');

// How long (ms) before a PROCESSING state is considered stuck and auto-reset
const PROCESSING_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

bot.on('message', async (msg) => {
  const isText     = Boolean(msg.text);
  const isPhoto    = Boolean(msg.photo);
  const isDocument = Boolean(msg.document);

  // Ignore stickers, voice messages, etc.
  if (!isText && !isPhoto && !isDocument) return;

  const chatId = String(msg.chat.id);
  const text   = msg.text ? msg.text.trim() : null;

  console.log(
    `[bot] Message from ${chatId}: ` +
    (isPhoto    ? '[photo]' :
     isDocument ? `[document: ${msg.document?.mime_type || 'unknown'}]` :
     `"${text.slice(0, 80)}"`)
  );

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
    if (isText) {
      await handleConfirmationReply(chatId, text);
    } else {
      // Photo/document received while waiting for YES/NO — ask user to answer first
      await sendMessage(chatId, 'Please reply YES or NO to the pending question first, then send your photo or document.');
    }
  } else if (state === 'PROCESSING') {
    // Still within the timeout window — genuinely processing
    console.warn(`[bot] Message from ${chatId} while PROCESSING — ignoring`);
  } else {
    if (isPhoto || isDocument) {
      await handleInboundMedia(chatId, msg);
    } else {
      await handleInboundMessage(chatId, text);
    }
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

// ── Handle photo / document messages ─────────────────────────────────────────

async function handleInboundMedia(chatId, msg) {
  db.setSessionState(chatId, 'PROCESSING');
  const typingInterval = startTyping(chatId);

  try {
    const mediaPayload = await prepareMediaForAnalysis(bot, msg);
    const caption = msg.caption ? msg.caption.trim() : null;
    const result  = await runClaudeMediaTurn(chatId, mediaPayload, caption, db);
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
    console.error(`[bot] Media error for ${chatId}:`, err.userMessage ? err.userMessage : err);
    db.setSessionState(chatId, 'IDLE');
    const userMsg = err.userMessage || 'Sorry, I had trouble processing that file. Please try again in a moment.';
    try {
      await sendMessage(chatId, userMsg);
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

// Proactive stuck-state sweep: catches sessions that are hung in PROCESSING
// even when the user hasn't sent a follow-up message (reactive timeout is insufficient).
// Runs every 30s; resets any PROCESSING session older than PROCESSING_TIMEOUT_MS.
setInterval(() => {
  try {
    const stuck = db.getStuckProcessingSessions(PROCESSING_TIMEOUT_MS);
    for (const chatId of stuck) {
      console.warn(`[bot] Proactive sweep: resetting stuck PROCESSING for ${chatId}`);
      db.setSessionState(chatId, 'IDLE');
    }
  } catch (err) {
    console.error('[bot] Proactive sweep error:', err.message);
  }
}, 30_000);
