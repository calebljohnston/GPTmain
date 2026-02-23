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
    days: JSON.stringify(reminder.days || getDaysForCadence(reminder.cadence, reminder.recurrence)),
    active: 1,
    last_fired_date: null,
    consecutive_missed: 0,
    suppressed_until: null,
    created_at: new Date().toISOString().split('T')[0],
  };

  // Replace if same task already has a reminder
  const idx = store[phone].findIndex((r) => r.task_id === entry.task_id);
  if (idx >= 0) {
    store[phone][idx] = { ...store[phone][idx], ...entry };
  } else {
    store[phone].push(entry);
  }

  writeFile('reminders', store);
  return entry;
}

// Compute which days a reminder should fire based on the cadence object or legacy recurrence string
function getDaysForCadence(cadence, legacyRecurrence) {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (cadence) {
    switch (cadence.type) {
      case 'daily': return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      case 'weekdays': return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
      case 'weekends': return ['Sat', 'Sun'];
      case 'weekly': return [dayNames[new Date().getDay()]];
      case 'custom_days': return cadence.days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      case 'every_n_days': return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // interval checked separately
      case 'once': return [dayNames[new Date().getDay()]];
      default: return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    }
  }

  // Legacy recurrence string fallback
  switch (legacyRecurrence) {
    case 'daily': return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    case 'weekdays': return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    case 'weekends': return ['Sat', 'Sun'];
    case 'weekly': return [dayNames[new Date().getDay()]];
    default: return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  }
}

// Returns all active reminders due at timeStr on today that pass smart filters:
// - not suppressed
// - not already fired today
// - not expired (task expiresAt)
// - task not already completed today (suppress redundant reminder)
function getDueReminders(timeStr, today) {
  const store = readFile('reminders');
  const now = new Date();
  const due = [];

  for (const phone of Object.keys(store)) {
    // Load this user's tasks to check completion and expiry
    const goalsData = getGoals(phone);
    const taskMap = {};
    for (const t of goalsData.tasks) taskMap[t.id] = t;

    for (const r of store[phone]) {
      if (!r.active) continue;
      if (r.scheduled_time !== timeStr) continue;
      if (r.last_fired_date === today) continue;

      // Suppression window check
      if (r.suppressed_until && new Date(r.suppressed_until) > now) continue;

      const task = taskMap[r.task_id];
      if (task) {
        // Skip if task has expired
        if (task.expiresAt && new Date(task.expiresAt) < now) continue;

        // Skip if user already completed this task today
        if (task.completedDates && task.completedDates.includes(today)) continue;

        // For every_n_days cadence: check interval from createdAt
        if (task.cadence && task.cadence.type === 'every_n_days') {
          const intervalDays = task.cadence.intervalDays || 1;
          const created = new Date(task.createdAt);
          const daysSinceCreation = Math.floor((now - created) / (1000 * 60 * 60 * 24));
          if (daysSinceCreation % intervalDays !== 0) continue;
        }
      }

      due.push({ ...r, _task: task || null });
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

// Suppress a reminder until a given ISO timestamp (for snooze)
function suppressReminder(reminderId, until) {
  const store = readFile('reminders');
  for (const phone of Object.keys(store)) {
    const r = store[phone].find((x) => x.id === reminderId);
    if (r) {
      r.suppressed_until = until;
      writeFile('reminders', store);
      return true;
    }
  }
  return false;
}

// Find reminder(s) by task_id for a given phone
function getRemindersByTaskId(phone, taskId) {
  const store = readFile('reminders');
  return (store[phone] || []).filter((r) => r.task_id === taskId);
}

// Update reminder fields directly (used by adjust_reminder tool executor)
function updateReminder(phone, reminderId, updates) {
  const store = readFile('reminders');
  if (!store[phone]) return null;
  const idx = store[phone].findIndex((r) => r.id === reminderId);
  if (idx < 0) return null;
  store[phone][idx] = { ...store[phone][idx], ...updates };
  writeFile('reminders', store);
  return store[phone][idx];
}

// Increment consecutive_missed for a reminder (called at midnight for unresponded reminders)
function incrementConsecutiveMissed(reminderId) {
  const store = readFile('reminders');
  for (const phone of Object.keys(store)) {
    const r = store[phone].find((x) => x.id === reminderId);
    if (r) {
      r.consecutive_missed = (r.consecutive_missed || 0) + 1;
      writeFile('reminders', store);
      return r.consecutive_missed;
    }
  }
  return 0;
}

// Reset consecutive_missed when user completes a task (called from markTaskComplete)
function resetConsecutiveMissed(phone, taskId) {
  const store = readFile('reminders');
  if (!store[phone]) return;
  let changed = false;
  for (const r of store[phone]) {
    if (r.task_id === taskId && r.consecutive_missed > 0) {
      r.consecutive_missed = 0;
      changed = true;
    }
  }
  if (changed) writeFile('reminders', store);
}

// Compute 7-day completion rate for a task (0.0–1.0)
// Counts how many of the last N days had a completion
function getTaskCompletionRate(phone, taskId, days = 7) {
  const goalsData = getGoals(phone);
  const task = goalsData.tasks.find((t) => t.id === taskId);
  if (!task || !task.completedDates) return null;

  const completed = new Set(task.completedDates);
  let hits = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    if (completed.has(d.toISOString().split('T')[0])) hits++;
  }
  return hits / days;
}

// Build an engagement summary for all active tasks for a user.
// Used by buildSystemPrompt() to give Claude fatigue/progress context.
function getEngagementSummary(phone) {
  const goalsData = getGoals(phone);
  const reminderStore = readFile('reminders');
  const userReminders = reminderStore[phone] || [];
  const reminderMap = {};
  for (const r of userReminders) reminderMap[r.task_id] = r;

  return goalsData.tasks
    .filter((t) => t.active)
    .map((t) => {
      const rate7d = getTaskCompletionRate(phone, t.id, 7);
      const reminder = reminderMap[t.id];
      return {
        taskId: t.id,
        title: t.title,
        completionRate7d: rate7d !== null ? Math.round(rate7d * 100) : null,
        consecutiveMissed: reminder ? (reminder.consecutive_missed || 0) : 0,
        suppressed: reminder && reminder.suppressed_until && new Date(reminder.suppressed_until) > new Date(),
        expiresAt: t.expiresAt || null,
        minimumCadenceDays: t.minimumCadenceDays || null,
        lastCompleted: t.completedDates?.slice(-1)[0] || null,
      };
    });
}

// Get all tasks with minimumCadenceDays that are overdue for a nudge
function getMinCadenceOverdueTasks(phone) {
  const goalsData = getGoals(phone);
  const today = new Date();
  const overdue = [];

  for (const task of goalsData.tasks) {
    if (!task.active || !task.minimumCadenceDays) continue;
    const lastDate = task.completedDates?.slice(-1)[0];
    if (!lastDate) {
      // Never completed — check days since creation
      const created = new Date(task.createdAt);
      const daysSince = Math.floor((today - created) / (1000 * 60 * 60 * 24));
      if (daysSince >= task.minimumCadenceDays) overdue.push({ task, daysSince });
    } else {
      const last = new Date(lastDate);
      const daysSince = Math.floor((today - last) / (1000 * 60 * 60 * 24));
      if (daysSince >= task.minimumCadenceDays) overdue.push({ task, daysSince });
    }
  }

  return overdue;
}

// ── Document Extractions ──────────────────────────────────────────────────────

// Append an AI extraction audit record.
// Stores metadata + extracted data — never the raw image bytes.
function saveDocumentExtraction(phone, extraction) {
  const store = readFile('document_extractions');
  if (!store[phone]) store[phone] = [];
  store[phone].push(extraction);
  // Cap at 200 per user (well beyond practical use)
  if (store[phone].length > 200) store[phone] = store[phone].slice(-200);
  writeFile('document_extractions', store);
  return extraction;
}

// Return all extraction audit records for a user, newest-last.
function getDocumentExtractions(phone) {
  const store = readFile('document_extractions');
  return store[phone] || [];
}

// Get all phone numbers that have reminders (used by reminders.js for nudge pass)
function getAllPhonesWithReminders() {
  const store = readFile('reminders');
  return Object.keys(store);
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

// Returns an array of phone/chatId strings where state === 'PROCESSING'
// and the session has been in that state longer than thresholdMs.
// Used by the proactive sweep in server.js to reset hung sessions without
// requiring an inbound message to trigger the check.
function getStuckProcessingSessions(thresholdMs) {
  const store = readFile('sessions');
  const now = Date.now();
  return Object.entries(store)
    .filter(([, entry]) => {
      const state = typeof entry === 'object' ? entry.state : entry;
      if (state !== 'PROCESSING') return false;
      if (!entry || typeof entry !== 'object' || !entry.updatedAt) return false;
      return (now - new Date(entry.updatedAt).getTime()) > thresholdMs;
    })
    .map(([phone]) => phone);
}

// ── Default Program Goals ─────────────────────────────────────────────────────
// Seeds three core goals + six tasks for every user on first interaction.
// Idempotent: checks for any goal with source === 'system' before writing.
// Baseline tasks are auto-completed if the user already has that data on file.

function ensureDefaultGoals(phone) {
  const data = getGoals(phone);
  const record = getHealthRecord(phone);

  // Already seeded — skip (check for any system-sourced goal)
  if (data.goals.some((g) => g.source === 'system')) return;

  const now   = new Date().toISOString();
  const today = now.split('T')[0];

  // ── Goal 1: Blood Pressure Monitoring ──────────────────────────────────────
  const bpGoalId      = generateId('goal');
  const bpBaselineDone = (record.vitals?.bloodPressure?.length > 0);

  data.goals.push({
    id: bpGoalId, title: 'Blood Pressure Monitoring',
    category: 'custom', source: 'system',
    description: 'Track blood pressure consistently for a clear picture of cardiovascular health.',
    targetValue: null, targetUnit: null, targetDate: null,
    status: 'active', milestones: [], createdAt: now, lastUpdated: now,
  });

  data.tasks.push({
    id: generateId('task'), title: 'Share a baseline blood pressure reading',
    goalId: bpGoalId, type: 'measurement', source: 'system',
    cadence: { type: 'once' }, recurrence: 'once',
    dueTime: null, scheduleReminder: false, expiresAt: null,
    minimumCadenceDays: null, active: !bpBaselineDone,
    completedDates: bpBaselineDone ? [today] : [],
    createdAt: now,
  });

  data.tasks.push({
    id: generateId('task'), title: 'Log blood pressure daily',
    goalId: bpGoalId, type: 'measurement', source: 'system',
    cadence: { type: 'daily' }, recurrence: 'daily',
    dueTime: null, scheduleReminder: false, expiresAt: null,
    minimumCadenceDays: 7, active: true, completedDates: [], createdAt: now,
  });

  // ── Goal 2: Weight Tracking ─────────────────────────────────────────────────
  const wtGoalId      = generateId('goal');
  const wtBaselineDone = (record.vitals?.weight?.length > 0);

  data.goals.push({
    id: wtGoalId, title: 'Weight Tracking',
    category: 'weight', source: 'system',
    description: 'Establish a weight baseline and check in weekly to monitor trends.',
    targetValue: null, targetUnit: null, targetDate: null,
    status: 'active', milestones: [], createdAt: now, lastUpdated: now,
  });

  data.tasks.push({
    id: generateId('task'), title: 'Share a baseline weight',
    goalId: wtGoalId, type: 'measurement', source: 'system',
    cadence: { type: 'once' }, recurrence: 'once',
    dueTime: null, scheduleReminder: false, expiresAt: null,
    minimumCadenceDays: null, active: !wtBaselineDone,
    completedDates: wtBaselineDone ? [today] : [],
    createdAt: now,
  });

  data.tasks.push({
    id: generateId('task'), title: 'Log weight weekly',
    goalId: wtGoalId, type: 'measurement', source: 'system',
    cadence: { type: 'weekly' }, recurrence: 'weekly',
    dueTime: null, scheduleReminder: false, expiresAt: null,
    minimumCadenceDays: 30, active: true, completedDates: [], createdAt: now,
  });

  // ── Goal 3: Annual Lab Work ─────────────────────────────────────────────────
  const labGoalId       = generateId('goal');
  const labBaselineDone = (record.vitals?.labResults?.length > 0);

  data.goals.push({
    id: labGoalId, title: 'Annual Lab Work',
    category: 'lab_values', source: 'system',
    description: 'Get a routine lab panel done annually and share results with Vita.',
    targetValue: null, targetUnit: null, targetDate: null,
    status: 'active', milestones: [], createdAt: now, lastUpdated: now,
  });

  data.tasks.push({
    id: generateId('task'), title: 'Share baseline lab results with Vita',
    goalId: labGoalId, type: 'check', source: 'system',
    cadence: { type: 'once' }, recurrence: 'once',
    dueTime: null, scheduleReminder: false, expiresAt: null,
    minimumCadenceDays: null, active: !labBaselineDone,
    completedDates: labBaselineDone ? [today] : [],
    createdAt: now,
  });

  data.tasks.push({
    id: generateId('task'), title: 'Get annual labs done',
    goalId: labGoalId, type: 'check', source: 'system',
    cadence: { type: 'every_n_days', intervalDays: 365 }, recurrence: 'every_n_days',
    dueTime: null, scheduleReminder: false, expiresAt: null,
    minimumCadenceDays: 365, active: true, completedDates: [], createdAt: now,
  });

  saveGoals(phone, data);
  console.log(`[db] Seeded default program goals for ${phone}`);
}

// ── System Nudge State ────────────────────────────────────────────────────────
// Tracks the last time each system-level nudge (BP, weight, medication check-in)
// was sent per user. Stored in system_nudges.json — separate from user-managed reminders.

function getAllHealthRecordPhones() {
  const store = readFile('health_records');
  return Object.keys(store);
}

// Returns the recordedAt ISO string of the most recent entry for a vital, or null.
function getLastVitalDate(phone, vitalKey) {
  const record = getHealthRecord(phone);
  const entries = (record.vitals && record.vitals[vitalKey]) || [];
  if (!entries.length) return null;
  // appendVital always appends in order, so the last element is the most recent
  return entries[entries.length - 1].recordedAt || null;
}

function getSystemNudgeState(phone) {
  const store = readFile('system_nudges');
  return store[phone] || {};
}

function setSystemNudgeState(phone, key, dateStr) {
  const store = readFile('system_nudges');
  if (!store[phone]) store[phone] = {};
  store[phone][key] = dateStr;
  writeFile('system_nudges', store);
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
  ensureDefaultGoals,
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
  suppressReminder,
  getRemindersByTaskId,
  updateReminder,
  incrementConsecutiveMissed,
  resetConsecutiveMissed,
  getTaskCompletionRate,
  getEngagementSummary,
  getMinCadenceOverdueTasks,
  getAllPhonesWithReminders,
  // Document extractions
  saveDocumentExtraction,
  getDocumentExtractions,
  // System nudges
  getAllHealthRecordPhones,
  getLastVitalDate,
  getSystemNudgeState,
  setSystemNudgeState,
  // Sessions
  getSessionState,
  setSessionState,
  getSessionAge,
  resetStuckProcessingStates,
  getStuckProcessingSessions,
  // Utils
  generateId,
  createEmptyHealthRecord,
};
