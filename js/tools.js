// tools.js — Tool definitions and executor dispatch

import * as storage from './storage.js';
import { executeUpdateHealthRecord, executeUpdatePreferences } from './health-record.js';
import {
  executeAddGoal,
  executeAddTask,
  executeUpdateGoalStatus,
  executeMarkTaskComplete,
  executeGetHealthSummary,
} from './goals.js';
import { addReminderForTask } from './reminders.js';

// ── Tool Definitions (sent to Anthropic API) ─────────────────────────────────

export const TOOL_DEFINITIONS = [
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
        recurrence: {
          type: 'string',
          enum: ['daily', 'weekdays', 'weekends', 'weekly', 'once'],
        },
        due_time: {
          type: 'string',
          description: 'HH:MM in 24h format for the reminder time (e.g. "08:00")',
        },
        schedule_reminder: {
          type: 'boolean',
          description: 'Whether to schedule a browser notification reminder',
        },
        human_readable_summary: { type: 'string' },
      },
      required: ['title', 'recurrence', 'human_readable_summary'],
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

// ── Confirmation requirement map ─────────────────────────────────────────────

const REQUIRES_CONFIRMATION = {
  update_health_record: true,
  add_goal: true,
  add_task: true,
  update_goal_status: true,
  update_preferences: true,
  mark_task_complete: false,
  get_health_summary: false,
};

export function requiresConfirmation(toolName) {
  return REQUIRES_CONFIRMATION[toolName] ?? true;
}

// ── Tool Category Icons ──────────────────────────────────────────────────────

const TOOL_ICONS = {
  update_health_record: {
    vitals: '📊',
    demographics: '👤',
    conditions: '🏥',
    medications: '💊',
    allergies: '⚠️',
    lifestyle: '🌱',
  },
  add_goal: '🎯',
  add_task: '✅',
  update_goal_status: '🏆',
  update_preferences: '⚙️',
  mark_task_complete: '✅',
  get_health_summary: '📈',
};

export function getToolIcon(toolName, input) {
  const icon = TOOL_ICONS[toolName];
  if (typeof icon === 'object' && input?.category) {
    return icon[input.category] || '📋';
  }
  return icon || '📋';
}

export function getToolLabel(toolName) {
  const labels = {
    update_health_record: 'Update Health Record',
    add_goal: 'Add Goal',
    add_task: 'Add Task',
    update_goal_status: 'Update Goal Status',
    update_preferences: 'Update Preferences',
    mark_task_complete: 'Mark Task Complete',
    get_health_summary: 'Get Health Summary',
  };
  return labels[toolName] || toolName;
}

// ── Tool Executor ────────────────────────────────────────────────────────────

export function executeTool(toolName, input) {
  switch (toolName) {
    case 'update_health_record':
      return executeUpdateHealthRecord(input);

    case 'add_goal': {
      const goal = executeAddGoal(input);
      return goal;
    }

    case 'add_task': {
      const task = executeAddTask(input);
      // Auto-schedule a reminder if requested
      if (task.scheduleReminder && task.dueTime) {
        addReminderForTask(task);
      }
      return task;
    }

    case 'update_goal_status':
      return executeUpdateGoalStatus(input);

    case 'update_preferences':
      return executeUpdatePreferences(input);

    case 'mark_task_complete':
      return executeMarkTaskComplete(input);

    case 'get_health_summary':
      return executeGetHealthSummary(input);

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
