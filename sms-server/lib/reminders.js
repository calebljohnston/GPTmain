// reminders.js — node-cron job for scheduled Telegram reminders

'use strict';

const cron = require('node-cron');
const { sendMessage } = require('./telegram');

/**
 * Start the reminder cron job.
 * Fires every minute and checks for reminders scheduled for this HH:MM.
 */
function initReminders(db) {
  cron.schedule('* * * * *', async () => {
    const now = new Date();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = dayNames[now.getDay()];
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;
    const today = now.toISOString().split('T')[0];

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

      let name = 'there';
      try {
        const record = db.getHealthRecord(reminder.phone_number);
        name = record.demographics?.name || 'there';
      } catch {
        // Non-fatal — use default
      }

      const message =
        `Hey ${name}! Vita reminder: ${reminder.title}.\n\n` +
        `How did it go today? Reply to check in with Vita.`;

      try {
        // reminder.phone_number holds the Telegram chat ID (stored as string)
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

  console.log('[reminders] Reminder cron started (checks every minute)');
}

module.exports = { initReminders };
