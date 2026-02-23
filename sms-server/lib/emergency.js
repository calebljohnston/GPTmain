// emergency.js — Pre-approved emergency responses for Vita
//
// These responses are NEVER Claude-generated. They fire synchronously before
// any API call, ensuring immediate delivery regardless of API availability.
//
// Pattern philosophy:
//  - Mental health crisis checked first (highest stakes)
//  - Conservative patterns — specific phrases only, no broad terms like
//    "help", "pain", or "fire" that trigger constantly in a health context
//  - False negatives are worse than false positives here; err toward catching
//  - First matching category wins

'use strict';

const EMERGENCY_CATEGORIES = [
  {
    type: 'mental_health_crisis',
    patterns: [
      /\bsuicid/i,
      /\bkill\s+myself\b/i,
      /\bend\s+my\s+life\b/i,
      /\bwant\s+to\s+die\b/i,
      /\bdon'?t\s+want\s+to\s+(be here|live|exist)\b/i,
      /\bhurting\s+myself\b/i,
      /\bself[- ]harm/i,
    ],
    response:
      'Please call or text 988 right now — Suicide & Crisis Lifeline, free and ' +
      'available 24/7. Are you safe?',
  },
  {
    type: 'medical_emergency',
    patterns: [
      /\bheart\s+attack\b/i,
      /\bchest\s+pain\b/i,
      /\bcan'?t\s+breath/i,
      /\bnot\s+breathing\b/i,
      /\boverdos/i,
      /\bseizure\b/i,
      /\bunconscious\b/i,
      /\bsevere\s+(bleeding|allergic|reaction)\b/i,
      /\banaphylax/i,
      // "stroke" compound: requires an indicator word nearby to avoid "stroke of luck"
      /\b(having|think|symptoms|signs)\b.{0,30}\bstroke\b|\bstroke\b.{0,30}\b(having|think|symptoms|signs)\b/i,
      /\bpassing\s+out\b/i,
      /\bchoking\b/i,
    ],
    response:
      'Call 911 now. If this is a medical emergency, hang up and call immediately — ' +
      "don't wait. Are you safe?",
  },
  {
    type: 'immediate_danger',
    patterns: [
      /\bbeing\s+attacked\b/i,
      /\bsomeone\s+is\s+(hurting|attacking|threatening)\s+me\b/i,
      /\bi'?m\s+in\s+(immediate\s+)?danger\b/i,
      /\bsend\s+(help|police|ambulance)\b/i,
    ],
    response: 'Call 911 now. Are you safe?',
  },
];

/**
 * Checks whether a message text matches any emergency pattern.
 * Returns the matching category object { type, response } or null.
 *
 * @param {string} text — trimmed user message text
 * @returns {{ type: string, response: string } | null}
 */
function detectEmergency(text) {
  if (!text) return null;
  for (const category of EMERGENCY_CATEGORIES) {
    for (const pattern of category.patterns) {
      if (pattern.test(text)) {
        return category;
      }
    }
  }
  return null;
}

module.exports = { detectEmergency };
