// classifier.js — Zero-latency message classification for the Vita Thematic Map
//
// Classifies each incoming user message into one of 17 categories across 6 tiers.
// Used to inject mode-specific prompt sections into the Claude system prompt.
//
// Architecture:
//   - Tier 1 (Emergency/Crisis): primarily handled by emergency.js pre-intercept.
//     The Master Safety Rule here catches mixed-context messages where emergency
//     signals appear inside an otherwise lower-tier message.
//   - Tiers 2–6: keyword scoring → highest score wins → mode block injected
//   - Synchronous, zero I/O, zero external dependencies, ~0ms overhead

'use strict';

// ── Vital Value Parsers ────────────────────────────────────────────────────────

/**
 * Parse systolic/diastolic BP values from free text.
 * @param {string} text
 * @returns {{ systolic: number|null, diastolic: number|null }}
 */
function parseBPValues(text) {
  // "180/120" or "180 / 120"
  const slashMatch = text.match(/\b(\d{2,3})\s*\/\s*(\d{2,3})\b/);
  if (slashMatch) {
    return { systolic: parseInt(slashMatch[1]), diastolic: parseInt(slashMatch[2]) };
  }
  // "180 over 120"
  const overMatch = text.match(/\b(\d{2,3})\s+over\s+(\d{2,3})\b/i);
  if (overMatch) {
    return { systolic: parseInt(overMatch[1]), diastolic: parseInt(overMatch[2]) };
  }
  return { systolic: null, diastolic: null };
}

/**
 * Parse glucose value from free text.
 * @param {string} text
 * @returns {number|null}
 */
function parseGlucoseValue(text) {
  const m = text.match(/\b(?:glucose|blood\s+sugar|bg|sugar)\b.{0,25}?(\d{2,3})\b/i);
  return m ? parseInt(m[1]) : null;
}

// ── Master Safety Rule ────────────────────────────────────────────────────────

/**
 * Checks for emergency signals that override all tier scoring.
 * Handles mixed-context messages where emergency signals appear inside a
 * lower-tier message (e.g. "been exercising but my BP is 185/122").
 *
 * @param {string} text
 * @returns {{ tier, category, mode, confidence, emergency }|null}
 */
function checkMasterSafetyRule(text) {
  // Extreme BP values (numeric check — can't do this with regex alone)
  const bp = parseBPValues(text);
  if (bp.systolic !== null && bp.systolic >= 180) {
    return { tier: 1, category: '1A', mode: 'EMERGENCY', confidence: 'high', emergency: true };
  }
  if (bp.diastolic !== null && bp.diastolic >= 120) {
    return { tier: 1, category: '1A', mode: 'EMERGENCY', confidence: 'high', emergency: true };
  }

  // Extreme glucose (< 55 mg/dL)
  const glucose = parseGlucoseValue(text);
  if (glucose !== null && glucose < 55) {
    return { tier: 1, category: '1A', mode: 'EMERGENCY', confidence: 'high', emergency: true };
  }

  // Crisis language — even inside a routine question
  if (/\b(suicid|self[- ]harm|want\s+to\s+die|kill\s+myself|end\s+my\s+life|don'?t\s+want\s+to\s+(live|be\s+here|exist)|hurting\s+myself)\b/i.test(text)) {
    return { tier: 1, category: '1B', mode: 'CRISIS', confidence: 'high', emergency: true };
  }

  return null;
}

// ── Category Map ──────────────────────────────────────────────────────────────

/**
 * Keyword scoring map for all 17 Thematic Map categories.
 * Each entry: { tier, mode, keywords: [[regex, weight], ...] }
 * Higher weight = stronger signal. Category with highest total score wins.
 */
const CATEGORY_MAP = {

  // ── Tier 1 (included to prevent false lows; typically intercepted by emergency.js) ──
  '1A': {
    tier: 1, mode: 'EMERGENCY',
    keywords: [
      [/\bheart\s+attack\b/i, 10],
      [/\bchest\s+(pain|tightness|pressure)\b/i, 10],
      [/\bcan'?t\s+breath/i, 10],
      [/\bnot\s+breathing\b/i, 10],
      [/\boverdos/i, 10],
      [/\bseizure\b/i, 9],
      [/\bunconscious\b/i, 9],
      [/\banaphylax/i, 9],
      [/\bpassing\s+out\b/i, 8],
      [/\bchoking\b/i, 8],
    ],
  },
  '1B': {
    tier: 1, mode: 'CRISIS',
    keywords: [
      [/\bsuicid/i, 10],
      [/\bkill\s+myself\b/i, 10],
      [/\bend\s+my\s+life\b/i, 10],
      [/\bwant\s+to\s+die\b/i, 10],
      [/\bself[- ]harm/i, 10],
    ],
  },

  // ── Tier 2: High Clinical Risk ───────────────────────────────────────────────
  '2A': {
    tier: 2, mode: 'SYMPTOM_INTERPRETATION',
    keywords: [
      [/\bsymptom(s)?\b/i, 5],
      [/\bi\s+(have|feel|am\s+having)\s+(a\s+)?(chest|head|stomach|back|joint|muscle)\s*(pain|ache|hurt)/i, 6],
      [/\bfeeling\s+(dizzy|nauseous|nauseated|lightheaded|faint|weak|shaky)\b/i, 6],
      [/\b(dizziness|nausea|fatigue|lightheaded)\b/i, 5],
      [/\bwhat'?s?\s+wrong\s+(with\s+me)?\b/i, 6],
      [/\bshould\s+i\s+be\s+(worried|concerned)\b/i, 6],
      [/\bcould\s+(this|it)\s+be\b/i, 5],
      [/\bwhat\s+(does|could)\s+this\s+(mean|indicate|be)\b/i, 5],
      [/\bis\s+(this|it)\s+normal\b/i, 5],
      [/\bblurry\s+vision\b/i, 6],
      [/\bshortness\s+of\s+breath\b/i, 5],
      [/\bswelling\b/i, 4],
      [/\bnumbness\b/i, 4],
      [/\btingling\b/i, 4],
      [/\bmy\s+(head|stomach|back|arm|leg|foot|knee)\s+(hurts|aches|is\s+(sore|painful))\b/i, 6],
      [/\b(have|been)\s+having\b.{0,40}\bfor\s+\d+\s+(day|week|hour)\b/i, 5],
    ],
  },

  '2B': {
    tier: 2, mode: 'MEDICATION_STRATEGY',
    keywords: [
      [/\bstop\s+(taking|my)\b/i, 7],
      [/\bcan\s+i\s+stop\b/i, 7],
      [/\bswitch\s+(from|to|medication|med)\b/i, 7],
      [/\b(better|different)\s+(medication|drug|pill|statin|med)\b/i, 6],
      [/\bshould\s+i\s+(take|start|try)\b/i, 5],
      [/\bdrug\s+interaction\b/i, 8],
      [/\bdose\s*(change|adjust|increase|decrease|modification)\b/i, 7],
      [/\bis\s+it\s+safe\s+to\s+take\b/i, 6],
      [/\bpharmacist\b/i, 5],
      [/\bmedication\s+(question|advice|change|switch)\b/i, 6],
      [/\b(losartan|lisinopril|metoprolol|amlodipine|atorvastatin|metformin|ozempic|jardiance|eliquis|warfarin)\b.{0,30}\b(should|can|safe|switch|stop|change)\b/i, 8],
      [/\btake\s+with\s+(food|water|milk|alcohol|grapefruit)\b/i, 6],
      [/\bcan\s+i\s+take\b/i, 5],
    ],
  },

  '2C': {
    tier: 2, mode: 'BP_TROUBLESHOOTING',
    keywords: [
      [/\bwhy\s+is\s+my\s+(blood\s+pressure|bp)\b/i, 8],
      [/\bmy\s+(blood\s+pressure|bp)\s+(is|was|reading|shows?)\b/i, 6],
      [/\b(blood\s+pressure|bp)\s+(high|low|elevated|spike|drop|fluctuat|different)\b/i, 6],
      [/\bdifferent\s+(readings?|numbers?|results?)\b/i, 5],
      [/\bmorning\s+(blood\s+pressure|bp)\b/i, 6],
      [/\bone\s+arm\b.{0,30}\b(other|different|higher|lower)\b/i, 7],
      [/\bwhite\s+coat\b/i, 7],
      [/\bhow\s+to\s+lower\s+(my\s+)?(blood\s+pressure|bp)\b/i, 7],
      [/\bnormal\s+(blood\s+pressure|bp)\s+(range|number|reading)\b/i, 6],
      [/\bis\s+\d+\/\d+\s+(dangerous|bad|normal|okay|concerning)\b/i, 7],
      [/\bblood\s+pressure\s+variabilit/i, 7],
      [/\b(systolic|diastolic)\b/i, 4],
    ],
  },

  // ── Tier 3: Program-Scoped Education ─────────────────────────────────────────
  '3A': {
    tier: 3, mode: 'EDUCATION_HYPERTENSION',
    keywords: [
      [/\bwhat\s+is\s+hypertension\b/i, 8],
      [/\blearn\s+about\s+(high\s+blood\s+pressure|hypertension)\b/i, 8],
      [/\bhypertension\s+(stage|class|category|cause)\b/i, 7],
      [/\bblood\s+pressure\s+(categories|stages|ranges|target|explained)\b/i, 6],
      [/\bwhat\s+(does|do)\s+(systolic|diastolic)\s+(mean|number)\b/i, 7],
      [/\bexplain\s+(blood\s+pressure|hypertension|systolic|diastolic)\b/i, 7],
      [/\b(ACE\s+inhibitor|ARB|calcium\s+channel\s+blocker|diuretic)\s+(what\s+is|class|type|explain)\b/i, 7],
      [/\bwhat\s+causes?\s+hypertension\b/i, 7],
      [/\bdash\s+diet\s+(what|explain|tell|how)\b/i, 6],
      [/\bwhat\s+are\s+(bp|blood\s+pressure)\s+(medications?|drugs?|classes)\b/i, 6],
    ],
  },

  '3B': {
    tier: 3, mode: 'EDUCATION_DIABETES',
    keywords: [
      [/\bwhat\s+is\s+(an?\s+)?a1c\b/i, 8],
      [/\bexplain\s+(a1c|hba1c|diabetes|insulin\s+resistance|blood\s+sugar)\b/i, 7],
      [/\ba1c\s+(mean|number|level|target|normal|range)\b/i, 7],
      [/\bwhat\s+is\s+insulin\s+resistance\b/i, 8],
      [/\bprediabetes\s+(what|mean|is)\b/i, 7],
      [/\bwhat\s+is\s+(fasting\s+)?(blood\s+sugar|glucose)\b/i, 7],
      [/\bnormal\s+(blood\s+sugar|glucose|a1c)\s+(range|level|number)\b/i, 7],
      [/\bwhat\s+is\s+(type\s+)?(1|2|one|two)\s+diabetes\b/i, 8],
      [/\bhow\s+does\s+insulin\s+work\b/i, 7],
      [/\bwhat\s+is\s+(hyperglycemia|hypoglycemia)\b/i, 7],
      [/\bdiabetes\s+(education|learn|understand|cause)\b/i, 6],
    ],
  },

  '3C': {
    tier: 3, mode: 'EDUCATION_LIPIDS',
    keywords: [
      [/\bwhat\s+is\s+(ldl|hdl|cholesterol|triglycerides?)\b/i, 8],
      [/\bexplain\s+(cholesterol|lipids?|ldl|hdl|triglycerides?)\b/i, 7],
      [/\bldl\s+(vs\.?|and|or)\s+hdl\b/i, 8],
      [/\blipid\s+panel\s+(what|explain|mean|result)\b/i, 7],
      [/\bwhat\s+(are|is)\s+(good|bad|normal)\s+(cholesterol|ldl|hdl)\b/i, 7],
      [/\bcholesterol\s+(number|level|range|target|goal|explained)\b/i, 6],
      [/\bdo\s+i\s+need\s+a\s+statin\b/i, 7],
      [/\bwhat\s+is\s+a\s+statin\b/i, 8],
      [/\btotal\s+cholesterol\b/i, 6],
      [/\bascvd\b/i, 7],
      [/\bcardiovascular\s+risk\s+(what|explain|learn)\b/i, 5],
    ],
  },

  '3D': {
    tier: 3, mode: 'EDUCATION_WEIGHT_SCIENCE',
    keywords: [
      [/\bwhat\s+is\s+(a\s+)?bmi\b/i, 8],
      [/\bexplain\s+bmi\b/i, 7],
      [/\bwhy\s+is\s+(it\s+)?(so\s+)?(hard|difficult)\s+to\s+(lose|keep\s+off)\s+weight\b/i, 8],
      [/\bwhy\s+can'?t\s+i\s+(lose|keep\s+off)\s+weight\b/i, 8],
      [/\bweight\s+set\s+point\b/i, 8],
      [/\bmetabolic\s+(rate|adaptation|syndrome)\b/i, 7],
      [/\bmetabolism\s+(slow|fast|explain|how)\b/i, 7],
      [/\bobesity\s+(science|biology|cause|class)\b/i, 7],
      [/\bglp[-\s]?1\s+(what|how|explain|work)\b/i, 7],
      [/\b(semaglutide|tirzepatide|wegovy|mounjaro)\b.{0,30}\b(what|how|explain|work)\b/i, 7],
      [/\bbariatric\b/i, 6],
      [/\bbody\s+fat\s+(percentage|science|biology)\b/i, 6],
    ],
  },

  // ── Tier 4: Behavioral Coaching ───────────────────────────────────────────────
  '4A': {
    tier: 4, mode: 'COACHING_NUTRITION',
    keywords: [
      [/\bwhat\s+should\s+i\s+eat\b/i, 7],
      [/\bwhat\s+(to|can\s+i)\s+eat\b/i, 6],
      [/\bhealthy\s+(food|eating|meal|breakfast|lunch|dinner|snack)\b/i, 5],
      [/\bmeal\s+plan(ning)?\b/i, 6],
      [/\bdash\s+diet\b/i, 5],
      [/\bmediterranean\s+diet\b/i, 5],
      [/\bhow\s+much\s+(sodium|salt|sugar|protein|carb)\b/i, 6],
      [/\brecipe\b/i, 4],
      [/\bgrocery\s+(list|shopping)\b/i, 5],
      [/\bsnack\s+(ideas?|healthy|suggestion)\b/i, 5],
      [/\bportion\s+(size|control)\b/i, 5],
      [/\bfoods?\s+(to\s+)?(avoid|eat\s+for|good\s+for|bad\s+for)\b/i, 5],
      [/\beating\s+habits?\b/i, 5],
      [/\bnutrition\s+(tips?|advice|help|goal)\b/i, 6],
    ],
  },

  '4B': {
    tier: 4, mode: 'COACHING_EXERCISE',
    keywords: [
      [/\bexercise\s+(plan|routine|goal|tip|advice|help)\b/i, 7],
      [/\bworkout\b/i, 6],
      [/\bhow\s+(much|often|many\s+times)\s+(should\s+i\s+)?exercise\b/i, 7],
      [/\bis\s+walking\s+(enough|good\s+enough)\b/i, 7],
      [/\bsteps?\s+(per|a|each)\s+day\b/i, 6],
      [/\bcardio\b/i, 5],
      [/\bstrength\s+training\b/i, 6],
      [/\bphysical\s+activity\b/i, 5],
      [/\bsedentary\b/i, 6],
      [/\bfitness\s+(goal|level|routine|plan)\b/i, 6],
      [/\bhow\s+to\s+(start|begin)\s+exercising\b/i, 7],
      [/\bget\s+(active|moving|fit)\b/i, 6],
      [/\brun(ning)?\s+(plan|goal|routine)\b/i, 5],
    ],
  },

  '4C': {
    tier: 4, mode: 'COACHING_WEIGHT_HABIT',
    keywords: [
      [/\blose\s+weight\b/i, 6],
      [/\bweight\s+(goal|loss\s+goal|target)\b/i, 6],
      [/\bi\s+can'?t\s+stay\s+consistent\b/i, 8],
      [/\bi\s+keep\s+(falling\s+off|failing|losing\s+motivation)\b/i, 8],
      [/\bemotional\s+eating\b/i, 8],
      [/\bmotivation\b/i, 5],
      [/\baccountability\b/i, 6],
      [/\bstay(ing)?\s+on\s+track\b/i, 6],
      [/\bbuild(ing)?\s+a\s+routine\b/i, 6],
      [/\bconsistency\b/i, 5],
      [/\bbinge\s+eating\b/i, 7],
      [/\balways\s+(fall|fail|struggle|quit)\b/i, 7],
      [/\bweight\s+loss\s+(journey|plan|tips?)\b/i, 5],
    ],
  },

  '4D': {
    tier: 4, mode: 'COACHING_MED_ADHERENCE',
    keywords: [
      [/\bforgot?\s+(to\s+take|my\s+medication|my\s+pills?|my\s+dose)\b/i, 8],
      [/\bforgetting\s+(my\s+)?(medication|pills?|dose)\b/i, 8],
      [/\bremembering\s+(my\s+)?(medication|pills?|dose)\b/i, 7],
      [/\bpill\s+(reminder|organizer|box)\b/i, 7],
      [/\bi\s+skip\s+doses?\b/i, 8],
      [/\bmedication\s+routine\b/i, 6],
      [/\badherence\b/i, 7],
      [/\bhard\s+to\s+remember\s+(to\s+take)?\b/i, 7],
      [/\bwhen\s+to\s+take\s+my\b/i, 6],
      [/\bmedication\s+too\s+expensive\b/i, 7],
      [/\bcan'?t\s+afford\s+(my\s+)?(medication|prescription|meds)\b/i, 7],
      [/\bmedication\s+makes?\s+me\s+(tired|sick|dizzy|nauseous)\b/i, 6],
      [/\bside\s+effect\s+(from|of)\b/i, 5],
    ],
  },

  '4E': {
    tier: 4, mode: 'COACHING_DEVICE',
    keywords: [
      [/\bblood\s+pressure\s+cuff\b/i, 8],
      [/\bhow\s+to\s+use\s+(my\s+)?(cuff|monitor|glucometer|cgm|dexcom|libre)\b/i, 9],
      [/\bcuff\b/i, 5],
      [/\bwon'?t\s+sync\b/i, 7],
      [/\bglucometer\b/i, 7],
      [/\b(dexcom|freestyle\s+libre)\b/i, 7],
      [/\bwrong\s+reading\b/i, 6],
      [/\bdevice\s+(error|problem|not\s+working)\b/i, 7],
      [/\bcalibrat/i, 6],
      [/\bhow\s+to\s+(check|measure|take)\s+(my\s+)?(blood\s+pressure|bp|glucose)\s+(correctly|properly|right)\b/i, 7],
      [/\b(arm|wrist)\s+cuff\b/i, 6],
      [/\bmonitor\s+(placement|position)\b/i, 6],
      [/\bsensor\s+(placement|fell\s+off|not\s+reading)\b/i, 6],
    ],
  },

  // ── Tier 5: Administrative ────────────────────────────────────────────────────
  '5A': {
    tier: 5, mode: 'ADMINISTRATIVE',
    keywords: [
      [/\bbilling\b/i, 8],
      [/\binsurance\b/i, 6],
      [/\bcopay\b/i, 8],
      [/\bhow\s+much\s+(does\s+this|is\s+this|do\s+i)\s+(cost|pay|owe)\b/i, 7],
      [/\bcoverage\b/i, 6],
      [/\bdeductible\b/i, 8],
      [/\bprior\s+authorization\b/i, 9],
      [/\binsurance\s+claim\b/i, 8],
      [/\bis\s+this\s+covered\b/i, 8],
      [/\breferral\b/i, 5],
      [/\bhow\s+am\s+i\s+(billed|charged)\b/i, 8],
      [/\bwhy\s+(was|were)\s+i\s+charged\b/i, 8],
      [/\bout\s+of\s+pocket\b/i, 7],
    ],
  },

  // ── Tier 6: Out of Scope (low-weight catch-all) ───────────────────────────────
  '6': {
    tier: 6, mode: 'OUT_OF_SCOPE',
    keywords: [
      [/\bcold\s*(and\s*flu)?\b/i, 4],
      [/\bflu\s+(symptoms?|season|shot)\b/i, 4],
      [/\bsore\s+throat\b/i, 4],
      [/\brunny\s+nose\b/i, 3],
      [/\bdental\b/i, 4],
      [/\btoothache\b/i, 4],
      [/\bvision\s+(exam|prescription|glasses|lens)\b/i, 4],
      [/\bpregnancy\b/i, 4],
      [/\buti\b/i, 5],
      [/\burinary\s+tract\s+infection\b/i, 5],
      [/\bskin\s+(rash|condition|problem)\b/i, 4],
      [/\bcancer\b/i, 4],
      [/\bsupplement(s)?\b/i, 3],
      [/\bvitamin\s+[a-z]\b/i, 3],
    ],
  },
};

// ── Fallback ──────────────────────────────────────────────────────────────────

/** Clinical vocabulary that suggests a Tier 3 education response */
const CLINICAL_VOCAB_RE = /\b(blood\s+pressure|glucose|cholesterol|a1c|hba1c|medication|mmhg|bpm|diabetes|hypertension|statin|insulin|triglycerides?|lipid|cardiovascular|metabolic)\b/i;

function defaultClassification() {
  return { tier: 4, category: '4A', mode: 'COACHING_NUTRITION', confidence: 'low', emergency: false };
}

// ── Main Classifier ───────────────────────────────────────────────────────────

/**
 * Classify a user message into the Vita Thematic Map.
 *
 * @param {string} text — trimmed user message
 * @returns {{
 *   tier:       number,
 *   category:   string,
 *   mode:       string,
 *   confidence: 'high'|'medium'|'low',
 *   emergency:  boolean,
 * }}
 */
function classifyMessage(text) {
  if (!text || text.trim().length === 0) return defaultClassification();

  // 1. Master Safety Rule — overrides all scoring
  const safetyOverride = checkMasterSafetyRule(text);
  if (safetyOverride) return safetyOverride;

  // 2. Score every category
  const scores = {};
  for (const [cat, def] of Object.entries(CATEGORY_MAP)) {
    let score = 0;
    for (const [regex, weight] of def.keywords) {
      if (regex.test(text)) score += weight;
    }
    scores[cat] = score;
  }

  // 3. Find top two scores for confidence calculation
  let topCat = null;
  let topScore = 0;
  let secondScore = 0;

  for (const [cat, score] of Object.entries(scores)) {
    if (score > topScore) {
      secondScore = topScore;
      topScore = score;
      topCat = cat;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  // 4. Confidence:
  //   high   = top score ≥ 6 AND margin over second ≥ 3
  //   medium = top score ≥ 3 AND margin ≥ 1
  //   low    = anything else → fallback routing
  const margin = topScore - secondScore;
  let confidence = 'low';
  if (topScore >= 6 && margin >= 3) confidence = 'high';
  else if (topScore >= 3 && margin >= 1) confidence = 'medium';

  // 5. Low confidence → sensible fallbacks
  if (confidence === 'low') {
    const wordCount = text.trim().split(/\s+/).length;
    if (wordCount <= 8) {
      // Short message (greeting, single word) → coaching default
      return { tier: 4, category: '4A', mode: 'COACHING_NUTRITION', confidence: 'low', emergency: false };
    }
    if (CLINICAL_VOCAB_RE.test(text)) {
      // Longer message with clinical vocabulary → education default
      return { tier: 3, category: '3A', mode: 'EDUCATION_HYPERTENSION', confidence: 'low', emergency: false };
    }
    return defaultClassification();
  }

  const def = CATEGORY_MAP[topCat];
  return {
    tier: def.tier,
    category: topCat,
    mode: def.mode,
    confidence,
    emergency: false,
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { classifyMessage, parseBPValues, parseGlucoseValue };
