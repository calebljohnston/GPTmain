// db.js — JSON file storage adapter for Vita SMS server
// Replaces localStorage from the browser app.
// All data is keyed by phone number (E.164 format, e.g. +14155552671).
// Uses plain JSON files — no native compilation required.

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)  // treat DB_PATH dir as data dir
  : path.join(__dirname, '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── JSON file helpers ─────────────────────────────────────────────────────────

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readFile(name) {
  const fp = filePath(name);
  try {
    if (!fs.existsSync(fp)) return {};
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return {};
  }
}

// Atomic write: write to temp file then rename, so crashes don't corrupt data
function writeFile(name, data) {
  const fp = filePath(name);
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, fp);
}

function getStore(name, phone) {
  const store = readFile(name);
  return store[phone] ?? null;
}

function setStore(name, phone, value) {
  const store = readFile(name);
  store[phone] = value;
  writeFile(name, store);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VITAL_HISTORY_DAYS = 90;
const SCHEMA_VERSION = 1;
const MAX_MESSAGES = 60;

// ── Health Records ────────────────────────────────────────────────────────────

function createEmptyHealthRecord() {
  return {
    version: SCHEMA_VERSION,
    lastUpdated: null,
    demographics: {
      name: null, dateOfBirth: null, biologicalSex: null, height: null, bloodType: null,
    },
    vitals: {
      weight: [], bloodPressure: [], restingHeartRate: [], sleepHours: [], bloodGlucose: [],
    },
    conditions: [],
    medications: [],
    allergies: [],
    lifestyle: {
      smokingStatus: null, alcoholConsumption: null, exerciseFrequency: null,
      diet: null, occupation: null, stressLevel: null,
    },
    preferences: {
      communicationStyle: 'encouraging', reminderTone: 'encouraging',
      preferredCheckInTime: '08:00', unitsSystem: 'metric',
    },
  };
}

function getHealthRecord(phone) {
  const stored = getStore('health_records', phone);
  if (!stored) return createEmptyHealthRecord();
  return { ...createEmptyHealthRecord(), ...stored };
}

function saveHealthRecord(phone, record) {
  setStore('health_records', phone, { ...record, lastUpdated: new Date().toISOString() });
}

function appendVital(phone, vitalKey, entry) {
  const record = getHealthRecord(phone);
  if (!record.vitals[vitalKey]) record.vitals[vitalKey] = [];
  record.vitals[vitalKey].push({ ...entry, recordedAt: entry.recordedAt || new Date().toISOString() });

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - VITAL_HISTORY_DAYS);
  record.vitals[vitalKey] = record.vitals[vitalKey].filter(
    (v) => new Date(v.recordedAt) > cutoff
  );

  saveHealthRecord(phone, record);
  return record;
}

function updateHealthField(phone, fieldPath, value) {
  const record = getHealthRecord(phone);
  setNestedValue(record, fieldPath, value);
  saveHealthRecord(phone, record);
  return record;
}

function setNestedValue(obj, fieldPath, value) {
  const parts = fieldPath.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current)) current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

function upsertListItem(phone, field, item) {
  const record = getHealthRecord(phone);
  if (!record[field]) record[field] = [];
  const idx = record[field].findIndex((x) => x.id === item.id);
  if (idx >= 0) {
    record[field][idx] = { ...record[field][idx], ...item };
  } else {
    record[field].push({ ...item, id: item.id || generateId(field) });
  }
  saveHealthRecord(phone, record);
  return record;
}

function removeListItem(phone, field, id) {
  const record = getHealthRecord(phone);
  if (record[field]) {
    record[field] = record[field].filter((x) => x.id !== id);
    saveHealthRecord(phone, record);
  }
  return getHealthRecord(phone);
}

// ── Goals ─────────────────────────────────────────────────────────────────────

function getGoals(phone) {
  return getStore('goals', phone) || { version: SCHEMA_VERSION, goals: [], tasks: [] };
}

function saveGoals(phone, data) {
  setStore('goals', phone, { ...data, version: SCHEMA_VERSION });
}

function addGoal(phone, goal) {
  const data = getGoals(phone);
  const newGoal = {
    ...goal,
    id: goal.id || generateId('goal'),
    status: goal.status || 'active',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    milestones: goal.milestones || [],
  };
  data.goals.push(newGoal);
  saveGoals(phone, data);
  return newGoal;
}

function updateGoal(phone, goalId, updates) {
  const data = getGoals(phone);
  const idx = data.goals.findIndex((g) => g.id === goalId);
  if (idx >= 0) {
    data.goals[idx] = { ...data.goals[idx], ...updates, lastUpdated: new Date().toISOString() };
    saveGoals(phone, data);
    return data.goals[idx];
  }
  return null;
}

function addTask(phone, task) {
  const data = getGoals(phone);
  const newTask = {
    ...task,
    id: task.id || generateId('task'),
    completedDates: [],
    active: true,
    createdAt: new Date().toISOString(),
  };
  data.tasks.push(newTask);
  saveGoals(phone, data);
  return newTask;
}

function markTaskComplete(phone, taskId, date) {
  const data = getGoals(phone);
  const task = data.tasks.find((t) => t.id === taskId);
  if (task) {
    const dateStr = date || new Date().toISOString().split('T')[0];
    if (!task.completedDates.includes(dateStr)) {
      task.completedDates.push(dateStr);
    }
    saveGoals(phone, data);
    return task;
  }
  return null;
}

// ── Conversation Messages ─────────────────────────────────────────────────────

function appendMessage(phone, message) {
  const store = readFile('conversations');
  if (!store[phone]) store[phone] = [];

  const { role, content, toolBlocks } = message;
  const entry = {
    role,
    content: typeof content === 'string' ? content : null,
    toolBlocks: toolBlocks || (Array.isArray(content) ? content : null),
    createdAt: new Date().toISOString(),
  };

  store[phone].push(entry);

  // Prune to MAX_MESSAGES
  if (store[phone].length > MAX_MESSAGES) {
    store[phone] = store[phone].slice(-MAX_MESSAGES);
  }

  writeFile('conversations', store);
}

// Build the API-compatible messages array from stored conversation history.
// Applies the same orphaned-tool-use validation as browser storage.js getApiMessages().
function getApiMessages(phone) {
  const store = readFile('conversations');
  const rows = store[phone] || [];

  const result = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (row.role === 'user') {
      if (row.toolBlocks) {
        // Tool-result message — array content
        result.push({ role: 'user', content: row.toolBlocks });
      } else {
        result.push({ role: 'user', content: row.content });
      }
    } else if (row.role === 'assistant') {
      const hasToolUse = row.toolBlocks && row.toolBlocks.some((b) => b.type === 'tool_use');

      if (hasToolUse) {
        // Only include tool_use blocks if the next message is the matching tool_result.
        // If not (orphaned), degrade to text-only to avoid the API error:
        //   "tool_use ids found without tool_result blocks immediately after"
        const next = rows[i + 1];
        const nextIsToolResult = next && next.role === 'user' && next.toolBlocks;

        if (nextIsToolResult) {
          result.push({ role: 'assistant', content: row.toolBlocks });
        } else {
          const text = row.content || row.toolBlocks.find((b) => b.type === 'text')?.text || '…';
          result.push({ role: 'assistant', content: text });
        }
      } else {
        result.push({ role: 'assistant', content: row.content });
      }
    }
  }

  return result;
}

// ── Pending Confirmations ─────────────────────────────────────────────────────

function savePendingConfirmation(phone, data) {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const store = readFile('pending');
  store[phone] = {
    phoneNumber: phone,
    toolUseId: data.toolUseId,
    toolName: data.toolName,
    toolInput: data.toolInput,
    summary: data.summary,
    allToolCalls: data.allToolCalls,
    expiresAt,
  };
  writeFile('pending', store);
}

function getPendingConfirmation(phone) {
  const store = readFile('pending');
  return store[phone] || null;
}

function deletePendingConfirmation(phone) {
  const store = readFile('pending');
  delete store[phone];
  writeFile('pending', store);
}

// ── Reminders ─────────────────────────────────────────────────────────────────

function addReminder(phone, reminder) {
  const store = readFile('reminders');
  if (!store[phone]) store[phone] = [];

  const id = reminder.id || generateId('rem');
  const entry = {
    id,
    phone_number: phone,
    task_id: reminder.taskId || reminder.task_id || '',
    title: reminder.title,
    scheduled_time: reminder.scheduledTime || reminder.dueTime || '08:00',
    days: JSON.stringify(reminder.days || getDaysForRecurrence(reminder.recurrence)),
    active: 1,
    last_fired_date: null,
  };

  // Replace if same task already has a reminder
  const idx = store[phone].findIndex((r) => r.task_id === entry.task_id);
  if (idx >= 0) {
    store[phone][idx] = entry;
  } else {
    store[phone].push(entry);
  }

  writeFile('reminders', store);
  return entry;
}

function getDaysForRecurrence(recurrence) {
  switch (recurrence) {
    case 'daily': return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    case 'weekdays': return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    case 'weekends': return ['Sat', 'Sun'];
    case 'weekly': {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return [dayNames[new Date().getDay()]];
    }
    default: return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  }
}

function getDueReminders(timeStr, today) {
  const store = readFile('reminders');
  const due = [];
  for (const phone of Object.keys(store)) {
    for (const r of store[phone]) {
      if (r.active && r.scheduled_time === timeStr && r.last_fired_date !== today) {
        due.push(r);
      }
    }
  }
  return due;
}

function markReminderFired(reminderId, today) {
  const store = readFile('reminders');
  for (const phone of Object.keys(store)) {
    const r = store[phone].find((x) => x.id === reminderId);
    if (r) {
      r.last_fired_date = today;
      writeFile('reminders', store);
      return;
    }
  }
}

// ── Sessions ──────────────────────────────────────────────────────────────────

function getSessionState(phone) {
  const store = readFile('sessions');
  const entry = store[phone];
  if (!entry) return 'IDLE';
  // Support both old format (plain string) and new format ({ state, updatedAt })
  return typeof entry === 'object' ? entry.state : entry;
}

function setSessionState(phone, state) {
  const store = readFile('sessions');
  store[phone] = { state, updatedAt: new Date().toISOString() };
  writeFile('sessions', store);
}

// Returns how many milliseconds the session has been in its current state.
// Returns 0 if no timestamp is recorded (old format).
function getSessionAge(phone) {
  const store = readFile('sessions');
  const entry = store[phone];
  if (!entry || typeof entry !== 'object' || !entry.updatedAt) return 0;
  return Date.now() - new Date(entry.updatedAt).getTime();
}

// Called at startup: resets any stuck PROCESSING states to IDLE so the bot
// recovers automatically after a crash or restart.
function resetStuckProcessingStates() {
  const store = readFile('sessions');
  let count = 0;
  for (const phone of Object.keys(store)) {
    const entry = store[phone];
    const state = typeof entry === 'object' ? entry.state : entry;
    if (state === 'PROCESSING') {
      store[phone] = { state: 'IDLE', updatedAt: new Date().toISOString() };
      count++;
    }
  }
  if (count > 0) {
    writeFile('sessions', store);
    console.log(`[db] Reset ${count} stuck PROCESSING session(s) to IDLE on startup`);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function generateId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Health records
  getHealthRecord,
  saveHealthRecord,
  appendVital,
  updateHealthField,
  upsertListItem,
  removeListItem,
  // Goals
  getGoals,
  saveGoals,
  addGoal,
  updateGoal,
  addTask,
  markTaskComplete,
  // Conversations
  appendMessage,
  getApiMessages,
  // Pending confirmations
  savePendingConfirmation,
  getPendingConfirmation,
  deletePendingConfirmation,
  // Reminders
  addReminder,
  getDueReminders,
  markReminderFired,
  // Sessions
  getSessionState,
  setSessionState,
  getSessionAge,
  resetStuckProcessingStates,
  // Utils
  generateId,
  createEmptyHealthRecord,
};
