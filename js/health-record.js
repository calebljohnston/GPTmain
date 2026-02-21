// health-record.js — Health data helpers and system prompt builder

import * as storage from './storage.js';

// ── System Prompt ────────────────────────────────────────────────────────────

export function buildSystemPrompt() {
  const record = storage.getHealthRecord();
  const goalsData = storage.getGoals();
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const snapshot = buildHealthSnapshot(record);
  const activeGoals = goalsData.goals.filter((g) => g.status === 'active');
  const activeTasks = goalsData.tasks.filter((t) => t.active);
  const prefs = record.preferences;
  const name = record.demographics?.name || 'there';

  return `You are Vita, a personal health coach and health record keeper. You are warm, encouraging, clinically precise, and evidence-based. You speak in a ${prefs.communicationStyle || 'direct'} and empathetic tone, like a trusted friend who happens to have medical knowledge.

## Your Role
- Help the user understand and improve their health over time
- Maintain an accurate, structured personal health record by using the tools provided
- Set achievable health goals and celebrate progress
- Provide reminders and accountability for healthy habits
- Give personalized coaching based on the user's unique profile

## Critical Rules
1. NEVER update health data without using the appropriate tool. The user must confirm every data change through the UI before it is saved. Do not assume confirmation will be given.
2. NEVER provide specific medical diagnoses or replace a doctor's advice. Always recommend consulting healthcare professionals for medical decisions.
3. When the user mentions a health metric (weight, blood pressure, sleep, etc.), proactively offer to record it using the update_health_record tool.
4. When you notice a goal is close to completion, a streak is building, or progress is happening, acknowledge it enthusiastically.
5. Keep responses conversational and concise. Use markdown sparingly (bold for emphasis, bullet lists only when needed).
6. If the user mentions symptoms that could indicate a medical emergency, always advise seeking immediate medical care FIRST before anything else.
7. Address the user as ${name}.

## Today's Date
${today}

## Current Health Record
${JSON.stringify(snapshot, null, 2)}

## Active Goals (${activeGoals.length})
${activeGoals.length > 0 ? JSON.stringify(activeGoals.map(summarizeGoal), null, 2) : 'No active goals yet.'}

## Active Tasks (${activeTasks.length})
${activeTasks.length > 0 ? JSON.stringify(activeTasks.map(summarizeTask), null, 2) : 'No active tasks yet.'}

## User Preferences
- Communication style: ${prefs.communicationStyle || 'encouraging'}
- Reminder tone: ${prefs.reminderTone || 'encouraging'}
- Units: ${prefs.unitsSystem || 'metric'}
- Preferred check-in time: ${prefs.preferredCheckInTime || '08:00'}

## Memory Instructions
When the user shares information about their lifestyle, habits, preferences, or anything about themselves, use the appropriate tool to save it. This is how you build a relationship over time. Specifically:
- Health metrics → update_health_record
- Goals they express → add_goal
- Daily habits they want to build → add_task
- How they want to be coached → update_preferences
- Lifestyle information (diet, exercise, work, sleep) → update_health_record with category "lifestyle"`;
}

// Build a compact snapshot (latest vitals only, not full history arrays)
function buildHealthSnapshot(record) {
  const snapshot = {
    demographics: { ...record.demographics },
    latestVitals: {},
    conditions: record.conditions.filter((c) => c.status === 'active'),
    medications: record.medications.filter((m) => m.active),
    allergies: record.allergies,
    lifestyle: record.lifestyle,
  };

  // Only latest vital reading per category
  Object.entries(record.vitals || {}).forEach(([key, entries]) => {
    if (entries && entries.length > 0) {
      snapshot.latestVitals[key] = entries[entries.length - 1];
    }
  });

  return snapshot;
}

function summarizeGoal(goal) {
  return {
    id: goal.id,
    title: goal.title,
    category: goal.category,
    targetValue: goal.targetValue,
    targetUnit: goal.targetUnit,
    targetDate: goal.targetDate,
    milestones: goal.milestones?.map((m) => ({ description: m.description, completed: m.completed })),
  };
}

function summarizeTask(task) {
  const today = new Date().toISOString().split('T')[0];
  const completedToday = task.completedDates?.includes(today);
  return {
    id: task.id,
    title: task.title,
    goalId: task.goalId,
    recurrence: task.recurrence,
    dueTime: task.dueTime,
    completedToday,
    currentStreak: calculateStreak(task.completedDates || []),
  };
}

// ── Streak Calculation ───────────────────────────────────────────────────────

export function calculateStreak(completedDates) {
  if (!completedDates || completedDates.length === 0) return 0;
  const sorted = [...completedDates].sort().reverse();
  const today = new Date().toISOString().split('T')[0];
  let streak = 0;
  let checkDate = today;

  for (const date of sorted) {
    if (date === checkDate) {
      streak++;
      const d = new Date(checkDate);
      d.setDate(d.getDate() - 1);
      checkDate = d.toISOString().split('T')[0];
    } else if (date < checkDate) {
      break;
    }
  }

  return streak;
}

// ── Health Record Helpers ────────────────────────────────────────────────────

export function getLatestVital(vitalKey) {
  const record = storage.getHealthRecord();
  const entries = record.vitals?.[vitalKey];
  return entries && entries.length > 0 ? entries[entries.length - 1] : null;
}

export function formatVitalDisplay(vitalKey, entry) {
  if (!entry) return '—';
  const units = { weight: 'kg', restingHeartRate: 'bpm', sleepHours: 'h', bloodGlucose: 'mmol/L' };
  if (vitalKey === 'bloodPressure') {
    return `${entry.systolic}/${entry.diastolic} mmHg`;
  }
  const unit = units[vitalKey] || '';
  return `${entry.value}${unit ? ' ' + unit : ''}`;
}

export function formatAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

export function formatHeight(height) {
  if (!height) return '—';
  if (typeof height === 'object') {
    return `${height.value} ${height.unit}`;
  }
  return height;
}

// ── Tool Execution Handlers ──────────────────────────────────────────────────

export function executeUpdateHealthRecord(input) {
  const { category, field, operation, value } = input;

  if (category === 'vitals' && operation === 'append') {
    return storage.appendVital(field, value);
  }

  if (['conditions', 'medications', 'allergies'].includes(category) && operation === 'append') {
    return storage.upsertListItem(category, value);
  }

  if (['conditions', 'medications', 'allergies'].includes(category) && operation === 'remove') {
    return storage.removeListItem(category, value.id || value);
  }

  if (['conditions', 'medications', 'allergies'].includes(category) && operation === 'set') {
    return storage.upsertListItem(category, value);
  }

  // Set scalar field
  const path = `${category}.${field}`;
  return storage.updateHealthField(path, value);
}

export function executeUpdatePreferences(input) {
  const { preferences } = input;
  const record = storage.getHealthRecord();
  record.preferences = { ...record.preferences, ...preferences };
  storage.saveHealthRecord(record);
  return record;
}
