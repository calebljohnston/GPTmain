// storage.js — localStorage data layer
// All health agent data is namespaced under "healthAgent.*"

const KEYS = {
  CONFIG: 'healthAgent.config',
  HEALTH_RECORD: 'healthAgent.healthRecord',
  GOALS: 'healthAgent.goals',
  CONVERSATIONS: 'healthAgent.conversations',
  REMINDERS: 'healthAgent.reminders',
  PENDING_CONFIRMATIONS: 'healthAgent.pendingConfirmations',
};

const SCHEMA_VERSION = 1;
const MAX_CONVERSATIONS = 20;
const VITAL_HISTORY_DAYS = 90;

function get(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function set(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('Storage write failed:', e);
    return false;
  }
}

function remove(key) {
  localStorage.removeItem(key);
}

// ── Config ──────────────────────────────────────────────────────────────────

export function getConfig() {
  return get(KEYS.CONFIG);
}

export function saveConfig(config) {
  const existing = getConfig() || {};
  set(KEYS.CONFIG, { ...existing, ...config, version: SCHEMA_VERSION });
}

export function isOnboardingComplete() {
  const cfg = getConfig();
  return !!(cfg && cfg.onboardingComplete && cfg.apiKey);
}

// ── Health Record ────────────────────────────────────────────────────────────

export function getHealthRecord() {
  return get(KEYS.HEALTH_RECORD) || createEmptyHealthRecord();
}

export function saveHealthRecord(record) {
  set(KEYS.HEALTH_RECORD, { ...record, lastUpdated: new Date().toISOString() });
}

export function createEmptyHealthRecord() {
  return {
    version: SCHEMA_VERSION,
    lastUpdated: null,
    demographics: {
      name: null,
      dateOfBirth: null,
      biologicalSex: null,
      height: null,
      bloodType: null,
    },
    vitals: {
      weight: [],
      bloodPressure: [],
      restingHeartRate: [],
      sleepHours: [],
      bloodGlucose: [],
    },
    conditions: [],
    medications: [],
    allergies: [],
    lifestyle: {
      smokingStatus: null,
      alcoholConsumption: null,
      exerciseFrequency: null,
      diet: null,
      occupation: null,
      stressLevel: null,
    },
    preferences: {
      communicationStyle: 'encouraging',
      reminderTone: 'encouraging',
      preferredCheckInTime: '08:00',
      unitsSystem: 'metric',
    },
  };
}

// Append a time-series vital entry and prune old entries
export function appendVital(vitalKey, entry) {
  const record = getHealthRecord();
  if (!record.vitals[vitalKey]) record.vitals[vitalKey] = [];
  record.vitals[vitalKey].push({ ...entry, recordedAt: entry.recordedAt || new Date().toISOString() });

  // Prune to last VITAL_HISTORY_DAYS days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - VITAL_HISTORY_DAYS);
  record.vitals[vitalKey] = record.vitals[vitalKey].filter(
    (v) => new Date(v.recordedAt) > cutoff
  );

  saveHealthRecord(record);
  return record;
}

// Update a scalar field in health record (dot-notation path)
export function updateHealthField(path, value) {
  const record = getHealthRecord();
  setNestedValue(record, path, value);
  saveHealthRecord(record);
  return record;
}

function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current)) current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

// Add/update/remove items in array fields (conditions, medications, allergies)
export function upsertListItem(field, item) {
  const record = getHealthRecord();
  if (!record[field]) record[field] = [];
  const idx = record[field].findIndex((x) => x.id === item.id);
  if (idx >= 0) {
    record[field][idx] = { ...record[field][idx], ...item };
  } else {
    record[field].push({ ...item, id: item.id || generateId(field) });
  }
  saveHealthRecord(record);
  return record;
}

export function removeListItem(field, id) {
  const record = getHealthRecord();
  if (record[field]) {
    record[field] = record[field].filter((x) => x.id !== id);
    saveHealthRecord(record);
  }
  return getHealthRecord();
}

// ── Goals ────────────────────────────────────────────────────────────────────

export function getGoals() {
  return get(KEYS.GOALS) || { version: SCHEMA_VERSION, goals: [], tasks: [] };
}

export function saveGoals(data) {
  set(KEYS.GOALS, { ...data, version: SCHEMA_VERSION });
}

export function addGoal(goal) {
  const data = getGoals();
  const newGoal = {
    ...goal,
    id: goal.id || generateId('goal'),
    status: goal.status || 'active',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    milestones: goal.milestones || [],
  };
  data.goals.push(newGoal);
  saveGoals(data);
  return newGoal;
}

export function updateGoal(goalId, updates) {
  const data = getGoals();
  const idx = data.goals.findIndex((g) => g.id === goalId);
  if (idx >= 0) {
    data.goals[idx] = { ...data.goals[idx], ...updates, lastUpdated: new Date().toISOString() };
    saveGoals(data);
    return data.goals[idx];
  }
  return null;
}

export function addTask(task) {
  const data = getGoals();
  const newTask = {
    ...task,
    id: task.id || generateId('task'),
    completedDates: [],
    active: true,
    createdAt: new Date().toISOString(),
  };
  data.tasks.push(newTask);
  saveGoals(data);
  return newTask;
}

export function markTaskComplete(taskId, date) {
  const data = getGoals();
  const task = data.tasks.find((t) => t.id === taskId);
  if (task) {
    const dateStr = date || new Date().toISOString().split('T')[0];
    if (!task.completedDates.includes(dateStr)) {
      task.completedDates.push(dateStr);
    }
    saveGoals(data);
    return task;
  }
  return null;
}

// ── Conversations ────────────────────────────────────────────────────────────

export function getConversations() {
  return get(KEYS.CONVERSATIONS) || { version: SCHEMA_VERSION, sessions: [] };
}

export function getCurrentSession() {
  const convs = getConversations();
  if (convs.sessions.length === 0) return startNewSession();
  return convs.sessions[convs.sessions.length - 1];
}

export function startNewSession() {
  const convs = getConversations();
  const session = {
    id: generateId('sess'),
    startedAt: new Date().toISOString(),
    messages: [],
  };
  convs.sessions.push(session);
  // Keep max sessions
  if (convs.sessions.length > MAX_CONVERSATIONS) {
    convs.sessions = convs.sessions.slice(-MAX_CONVERSATIONS);
  }
  set(KEYS.CONVERSATIONS, convs);
  return session;
}

export function appendMessage(message) {
  const convs = getConversations();
  const session = convs.sessions[convs.sessions.length - 1];
  if (session) {
    session.messages.push({ ...message, timestamp: new Date().toISOString() });
    set(KEYS.CONVERSATIONS, convs);
  }
}

// Build the messages array for the API from current session.
// Validates tool_use / tool_result pairing so that corrupted history
// (e.g. from before the tool_result persistence fix) never reaches the API.
export function getApiMessages() {
  const session = getCurrentSession();
  const raw = session.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const result = [];

  for (let i = 0; i < raw.length; i++) {
    const m = raw[i];

    if (m.role === 'user') {
      // Tool-result messages have array content — pass through as-is.
      // Regular text messages — pass through as-is.
      result.push({ role: 'user', content: m.content });

    } else if (m.role === 'assistant') {
      const hasToolUse = m.toolBlocks && m.toolBlocks.some((b) => b.type === 'tool_use');

      if (hasToolUse) {
        // Only emit toolBlocks if the very next message is the matching tool_result.
        // If not (orphaned from old data), emit text-only to avoid the API error:
        //   "tool_use ids found without tool_result blocks immediately after"
        const next = raw[i + 1];
        const nextIsToolResult = next && next.role === 'user' && Array.isArray(next.content);

        if (nextIsToolResult) {
          result.push({ role: 'assistant', content: m.toolBlocks });
        } else {
          // Orphaned tool_use — degrade gracefully to the text portion only
          const text = m.content || m.toolBlocks?.find((b) => b.type === 'text')?.text || '…';
          result.push({ role: 'assistant', content: text });
        }
      } else {
        result.push({ role: 'assistant', content: m.content });
      }
    }
  }

  return result;
}

// ── Reminders ────────────────────────────────────────────────────────────────

export function getReminders() {
  return get(KEYS.REMINDERS) || { version: SCHEMA_VERSION, reminders: [] };
}

export function saveReminders(data) {
  set(KEYS.REMINDERS, { ...data, version: SCHEMA_VERSION });
}

export function addReminder(reminder) {
  const data = getReminders();
  const newReminder = {
    ...reminder,
    id: reminder.id || generateId('rem'),
    active: true,
    lastFired: null,
  };
  data.reminders.push(newReminder);
  saveReminders(data);
  return newReminder;
}

export function updateReminder(reminderId, updates) {
  const data = getReminders();
  const idx = data.reminders.findIndex((r) => r.id === reminderId);
  if (idx >= 0) {
    data.reminders[idx] = { ...data.reminders[idx], ...updates };
    saveReminders(data);
  }
}

// ── Pending Confirmations ────────────────────────────────────────────────────

export function getPendingConfirmations() {
  return get(KEYS.PENDING_CONFIRMATIONS) || [];
}

export function addPendingConfirmation(conf) {
  const list = getPendingConfirmations();
  list.push({ ...conf, requestedAt: new Date().toISOString(), status: 'pending' });
  set(KEYS.PENDING_CONFIRMATIONS, list);
}

export function resolvePendingConfirmation(id, status) {
  const list = getPendingConfirmations();
  const idx = list.findIndex((c) => c.id === id);
  if (idx >= 0) {
    list[idx].status = status;
    list[idx].resolvedAt = new Date().toISOString();
    set(KEYS.PENDING_CONFIRMATIONS, list);
    return list[idx];
  }
  return null;
}

export function clearResolvedConfirmations() {
  const list = getPendingConfirmations().filter((c) => c.status === 'pending');
  set(KEYS.PENDING_CONFIRMATIONS, list);
}

// ── Utilities ────────────────────────────────────────────────────────────────

export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function clearAllData() {
  Object.values(KEYS).forEach(remove);
}

export function exportData() {
  const data = {};
  Object.entries(KEYS).forEach(([name, key]) => {
    data[name] = get(key);
  });
  return JSON.stringify(data, null, 2);
}
