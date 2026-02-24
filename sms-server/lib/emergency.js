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
    // Hypertensive crisis — numeric check (regex can't compare numbers)
    type: 'extreme_bp',
    check: (text) => {
      // "NNN/NNN" or "NNN / NNN"
      const slashMatch = text.match(/\b(\d{2,3})\s*\/\s*(\d{2,3})\b/);
      if (slashMatch) {
        const sys = parseInt(slashMatch[1]);
        const dia = parseInt(slashMatch[2]);
        if (sys >= 180 || dia >= 120) return true;
      }
      // "NNN over NNN"
      const overMatch = text.match(/\b(\d{2,3})\s+over\s+(\d{2,3})\b/i);
      if (overMatch) {
        const sys = parseInt(overMatch[1]);
        const dia = parseInt(overMatch[2]);
        if (sys >= 180 || dia >= 120) return true;
      }
      return false;
    },
    response:
      'A blood pressure at or above 180/120 is a hypertensive crisis. Call 911 or go to ' +
      'the ER now — do not wait. Are you having symptoms like headache, chest pain, or vision changes?',
  },
  {
    // Severe hypoglycemia — numeric check
    type: 'extreme_glucose',
    check: (text) => {
      const m = text.match(/\b(?:glucose|blood\s+sugar|bg|sugar)\b.{0,25}?(\d{2,3})\b/i);
      if (m) {
        const val = parseInt(m[1]);
        if (val < 55) return true;
      }
      return false;
    },
    response:
      'A blood glucose below 55 needs immediate treatment. If you\'re conscious, take ' +
      '15g of fast-acting carbs (glucose tablets, juice) right now, then call 911 or have someone with you. Are you safe?',
  },
  {
    // Stroke symptoms — FAST mnemonic without requiring the word "stroke"
    type: 'stroke_symptoms',
    patterns: [
      /\bface\s+(drooping|drooping|numb|falling|sagging)\b/i,
      /\b(one|my)\s+(side|half)\s+of\s+(my\s+)?face\s+(is\s+)?(drooping|numb|weak)\b/i,
      /\b(sudden|one|my)\s+arm\s+(is\s+)?(weak|numb|can'?t\s+(lift|move|raise))\b/i,
      /\bcan'?t\s+(lift|move|raise)\s+(my\s+)?arm\b/i,
      /\b(sudden(ly)?|all\s+of\s+a\s+sudden)\b.{0,30}\bslurring\b/i,
      /\bsuddenly\s+slurred\b/i,
      /\bwords\s+(coming\s+out\s+)?(wrong|jumbled|garbled)\b/i,
      /\bcan'?t\s+(talk|speak|form\s+words)\b/i,
      /\bworst\s+headache\s+(of\s+my\s+life|i'?ve\s+ever\s+had)\b/i,
      /\bthunderclap\s+headache\b/i,
      /\b(sudden(ly)?|all\s+of\s+a\s+sudden)\b.{0,30}\b(vision|sight|eye|blind)\b/i,
      /\b(sudden(ly)?)\b.{0,30}\b(balance|coordination|stumbling|can'?t\s+walk)\b/i,
    ],
    response:
      'These sound like stroke warning signs — call 911 immediately, time is critical. ' +
      'Note when the symptoms started. Are you safe?',
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
    // Function-based check (used for numeric vital thresholds like extreme BP/glucose)
    if (category.check && category.check(text)) {
      return category;
    }
    // Pattern array check
    if (category.patterns) {
      for (const pattern of category.patterns) {
        if (pattern.test(text)) {
          return category;
        }
      }
    }
  }
  return null;
}

module.exports = { detectEmergency };
