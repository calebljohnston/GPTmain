// media.js — Telegram file download + validation for Vita image processing
//
// No external dependencies — uses Node.js built-in https/http modules.
// Supports: JPEG, PNG, GIF, WEBP images (max 5 MB) and PDF documents (max 10 MB).
// Base64 is returned in memory only — never written to disk.

'use strict';

const https = require('https');
const http  = require('http');

// ── Limits & supported types ──────────────────────────────────────────────────

const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_IMAGE_BYTES    = 5  * 1024 * 1024;  // 5 MB  — Anthropic image API limit
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;  // 10 MB — Anthropic PDF API limit

// ── MediaError ─────────────────────────────────────────────────────────────────
// Carries a .userMessage that server.js forwards directly to the Telegram user.

class MediaError extends Error {
  constructor(userMessage, technicalDetail) {
    super(technicalDetail || userMessage);
    this.userMessage = userMessage;
  }
}

// ── File info extraction ───────────────────────────────────────────────────────

/**
 * Given a raw Telegram message, return the key metadata needed to download it.
 *
 * msg.photo  → array of resolutions; we pick the last (highest res) entry.
 *              Telegram always delivers photos as JPEG.
 * msg.document → file object with mime_type, file_name, file_size.
 *
 * @param {object} msg  — raw Telegram message object
 * @returns {{ fileId, mimeType, fileSize, fileName, isPhoto }}
 */
function extractFileInfo(msg) {
  if (msg.photo) {
    const best = msg.photo[msg.photo.length - 1];
    return {
      fileId:   best.file_id,
      mimeType: 'image/jpeg',
      fileSize: best.file_size || null,
      fileName: null,
      isPhoto:  true,
    };
  }

  if (msg.document) {
    return {
      fileId:   msg.document.file_id,
      mimeType: msg.document.mime_type || 'application/octet-stream',
      fileSize: msg.document.file_size || null,
      fileName: msg.document.file_name || null,
      isPhoto:  false,
    };
  }

  throw new MediaError('No photo or document found in this message.');
}

// ── MIME type validation ───────────────────────────────────────────────────────

/**
 * @returns {{ valid: boolean, isDocument: boolean, userFriendlyType: string }}
 */
function validateMimeType(mimeType) {
  if (SUPPORTED_IMAGE_TYPES.has(mimeType)) {
    return { valid: true, isDocument: false, userFriendlyType: 'image' };
  }
  if (mimeType === 'application/pdf') {
    return { valid: true, isDocument: true, userFriendlyType: 'PDF' };
  }
  return { valid: false, isDocument: false, userFriendlyType: mimeType };
}

// ── File download ──────────────────────────────────────────────────────────────

/**
 * Download a URL into a Buffer using Node.js built-in https/http.
 * Streams chunks, checks running total against maxBytes, aborts mid-download if exceeded.
 *
 * @param {string} url
 * @param {number} maxBytes
 * @returns {Promise<Buffer>}
 */
function downloadAsBuffer(url, maxBytes) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const req = protocol.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume(); // drain to allow socket reuse
        return reject(new MediaError(
          'I had trouble downloading that file from Telegram. Please try again.',
          `Download failed with HTTP ${res.statusCode}`,
        ));
      }

      const chunks = [];
      let totalReceived = 0;

      res.on('data', (chunk) => {
        totalReceived += chunk.length;
        if (totalReceived > maxBytes) {
          req.destroy();
          reject(new MediaError(
            `That file exceeded the ${(maxBytes / 1024 / 1024).toFixed(0)} MB size limit during download. Please send a smaller file.`,
          ));
        } else {
          chunks.push(chunk);
        }
      });

      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', (err) => reject(new MediaError('Download interrupted.', err.message)));
    });

    req.on('error', (err) => reject(new MediaError(
      'I had trouble reaching the file. Please try again.',
      err.message,
    )));

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new MediaError('File download timed out. Please try again.'));
    });
  });
}

// ── Main exported helper ───────────────────────────────────────────────────────

/**
 * Download and base64-encode a file from a Telegram message.
 * Validates type and size. Throws MediaError on any failure.
 *
 * @param {TelegramBot} bot   — node-telegram-bot-api instance
 * @param {object}      msg   — raw Telegram message object (must have .photo or .document)
 * @returns {Promise<{ base64: string, mimeType: string, isDocument: boolean, fileName: string|null }>}
 */
async function prepareMediaForAnalysis(bot, msg) {
  const { fileId, mimeType, fileSize, fileName } = extractFileInfo(msg);

  // Validate MIME type
  const { valid, isDocument, userFriendlyType } = validateMimeType(mimeType);
  if (!valid) {
    throw new MediaError(
      `I can only process JPEG, PNG, GIF, WEBP images and PDF documents. ` +
      `That file type (${userFriendlyType}) isn't supported yet. ` +
      `Try sending a photo directly or convert to PDF.`,
    );
  }

  const maxBytes = isDocument ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES;
  const limitMB  = (maxBytes / 1024 / 1024).toFixed(0);

  // Pre-download size check (Telegram metadata isn't always accurate, so we also check mid-download)
  if (fileSize && fileSize > maxBytes) {
    throw new MediaError(
      `That file is too large (${(fileSize / 1024 / 1024).toFixed(1)} MB). ` +
      `Please send ${userFriendlyType === 'PDF' ? 'PDFs' : 'images'} under ${limitMB} MB.`,
    );
  }

  // Get download URL from Telegram
  let fileUrl;
  try {
    fileUrl = await bot.getFileLink(fileId);
  } catch (err) {
    throw new MediaError(
      'I had trouble getting the file link from Telegram. Please try again.',
      err.message,
    );
  }

  // Download the file (streaming, with mid-download size check)
  const buffer = await downloadAsBuffer(fileUrl, maxBytes);
  const base64 = buffer.toString('base64');

  console.log(`[media] Downloaded ${userFriendlyType} for analysis: ${(buffer.length / 1024).toFixed(0)} KB`);

  return { base64, mimeType, isDocument, fileName };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { prepareMediaForAnalysis, MediaError };
