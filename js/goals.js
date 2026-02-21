// goals.js — Goal and task management, streak calculation, progress computation

import * as storage from './storage.js';
import { calculateStreak } from './health-record.js';

// ── Goal Execution ───────────────────────────────────────────────────────────

export function executeAddGoal(input) {
  const goal = {
    id: storage.generateId('goal'),
    title: input.title,
    category: input.category,
    description: input.description || '',
    targetValue: input.target_value ?? null,
    targetUnit: input.target_unit ?? null,
    targetDate: input.target_date ?? null,
    status: 'active',
    milestones: (input.milestones || []).map((m, i) => ({
      id: storage.generateId('ms'),
      description: m.description,
      targetValue: m.target_value ?? null,
      completed: false,
      completedAt: null,
      order: i,
    })),
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
  return storage.addGoal(goal);
}

export function executeAddTask(input) {
  const task = {
    id: storage.generateId('task'),
    title: input.title,
    goalId: input.goal_id || null,
    recurrence: input.recurrence,
    dueTime: input.due_time || null,
    scheduleReminder: input.schedule_reminder !== false,
    completedDates: [],
    active: true,
    createdAt: new Date().toISOString(),
  };
  return storage.addTask(task);
}

export function executeUpdateGoalStatus(input) {
  const { goal_id, new_status, milestone_id } = input;

  if (milestone_id) {
    const data = storage.getGoals();
    const goal = data.goals.find((g) => g.id === goal_id);
    if (goal) {
      const ms = goal.milestones?.find((m) => m.id === milestone_id);
      if (ms) {
        ms.completed = true;
        ms.completedAt = new Date().toISOString();
        storage.saveGoals(data);
        return goal;
      }
    }
    return null;
  }

  return storage.updateGoal(goal_id, {
    status: new_status,
    completedAt: new_status === 'completed' ? new Date().toISOString() : null,
  });
}

export function executeMarkTaskComplete(input) {
  return storage.markTaskComplete(input.task_id, input.completed_date);
}

// ── Progress Computation ─────────────────────────────────────────────────────

export function computeGoalProgress(goal) {
  if (!goal.targetValue) return null;

  // Try to get latest relevant vital
  const record = storage.getHealthRecord();
  const vitalMap = {
    weight: 'weight',
    fitness: null,
    sleep: 'sleepHours',
  };

  const vitalKey = vitalMap[goal.category];
  if (!vitalKey) return null;

  const vitals = record.vitals?.[vitalKey];
  if (!vitals || vitals.length === 0) return null;

  const latest = vitals[vitals.length - 1];
  const current = latest.value;

  // Determine if lower or higher is better
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

export function computeTaskStreaks(tasks) {
  return tasks.map((task) => ({
    ...task,
    streak: calculateStreak(task.completedDates || []),
    completedToday: isCompletedToday(task),
  }));
}

export function isCompletedToday(task) {
  const today = new Date().toISOString().split('T')[0];
  return task.completedDates?.includes(today) ?? false;
}

export function getDaysUntilTarget(targetDate) {
  if (!targetDate) return null;
  const target = new Date(targetDate);
  const today = new Date();
  const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
  return diff;
}

export function executeGetHealthSummary(input) {
  const { summary_type, period_days = 30 } = input;
  const record = storage.getHealthRecord();
  const goalsData = storage.getGoals();

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
        first,
        last,
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

    case 'goal_progress': {
      return goalsData.goals
        .filter((g) => g.status === 'active')
        .map((g) => ({
          id: g.id,
          title: g.title,
          progress: computeGoalProgress(g),
          daysUntilTarget: getDaysUntilTarget(g.targetDate),
          milestonesCompleted: g.milestones?.filter((m) => m.completed).length || 0,
          milestonesTotal: g.milestones?.length || 0,
        }));
    }

    case 'task_streaks': {
      const tasksWithStreaks = computeTaskStreaks(goalsData.tasks.filter((t) => t.active));
      return tasksWithStreaks.map((t) => ({
        id: t.id,
        title: t.title,
        streak: t.streak,
        completedToday: t.completedToday,
      }));
    }

    case 'full_overview': {
      return {
        weight_trend: executeGetHealthSummary({ summary_type: 'weight_trend', period_days }),
        goal_progress: executeGetHealthSummary({ summary_type: 'goal_progress' }),
        task_streaks: executeGetHealthSummary({ summary_type: 'task_streaks' }),
      };
    }

    default:
      return { error: 'Unknown summary type' };
  }
}
