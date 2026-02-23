// reminders.js — Smart reminder cron with Claude-generated messages
//
// Three cron passes run inside a single every-minute job:
//   1. Fire due reminders (with smart suppression, expiry, pre-completion skip)
//   2. At 23:59 — increment consecutive_missed for reminders fired but not completed
//   3. At 11:00 — minimum-cadence nudge pass for tasks overdue for a check-in

'use strict';

const cron = require('node-cron');
const Anthropic = require('@anthropic-ai/sdk');
const { sendMessage } = require('./telegram');
const { calculateStreak } = require('./vita-core');

// Lazy Anthropic client — reused across cron ticks
let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// ── Claude-generated reminder message ─────────────────────────────────────────

async function generateReminderMessage(name, taskTitle, engagement) {
  const { streak, completionRate7d, consecutiveMissed } = engagement;

  let contextNote = '';
  if (streak > 3) {
    contextNote = `They have a ${streak}-day streak going — acknowledge it briefly!`;
  } else if (consecutiveMissed > 2) {
    contextNote = `They've missed this ${consecutiveMissed} days in a row — be gently encouraging, not guilt-inducing.`;
  } else if (completionRate7d !== null && completionRate7d >= 70) {
    contextNote = `They've completed this ${completionRate7d}% of days recently — great consistency!`;
  } else if (completionRate7d !== null && completionRate7d < 40) {
    contextNote = `They've only completed this ${completionRate7d}% of days recently — keep it light and supportive.`;
  }

  const prompt =
    `Write a short, warm, personalized reminder for ${name} about: "${taskTitle}". ` +
    `${contextNote} Keep it under 80 words, plain text only, no markdown. ` +
    `End by asking how it went or inviting a check-in.`;

  try {
    const response = await getClient().messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    }, { timeout: 30_000 });
    return response.content[0]?.text?.trim() || fallbackMessage(name, taskTitle);
  } catch (err) {
    console.error('[reminders] Claude message generation failed:', err.message);
    return fallbackMessage(name, taskTitle);
  }
}

function fallbackMessage(name, taskTitle) {
  return `Hey ${name}! Vita reminder: ${taskTitle}.\n\nHow did it go today? Reply to check in with Vita.`;
}

// ── Minimum-cadence nudge via Claude ──────────────────────────────────────────

async function sendMinCadenceNudge(phone, task, daysSince, name) {
  const prompt =
    `Write a gentle, caring nudge for ${name} about: "${task.title}". ` +
    `They haven't done this in ${daysSince} days (recommended: at least every ${task.minimumCadenceDays} days). ` +
    `Keep it under 80 words, plain text, no markdown. Be warm and supportive, not nagging.`;

  let msg;
  try {
    const response = await getClient().messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    }, { timeout: 30_000 });
    msg = response.content[0]?.text?.trim() ||
      `Hey ${name}! It's been ${daysSince} days since your last ${task.title}. Just a gentle check-in!`;
  } catch (err) {
    console.error('[reminders] Nudge generation failed:', err.message);
    msg = `Hey ${name}! Just a gentle reminder — it's been ${daysSince} days since your last ${task.title}.`;
  }

  try {
    await sendMessage(phone, msg);
    console.log(`[reminders] Sent min-cadence nudge for "${task.title}" to ${phone}`);
  } catch (err) {
    console.error(`[reminders] Failed to send nudge to ${phone}:`, err.message);
  }
}

// ── Midnight pass: increment consecutive_missed ────────────────────────────────
// Called at 23:59. Finds reminders that fired today but whose task wasn't
// completed today, and increments their consecutive_missed counter.

async function midnightPass(db, today) {
  const phones = db.getAllPhonesWithReminders ? db.getAllPhonesWithReminders() : [];
  let count = 0;

  for (const phone of phones) {
    const goalsData = db.getGoals(phone);
    const taskMap = {};
    for (const t of goalsData.tasks) taskMap[t.id] = t;

    // We need access to the raw reminders — use getRemindersByTaskId isn't efficient here.
    // Instead use getEngagementSummary which already has the data we need:
    const engagement = db.getEngagementSummary ? db.getEngagementSummary(phone) : [];

    for (const e of engagement) {
      const task = taskMap[e.taskId];
      if (!task) continue;

      // Only process reminders that appear to have fired today (last_fired_date === today)
      // and were not completed today
      const reminders = db.getRemindersByTaskId(phone, e.taskId);
      for (const r of reminders) {
        if (r.last_fired_date === today && !task.completedDates?.includes(today)) {
          const missed = db.incrementConsecutiveMissed(r.id);
          count++;
          console.log(`[reminders] Incremented consecutive_missed for "${r.title}" (now ${missed})`);
        }
      }
    }
  }

  if (count > 0) {
    console.log(`[reminders] Midnight pass: incremented consecutive_missed for ${count} reminder(s)`);
  }
}

// ── 11am minimum-cadence nudge pass ───────────────────────────────────────────

async function minCadencePass(db) {
  const phones = db.getAllPhonesWithReminders ? db.getAllPhonesWithReminders() : [];
  console.log(`[reminders] Running min-cadence nudge pass for ${phones.length} user(s)`);

  for (const phone of phones) {
    let name = 'there';
    try {
      const record = db.getHealthRecord(phone);
      name = record.demographics?.name || 'there';
    } catch { /* use default */ }

    let overdueTasks;
    try {
      overdueTasks = db.getMinCadenceOverdueTasks(phone);
    } catch (err) {
      console.error(`[reminders] getMinCadenceOverdueTasks failed for ${phone}:`, err.message);
      continue;
    }

    for (const { task, daysSince } of overdueTasks) {
      await sendMinCadenceNudge(phone, task, daysSince, name);
    }
  }
}

// ── Main init ─────────────────────────────────────────────────────────────────

function initReminders(db) {
  cron.schedule('* * * * *', async () => {
    const now = new Date();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = dayNames[now.getDay()];
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;
    const today = now.toISOString().split('T')[0];

    // ── 23:59 pass: mark reminders as missed if task wasn't completed ──────
    if (hours === '23' && minutes === '59') {
      try {
        await midnightPass(db, today);
      } catch (err) {
        console.error('[reminders] Midnight pass error:', err.message);
      }
    }

    // ── 11:00 pass: minimum-cadence nudges ─────────────────────────────────
    if (hours === '11' && minutes === '00') {
      try {
        await minCadencePass(db);
      } catch (err) {
        console.error('[reminders] Min-cadence pass error:', err.message);
      }
    }

    // ── Due reminder pass ──────────────────────────────────────────────────
    let dueReminders;
    try {
      dueReminders = db.getDueReminders(timeStr, today);
    } catch (err) {
      console.error('[reminders] Error querying due reminders:', err.message);
      return;
    }

    for (const reminder of dueReminders) {
      let days;
      try {
        days = JSON.parse(reminder.days);
      } catch {
        days = [];
      }

      if (!days.includes(dayName)) continue;

      // Deactivate expired tasks inline (getDueReminders already skips them, but clean up active flag)
      const task = reminder._task;
      if (task && task.expiresAt && new Date(task.expiresAt) < now) {
        try {
          db.updateReminder(reminder.phone_number, reminder.id, { active: 0 });
          console.log(`[reminders] Deactivated expired reminder "${reminder.title}" for ${reminder.phone_number}`);
        } catch { /* non-fatal */ }
        continue;
      }

      // Build engagement context for message generation
      let name = 'there';
      let engagement = { streak: 0, completionRate7d: null, consecutiveMissed: 0 };
      try {
        const record = db.getHealthRecord(reminder.phone_number);
        name = record.demographics?.name || 'there';

        const rate = db.getTaskCompletionRate
          ? db.getTaskCompletionRate(reminder.phone_number, reminder.task_id, 7)
          : null;
        const streak = task ? calculateStreak(task.completedDates || []) : 0;
        engagement = {
          streak,
          completionRate7d: rate !== null ? Math.round(rate * 100) : null,
          consecutiveMissed: reminder.consecutive_missed || 0,
        };
      } catch { /* use defaults */ }

      // Generate personalized message via Claude
      const message = await generateReminderMessage(name, reminder.title, engagement);

      try {
        await sendMessage(reminder.phone_number, message);
        db.markReminderFired(reminder.id, today);
        console.log(`[reminders] Sent reminder "${reminder.title}" to chat ${reminder.phone_number}`);
      } catch (err) {
        console.error(
          `[reminders] Failed to send reminder to ${reminder.phone_number}:`,
          err.message,
        );
      }
    }
  });

  console.log('[reminders] Reminder cron started (every minute, with 23:59 missed-pass + 11:00 nudge-pass)');
}

module.exports = { initReminders };
