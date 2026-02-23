// vita-core.js — Port of health-record.js + goals.js + tools.js
// All functions take (phoneNumber, db) parameters instead of using localStorage.
// No browser/DOM dependencies.

'use strict';

// ── Tool Definitions (sent to Anthropic API) ──────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: 'update_health_record',
    description:
      'Add or update a structured health data point in the personal health record. Use when the user mentions a measurement, diagnosis, medication, allergy, or any objective health fact. This queues a confirmation before data is saved.',
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['vitals', 'demographics', 'conditions', 'medications', 'allergies', 'lifestyle'],
          description: 'Top-level category of the health record to update',
        },
        field: {
          type: 'string',
          description:
            'Specific field within the category. For vitals: weight, bloodPressure, restingHeartRate, sleepHours, bloodGlucose. For demographics: name, dateOfBirth, biologicalSex, height, bloodType. For lifestyle: smokingStatus, alcoholConsumption, exerciseFrequency, diet, occupation, stressLevel.',
        },
        operation: {
          type: 'string',
          enum: ['set', 'append', 'remove'],
          description:
            'set: overwrite a scalar field. append: add to a time-series or list. remove: delete an item by id.',
        },
        value: {
          description:
            'The value to set or append. For time-series vitals, include recordedAt ISO timestamp. For conditions/medications/allergies, include full object with name and relevant fields.',
        },
        human_readable_summary: {
          type: 'string',
          description:
            "Clear plain-English description shown to user before they confirm. E.g. 'Record your weight as 82.5 kg at 7:00 AM today'",
        },
      },
      required: ['category', 'field', 'operation', 'value', 'human_readable_summary'],
    },
  },
  {
    name: 'add_goal',
    description:
      'Create a new health goal. Use when the user expresses wanting to achieve something health-related. Requires confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short, motivating goal title' },
        category: {
          type: 'string',
          enum: ['weight', 'fitness', 'nutrition', 'sleep', 'mental_health', 'medication', 'lab_values', 'custom'],
        },
        description: { type: 'string', description: 'Detailed goal description' },
        target_value: { type: 'number', description: 'Numeric target if applicable' },
        target_unit: { type: 'string', description: 'Unit of the target value' },
        target_date: { type: 'string', description: 'ISO date for goal deadline (YYYY-MM-DD)' },
        milestones: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              target_value: { type: 'number' },
            },
            required: ['description'],
          },
        },
        human_readable_summary: { type: 'string' },
      },
      required: ['title', 'category', 'human_readable_summary'],
    },
  },
  {
    name: 'add_task',
    description:
      'Add a recurring or one-time task linked to a goal. Tasks are actionable daily behaviors. Requires confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        goal_id: { type: 'string', description: 'ID of the parent goal, or omit if standalone' },
        type: {
          type: 'string',
          enum: ['habit', 'check', 'medication', 'measurement', 'appointment', 'custom'],
          description: 'Classification of the task type',
        },
        recurrence: {
          type: 'string',
          enum: ['daily', 'weekdays', 'weekends', 'weekly', 'once'],
          description: 'Simple recurrence — prefer cadence for custom schedules',
        },
        cadence: {
          type: 'object',
          description: 'Rich scheduling cadence. Use instead of recurrence for custom days or intervals.',
          properties: {
            type: {
              type: 'string',
              enum: ['daily', 'weekdays', 'weekends', 'custom_days', 'every_n_days', 'weekly', 'once'],
            },
            days: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required for custom_days: e.g. ["Mon", "Wed", "Fri"]',
            },
            intervalDays: {
              type: 'integer',
              description: 'Required for every_n_days: fires every N days from creation date',
            },
          },
          required: ['type'],
        },
        due_time: {
          type: 'string',
          description: 'HH:MM in 24h format for the reminder time (e.g. "08:00")',
        },
        schedule_reminder: {
          type: 'boolean',
          description: 'Whether to schedule a Telegram reminder message',
        },
        expires_at: {
          type: 'string',
          description: 'ISO date (YYYY-MM-DD) after which the reminder deactivates. Omit for indefinite.',
        },
        minimum_cadence_days: {
          type: 'integer',
          description: 'Vita nudges the user if this many days pass without completing the task (e.g. 30 for monthly checks).',
        },
        human_readable_summary: { type: 'string' },
      },
      required: ['title', 'human_readable_summary'],
    },
  },
  {
    name: 'update_goal_status',
    description:
      'Mark a goal as completed, paused, or cancelled. Or record a milestone completion. Requires confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        goal_id: { type: 'string' },
        new_status: {
          type: 'string',
          enum: ['active', 'completed', 'paused', 'cancelled'],
        },
        milestone_id: {
          type: 'string',
          description: 'If provided, marks this milestone complete instead of the whole goal',
        },
        human_readable_summary: { type: 'string' },
      },
      required: ['goal_id', 'new_status', 'human_readable_summary'],
    },
  },
  {
    name: 'update_preferences',
    description:
      'Remember user coaching preferences and communication style. Use when user expresses how they want to be coached. Requires confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        preferences: {
          type: 'object',
          properties: {
            communicationStyle: {
              type: 'string',
              enum: ['encouraging', 'direct', 'clinical', 'casual'],
            },
            reminderTone: {
              type: 'string',
              enum: ['gentle', 'encouraging', 'firm', 'neutral'],
            },
            preferredCheckInTime: { type: 'string' },
            unitsSystem: { type: 'string', enum: ['metric', 'imperial'] },
          },
        },
        human_readable_summary: { type: 'string' },
      },
      required: ['preferences', 'human_readable_summary'],
    },
  },
  {
    name: 'mark_task_complete',
    description:
      'Record that the user completed a task today. No confirmation required — quick low-stakes action.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        completed_date: {
          type: 'string',
          description: 'ISO date string (YYYY-MM-DD), defaults to today',
        },
        note: { type: 'string', description: 'Optional note about how it went' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'adjust_reminder',
    description:
      'Modify an existing reminder or task schedule. Use when user asks to snooze, skip today, pause, resume, or change the time/frequency of a reminder. Requires confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'ID of the task whose reminder to adjust' },
        action: {
          type: 'string',
          enum: ['snooze', 'skip_today', 'change_time', 'pause', 'resume', 'change_frequency'],
        },
        new_time: { type: 'string', description: 'New HH:MM for change_time action' },
        new_cadence: {
          type: 'object',
          description: 'New cadence object for change_frequency action',
          properties: {
            type: { type: 'string' },
            days: { type: 'array', items: { type: 'string' } },
            intervalDays: { type: 'integer' },
          },
        },
        snooze_hours: { type: 'number', description: 'Hours to snooze (default 2) for snooze action' },
        human_readable_summary: { type: 'string' },
      },
      required: ['task_id', 'action', 'human_readable_summary'],
    },
  },
  {
    name: 'process_health_document',
    description:
      'Extract structured health data from a photo or document the user has shared. ' +
      'Skin photos: describe what you observe — do NOT diagnose. ' +
      'Medication bottles: read drug name, dosage, frequency, refills, prescriber from the label. ' +
      'Lab reports: capture every test result with value, unit, reference range, and flag. ' +
      'AVS documents: capture all listed diagnoses, medication changes, vitals, follow-up instructions. ' +
      'Always call this tool, even if only partial data is visible. Requires confirmation before saving.',
    input_schema: {
      type: 'object',
      properties: {
        document_type: {
          type: 'string',
          enum: ['skin_photo', 'medication_bottle', 'lab_report', 'avs', 'prescription',
                 'other_medical_image', 'other_document'],
          description: 'What kind of image or document was shared',
        },
        extracted_data: {
          type: 'object',
          description: 'Structured health data extracted from the document. Only include clearly readable values.',
          properties: {
            medications: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name:       { type: 'string' },
                  dosage:     { type: 'string' },
                  frequency:  { type: 'string' },
                  prescriber: { type: 'string' },
                },
                required: ['name'],
              },
            },
            conditions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name:       { type: 'string' },
                  icd_code:   { type: 'string' },
                  noted_date: { type: 'string' },
                },
                required: ['name'],
              },
            },
            allergies: {
              type: 'array',
              items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
            },
            lab_results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  test_name:       { type: 'string' },
                  value:           { type: 'string' },
                  unit:            { type: 'string' },
                  reference_range: { type: 'string' },
                  flag:            { type: 'string', enum: ['normal', 'high', 'low', 'critical', 'unknown'] },
                  collected_at:    { type: 'string', description: 'Date from the document (YYYY-MM-DD or as printed)' },
                },
                required: ['test_name', 'value'],
              },
            },
            follow_up_instructions: {
              type: 'array',
              items: { type: 'string' },
              description: 'Follow-up instructions from AVS or clinical notes',
            },
            next_appointment: {
              type: 'object',
              properties: {
                date:     { type: 'string' },
                provider: { type: 'string' },
                reason:   { type: 'string' },
              },
            },
            observations: {
              type: 'string',
              description: 'For skin/wound photos: plain visual description (color, texture, location). No diagnosis.',
            },
          },
        },
        summary_for_user: {
          type: 'string',
          description:
            'Plain-language summary shown to the user before they confirm. ' +
            'Must be factual, not diagnostic. ' +
            'E.g. "Lab report shows HbA1c 6.2% (Jan 15)" not "your HbA1c suggests pre-diabetes."',
        },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'How clearly readable the document was',
        },
        could_not_extract: {
          type: 'string',
          description: 'Anything that was blurry, cut off, or could not be reliably read',
        },
        human_readable_summary: {
          type: 'string',
          description: 'Same as summary_for_user — used by the confirmation system',
        },
      },
      required: ['document_type', 'extracted_data', 'summary_for_user', 'human_readable_summary'],
    },
  },
  {
    name: 'get_health_summary',
    description:
      'Retrieve a computed summary of health trends, goal progress, or streak data. Use when the user asks about their progress or trends.',
    input_schema: {
      type: 'object',
      properties: {
        summary_type: {
          type: 'string',
          enum: ['weight_trend', 'sleep_trend', 'goal_progress', 'task_streaks', 'full_overview'],
        },
        period_days: {
          type: 'integer',
          description: 'Number of past days to analyze (default: 30)',
        },
      },
      required: ['summary_type'],
    },
  },
];

// ── Confirmation requirement map ──────────────────────────────────────────────

const REQUIRES_CONFIRMATION = {
  update_health_record: true,
  add_goal: true,
  add_task: true,
  update_goal_status: true,
  update_preferences: true,
  mark_task_complete: false,
  get_health_summary: false,
  adjust_reminder: true,
  process_health_document: true,
};

function requiresConfirmation(toolName) {
  return REQUIRES_CONFIRMATION[toolName] ?? true;
}

// ── System Prompt Builder ─────────────────────────────────────────────────────

function buildSystemPrompt(phone, db) {
  const record = db.getHealthRecord(phone);
  const goalsData = db.getGoals(phone);
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const snapshot = buildHealthSnapshot(record);
  const activeGoals = goalsData.goals.filter((g) => g.status === 'active');
  const activeTasks = goalsData.tasks.filter((t) => t.active);
  const prefs = record.preferences;
  const name = record.demographics?.name || 'there';

  // Build engagement map (completion rates, consecutive missed, etc.)
  const engagementList = db.getEngagementSummary ? db.getEngagementSummary(phone) : [];
  const engMap = {};
  for (const e of engagementList) engMap[e.taskId] = e;
  const taskSummaries = activeTasks.length > 0
    ? JSON.stringify(activeTasks.map((t) => summarizeTask(t, engMap[t.id])), null, 2)
    : 'No active tasks yet.';

  // Onboarding section — only shown when foundational data is still missing
  const missingItems = [
    !record.vitals.bloodPressure?.length && 'a baseline blood pressure reading',
    !record.vitals.weight?.length        && 'a baseline weight',
    !record.vitals.labResults?.length    && "lab results — Vita doesn't have any on file yet; if you've had recent labs, a photo of the printout is all it takes",
  ].filter(Boolean);
  const onboardingSection = missingItems.length > 0
    ? `\n## Onboarding Priorities\nVita is still missing: ${missingItems.join('; ')}. Work these into the conversation naturally — not all at once. These data points make Vita significantly more useful.`
    : '';

  return `You are Vita, a personal health coach and health record keeper. You are warm, encouraging, clinically precise, and evidence-based. You speak in a ${prefs.communicationStyle || 'direct'} and empathetic tone, like a trusted friend who happens to have medical knowledge.

## Your Role
- Help the user understand and improve their health over time
- Maintain an accurate, structured personal health record by using the tools provided
- Set achievable health goals and celebrate progress
- Provide reminders and accountability for healthy habits
- Give personalized coaching based on the user's unique profile

## Critical Rules
1. NEVER update health data without using the appropriate tool. The user must confirm every data change via SMS reply before it is saved. Do not assume confirmation will be given.
2. NEVER provide specific medical diagnoses or replace a doctor's advice. Always recommend consulting healthcare professionals for medical decisions.
3. When the user mentions a health metric (weight, blood pressure, sleep, etc.), proactively offer to record it using the update_health_record tool.
4. When you notice a goal is close to completion, a streak is building, or progress is happening, acknowledge it enthusiastically.
5. If the user mentions symptoms that could indicate a medical emergency, always advise seeking immediate medical care FIRST before anything else.
6. Address the user as ${name}.

## Today's Date
${today}

## Current Health Record
${JSON.stringify(snapshot, null, 2)}

## Active Goals (${activeGoals.length})
${activeGoals.length > 0 ? JSON.stringify(activeGoals.map(summarizeGoal), null, 2) : 'No active goals yet.'}

All goals listed above are this user's active goals — present them as such. Goals seeded at enrollment (source: "system") are program defaults that belong to this user just as much as any they create themselves. Never say the user has no goals or no active goals if this section is non-empty. After presenting the goals list, invite the user to share any additional personal health goals they want to work toward.

## Active Tasks (${activeTasks.length})
${taskSummaries}

## User Preferences
- Communication style: ${prefs.communicationStyle || 'encouraging'}
- Reminder tone: ${prefs.reminderTone || 'encouraging'}
- Units: ${prefs.unitsSystem || 'metric'}
- Preferred check-in time: ${prefs.preferredCheckInTime || '08:00'}

## Memory Instructions
When the user shares information about their lifestyle, habits, preferences, or anything about themselves, use the appropriate tool to save it. Specifically:
- Health metrics → update_health_record
- Goals they express → add_goal
- Daily habits they want to build → add_task
- How they want to be coached → update_preferences
- Lifestyle information (diet, exercise, work, sleep) → update_health_record with category "lifestyle"

## Messaging Mode
You are responding via Telegram on the user's phone — write like a text message, not an email.
- 1–3 short sentences by default. If the user asks for more detail, expand.
- No markdown, no bullet lists, no headers — plain text only.
- One thought per reply.
- When recording data, call the tool — the system sends the YES/NO prompt automatically.

## Image and Document Processing
When the user sends a photo or document, always call process_health_document — even with partial data.
- Skin photos: describe what is visually observable (color, texture, location). Never say "this looks like [condition]." — only "I can see..." or "the image shows..."
- Medication bottles: read drug name, dosage, frequency, refills, and prescriber from the label exactly as printed.
- Lab reports: extract every listed test result with its value, unit, reference range, and flag.
- AVS documents: extract all listed diagnoses, medication changes, vitals, and follow-up instructions.
- Note anything unclear or cut off in could_not_extract.
- summary_for_user must be factual, never diagnostic: "Lab report lists HbA1c 6.2%" not "your HbA1c suggests pre-diabetes."
- Do NOT make medical diagnoses or definitive clinical interpretations — describe only what is printed or visually present.${onboardingSection}`;
}

function buildHealthSnapshot(record) {
  const snapshot = {
    demographics: { ...record.demographics },
    latestVitals: {},
    conditions: record.conditions.filter((c) => c.status === 'active'),
    medications: record.medications.filter((m) => m.active),
    allergies: record.allergies,
    lifestyle: record.lifestyle,
  };

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
    source: goal.source || 'user',
    title: goal.title,
    category: goal.category,
    targetValue: goal.targetValue,
    targetUnit: goal.targetUnit,
    targetDate: goal.targetDate,
    milestones: goal.milestones?.map((m) => ({ description: m.description, completed: m.completed })),
  };
}

function summarizeTask(task, engagement) {
  const today = new Date().toISOString().split('T')[0];
  const completedToday = task.completedDates?.includes(today);
  const summary = {
    id: task.id,
    source: task.source || 'user',
    title: task.title,
    goalId: task.goalId,
    cadence: task.cadence || { type: task.recurrence || 'daily' },
    dueTime: task.dueTime,
    completedToday,
    currentStreak: calculateStreak(task.completedDates || []),
  };
  if (engagement) {
    if (engagement.completionRate7d !== null) summary.completionRate7d = `${engagement.completionRate7d}%`;
    if (engagement.consecutiveMissed > 0) summary.consecutiveMissed = engagement.consecutiveMissed;
    if (engagement.suppressed) summary.suppressedUntilToday = true;
    if (task.minimumCadenceDays) summary.minimumCadenceDays = task.minimumCadenceDays;
    if (task.expiresAt) summary.expiresAt = task.expiresAt;
  }
  return summary;
}

// ── Streak Calculation ────────────────────────────────────────────────────────

function calculateStreak(completedDates) {
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

// ── Tool Executors ────────────────────────────────────────────────────────────

function executeUpdateHealthRecord(input, phone, db) {
  const { category, field, operation, value } = input;

  if (category === 'vitals' && operation === 'append') {
    return db.appendVital(phone, field, value);
  }

  if (['conditions', 'medications', 'allergies'].includes(category) && operation === 'append') {
    return db.upsertListItem(phone, category, value);
  }

  if (['conditions', 'medications', 'allergies'].includes(category) && operation === 'remove') {
    return db.removeListItem(phone, category, value.id || value);
  }

  if (['conditions', 'medications', 'allergies'].includes(category) && operation === 'set') {
    return db.upsertListItem(phone, category, value);
  }

  const path = `${category}.${field}`;
  return db.updateHealthField(phone, path, value);
}

function executeUpdatePreferences(input, phone, db) {
  const { preferences } = input;
  const record = db.getHealthRecord(phone);
  record.preferences = { ...record.preferences, ...preferences };
  db.saveHealthRecord(phone, record);
  return record;
}

function executeAddGoal(input, phone, db) {
  const goal = {
    id: db.generateId('goal'),
    title: input.title,
    category: input.category,
    description: input.description || '',
    targetValue: input.target_value ?? null,
    targetUnit: input.target_unit ?? null,
    targetDate: input.target_date ?? null,
    status: 'active',
    milestones: (input.milestones || []).map((m, i) => ({
      id: db.generateId('ms'),
      description: m.description,
      targetValue: m.target_value ?? null,
      completed: false,
      completedAt: null,
      order: i,
    })),
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
  return db.addGoal(phone, goal);
}

function executeAddTask(input, phone, db) {
  const cadence = input.cadence || (input.recurrence ? { type: input.recurrence } : { type: 'daily' });
  const task = {
    id: db.generateId('task'),
    title: input.title,
    goalId: input.goal_id || null,
    type: input.type || 'habit',
    recurrence: cadence.type,  // keep legacy field in sync
    cadence,
    dueTime: input.due_time || null,
    scheduleReminder: input.schedule_reminder !== false,
    expiresAt: input.expires_at || null,
    minimumCadenceDays: input.minimum_cadence_days || null,
    completedDates: [],
    active: true,
    createdAt: new Date().toISOString(),
  };
  const saved = db.addTask(phone, task);

  // Auto-schedule a reminder if requested and a time is provided
  if (saved.scheduleReminder && saved.dueTime) {
    db.addReminder(phone, {
      taskId: saved.id,
      title: saved.title,
      scheduledTime: saved.dueTime,
      recurrence: saved.recurrence,
      cadence: saved.cadence,
    });
  }

  return saved;
}

function executeAdjustReminder(input, phone, db) {
  const { task_id, action, new_time, new_cadence, snooze_hours } = input;
  const reminders = db.getRemindersByTaskId(phone, task_id);
  const reminder = reminders[0] || null;
  const goalsData = db.getGoals(phone);
  const task = goalsData.tasks.find((t) => t.id === task_id) || null;

  switch (action) {
    case 'snooze': {
      if (!reminder) return { error: 'No reminder found for this task' };
      const hours = snooze_hours || 2;
      const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
      db.suppressReminder(reminder.id, until);
      return { success: true, action: 'snoozed', snooze_until: until };
    }

    case 'skip_today': {
      if (!reminder) return { error: 'No reminder found for this task' };
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      db.suppressReminder(reminder.id, endOfDay.toISOString());
      return { success: true, action: 'skipped_today' };
    }

    case 'change_time': {
      if (!reminder || !new_time) return { error: 'Missing reminder or new_time' };
      db.updateReminder(phone, reminder.id, { scheduled_time: new_time });
      return { success: true, action: 'changed_time', new_time };
    }

    case 'pause': {
      if (reminder) db.updateReminder(phone, reminder.id, { active: 0 });
      if (task) {
        const data = db.getGoals(phone);
        const t = data.tasks.find((x) => x.id === task_id);
        if (t) { t.active = false; db.saveGoals(phone, data); }
      }
      return { success: true, action: 'paused' };
    }

    case 'resume': {
      if (reminder) db.updateReminder(phone, reminder.id, { active: 1, suppressed_until: null });
      if (task) {
        const data = db.getGoals(phone);
        const t = data.tasks.find((x) => x.id === task_id);
        if (t) { t.active = true; db.saveGoals(phone, data); }
      }
      return { success: true, action: 'resumed' };
    }

    case 'change_frequency': {
      if (!new_cadence) return { error: 'Missing new_cadence' };
      // Update task cadence
      const data = db.getGoals(phone);
      const t = data.tasks.find((x) => x.id === task_id);
      if (t) {
        t.cadence = new_cadence;
        t.recurrence = new_cadence.type;
        db.saveGoals(phone, data);
      }
      // Update reminder days to match new cadence
      if (reminder) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayMap = {
          daily: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
          weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
          weekends: ['Sat', 'Sun'],
          weekly: [dayNames[new Date().getDay()]],
          custom_days: new_cadence.days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
          every_n_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
          once: [dayNames[new Date().getDay()]],
        };
        const days = dayMap[new_cadence.type] || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        db.updateReminder(phone, reminder.id, { days: JSON.stringify(days) });
      }
      return { success: true, action: 'changed_frequency', new_cadence };
    }

    default:
      return { error: `Unknown action: ${action}` };
  }
}

function executeUpdateGoalStatus(input, phone, db) {
  const { goal_id, new_status, milestone_id } = input;

  if (milestone_id) {
    const data = db.getGoals(phone);
    const goal = data.goals.find((g) => g.id === goal_id);
    if (goal) {
      const ms = goal.milestones?.find((m) => m.id === milestone_id);
      if (ms) {
        ms.completed = true;
        ms.completedAt = new Date().toISOString();
        db.saveGoals(phone, data);
        return goal;
      }
    }
    return null;
  }

  return db.updateGoal(phone, goal_id, {
    status: new_status,
    completedAt: new_status === 'completed' ? new Date().toISOString() : null,
  });
}

function executeMarkTaskComplete(input, phone, db) {
  return db.markTaskComplete(phone, input.task_id, input.completed_date);
}

function executeProcessHealthDocument(input, phone, db) {
  const { document_type, extracted_data, confidence, could_not_extract, summary_for_user } = input;

  const extractionId = db.generateId('doc');
  const src = { source: 'ai_extracted', extractionId };

  // Save audit record — no image bytes, just structured results
  db.saveDocumentExtraction(phone, {
    id: extractionId,
    documentType: document_type,
    extractedAt: new Date().toISOString(),
    confidence: confidence || 'medium',
    couldNotExtract: could_not_extract || null,
    summaryForUser: summary_for_user,
    data: extracted_data,
  });

  // Promote extracted data into health record using existing helpers.
  // Each item is tagged with source: 'ai_extracted' so it's distinguishable from
  // manually-entered data. This runs only after user says YES (confirm-required tool).

  for (const med of extracted_data.medications || []) {
    db.upsertListItem(phone, 'medications', { ...med, active: true, ...src });
  }
  for (const cond of extracted_data.conditions || []) {
    db.upsertListItem(phone, 'conditions', { ...cond, status: 'active', ...src });
  }
  for (const allergy of extracted_data.allergies || []) {
    db.upsertListItem(phone, 'allergies', { ...allergy, ...src });
  }
  for (const lab of extracted_data.lab_results || []) {
    db.appendVital(phone, 'labResults', {
      testName: lab.test_name,
      value: lab.value,
      unit: lab.unit || null,
      referenceRange: lab.reference_range || null,
      flag: lab.flag || 'unknown',
      recordedAt: lab.collected_at || new Date().toISOString(),
      ...src,
    });
  }

  return { success: true, extractionId };
}

function computeGoalProgress(goal, phone, db) {
  if (!goal.targetValue) return null;

  const record = db.getHealthRecord(phone);
  const vitalMap = { weight: 'weight', fitness: null, sleep: 'sleepHours' };
  const vitalKey = vitalMap[goal.category];
  if (!vitalKey) return null;

  const vitals = record.vitals?.[vitalKey];
  if (!vitals || vitals.length === 0) return null;

  const latest = vitals[vitals.length - 1];
  const current = latest.value;
  const lowerIsBetter = ['weight'].includes(goal.category);
  const initial = vitals[0]?.value ?? current;

  if (lowerIsBetter) {
    const totalToLose = initial - goal.targetValue;
    const lost = initial - current;
    const pct = totalToLose > 0 ? Math.min(100, Math.max(0, (lost / totalToLose) * 100)) : 0;
    return { current, target: goal.targetValue, percentage: Math.round(pct), unit: goal.targetUnit };
  } else {
    const totalToGain = goal.targetValue - initial;
    const gained = current - initial;
    const pct = totalToGain > 0 ? Math.min(100, Math.max(0, (gained / totalToGain) * 100)) : 0;
    return { current, target: goal.targetValue, percentage: Math.round(pct), unit: goal.targetUnit };
  }
}

function computeTaskStreaks(tasks) {
  return tasks.map((task) => ({
    ...task,
    streak: calculateStreak(task.completedDates || []),
    completedToday: task.completedDates?.includes(new Date().toISOString().split('T')[0]) ?? false,
  }));
}

function getDaysUntilTarget(targetDate) {
  if (!targetDate) return null;
  const target = new Date(targetDate);
  const today = new Date();
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function executeGetHealthSummary(input, phone, db) {
  const { summary_type, period_days = 30 } = input;
  const record = db.getHealthRecord(phone);
  const goalsData = db.getGoals(phone);

  switch (summary_type) {
    case 'weight_trend': {
      const vitals = record.vitals?.weight || [];
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - period_days);
      const recent = vitals.filter((v) => new Date(v.recordedAt) > cutoff);
      if (recent.length < 2) return { trend: 'insufficient_data', count: recent.length };
      const first = recent[0].value;
      const last = recent[recent.length - 1].value;
      return {
        trend: last < first ? 'decreasing' : last > first ? 'increasing' : 'stable',
        change: +(last - first).toFixed(1),
        unit: recent[0].unit || 'kg',
        first, last,
        dataPoints: recent.length,
        periodDays: period_days,
      };
    }

    case 'sleep_trend': {
      const vitals = record.vitals?.sleepHours || [];
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - period_days);
      const recent = vitals.filter((v) => new Date(v.recordedAt) > cutoff);
      if (recent.length === 0) return { trend: 'insufficient_data' };
      const avg = recent.reduce((sum, v) => sum + v.value, 0) / recent.length;
      return { average: +avg.toFixed(1), dataPoints: recent.length, periodDays: period_days };
    }

    case 'goal_progress':
      return goalsData.goals
        .filter((g) => g.status === 'active')
        .map((g) => ({
          id: g.id,
          title: g.title,
          progress: computeGoalProgress(g, phone, db),
          daysUntilTarget: getDaysUntilTarget(g.targetDate),
          milestonesCompleted: g.milestones?.filter((m) => m.completed).length || 0,
          milestonesTotal: g.milestones?.length || 0,
        }));

    case 'task_streaks': {
      const tasksWithStreaks = computeTaskStreaks(goalsData.tasks.filter((t) => t.active));
      return tasksWithStreaks.map((t) => ({
        id: t.id, title: t.title, streak: t.streak, completedToday: t.completedToday,
      }));
    }

    case 'full_overview':
      return {
        weight_trend: executeGetHealthSummary({ summary_type: 'weight_trend', period_days }, phone, db),
        goal_progress: executeGetHealthSummary({ summary_type: 'goal_progress' }, phone, db),
        task_streaks: executeGetHealthSummary({ summary_type: 'task_streaks' }, phone, db),
      };

    default:
      return { error: 'Unknown summary type' };
  }
}

// ── Central Tool Dispatcher ───────────────────────────────────────────────────

function executeTool(toolName, input, phone, db) {
  switch (toolName) {
    case 'update_health_record':
      return executeUpdateHealthRecord(input, phone, db);
    case 'add_goal':
      return executeAddGoal(input, phone, db);
    case 'add_task':
      return executeAddTask(input, phone, db);
    case 'update_goal_status':
      return executeUpdateGoalStatus(input, phone, db);
    case 'update_preferences':
      return executeUpdatePreferences(input, phone, db);
    case 'mark_task_complete':
      return executeMarkTaskComplete(input, phone, db);
    case 'get_health_summary':
      return executeGetHealthSummary(input, phone, db);
    case 'adjust_reminder':
      return executeAdjustReminder(input, phone, db);
    case 'process_health_document':
      return executeProcessHealthDocument(input, phone, db);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  TOOL_DEFINITIONS,
  requiresConfirmation,
  buildSystemPrompt,
  executeTool,
  calculateStreak,
};
