// telegram.js — Telegram Bot API wrapper
// Replaces twilio.js. Sends messages via the Telegram Bot API.
// Uses node-telegram-bot-api. Bot instance is shared (set from server.js).

'use strict';

let _bot = null;

/** Called once at startup from server.js with the initialized bot instance */
function setBot(bot) {
  _bot = bot;
}

function getBot() {
  if (!_bot) throw new Error('Telegram bot not initialized — call setBot() first');
  return _bot;
}

// Telegram's max message length is 4096 chars.
// Split at paragraph/sentence boundaries to keep messages readable.
const SPLIT_AT = 3800;

/**
 * Send one or more Telegram messages to a chat ID.
 * Long messages are split at natural boundaries.
 */
async function sendMessage(chatId, text) {
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    await getBot().sendMessage(chatId, chunk);
  }
}

function splitMessage(text) {
  if (!text || text.length <= SPLIT_AT) return [text || ''];

  const chunks = [];
  let remaining = text;

  while (remaining.length > SPLIT_AT) {
    let cutAt = SPLIT_AT;

    const paraBreak = remaining.lastIndexOf('\n\n', SPLIT_AT);
    const sentenceEnd = Math.max(
      remaining.lastIndexOf('. ', SPLIT_AT),
      remaining.lastIndexOf('! ', SPLIT_AT),
      remaining.lastIndexOf('? ', SPLIT_AT),
    );
    const lineBreak = remaining.lastIndexOf('\n', SPLIT_AT);
    const boundary = Math.max(paraBreak, sentenceEnd, lineBreak);

    if (boundary > SPLIT_AT * 0.6) cutAt = boundary + 1;

    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

module.exports = { setBot, sendMessage };
