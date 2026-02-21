// reminders.js — Browser notification scheduling and service worker bridge

import * as storage from './storage.js';

let swRegistration = null;

// ── Initialization ───────────────────────────────────────────────────────────

export async function initReminders() {
  if (!('serviceWorker' in navigator)) return false;
  if (!('Notification' in window)) return false;

  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    // Listen for messages from the SW (e.g., reminder clicked)
    navigator.serviceWorker.addEventListener('message', handleSwMessage);

    // Sync current reminders to SW
    await syncToServiceWorker();

    // Check if app was opened from a notification
    const urlParams = new URLSearchParams(window.location.search);
    const reminderId = urlParams.get('reminder');
    if (reminderId) {
      handleReminderClick(reminderId);
      // Clean up URL
      window.history.replaceState({}, '', '/');
    }

    return true;
  } catch (e) {
    console.warn('Service worker registration failed:', e);
    return false;
  }
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';

  const result = await Notification.requestPermission();
  return result;
}

// ── Sync reminders to Service Worker ────────────────────────────────────────

export async function syncToServiceWorker() {
  if (!swRegistration) return;
  const reg = await navigator.serviceWorker.ready;
  if (!reg.active) return;

  const data = storage.getReminders();
  reg.active.postMessage({
    type: 'SYNC_REMINDERS',
    reminders: data.reminders.filter((r) => r.active),
  });
}

// ── Reminder CRUD ────────────────────────────────────────────────────────────

export function addReminderForTask(task) {
  if (!task.dueTime || !task.scheduleReminder) return null;

  const daysMap = {
    daily: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    weekends: ['Sat', 'Sun'],
    weekly: [['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()]],
    once: [['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()]],
  };

  const reminder = storage.addReminder({
    taskId: task.id,
    goalId: task.goalId,
    title: task.title,
    body: "Time to check in with Vita on your progress!",
    scheduledTime: task.dueTime,
    days: daysMap[task.recurrence] || daysMap.daily,
  });

  syncToServiceWorker();
  return reminder;
}

export function deactivateReminder(reminderId) {
  storage.updateReminder(reminderId, { active: false });
  syncToServiceWorker();
}

// ── Handle reminder click (from SW notification) ──────────────────────────────

function handleReminderClick(reminderId) {
  const data = storage.getReminders();
  const reminder = data.reminders.find((r) => r.id === reminderId);
  if (!reminder) return;

  // Dispatch a custom event that chat.js listens to
  window.dispatchEvent(
    new CustomEvent('vita:reminderActivated', {
      detail: { reminder, taskId: reminder.taskId },
    })
  );
}

function handleSwMessage(event) {
  if (event.data?.type === 'REMINDER_CLICKED') {
    handleReminderClick(event.data.reminderId);
  }
}

// ── Upcoming reminders for display ──────────────────────────────────────────

export function getUpcomingReminders(limit = 5) {
  const data = storage.getReminders();
  const goalsData = storage.getGoals();
  const now = new Date();
  const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return data.reminders
    .filter((r) => r.active && r.days.includes(dayName))
    .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime))
    .slice(0, limit)
    .map((r) => {
      const task = goalsData.tasks.find((t) => t.id === r.taskId);
      return {
        ...r,
        isPast: r.scheduledTime < timeStr,
        task,
      };
    });
}
