// sw.js — Service Worker for background reminder notifications
// Runs independently of the main page

let reminders = [];

// Receive updated reminder schedule from main page
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SYNC_REMINDERS') {
    reminders = event.data.reminders || [];
  }
});

// Check reminders every minute
setInterval(checkReminders, 60_000);

function checkReminders() {
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];

  reminders.forEach((reminder) => {
    if (!reminder.active) return;
    if (reminder.scheduledTime !== timeStr) return;
    if (!reminder.days?.includes(dayName)) return;

    // Don't fire if already fired today
    const lastFiredDate = reminder.lastFired ? new Date(reminder.lastFired).toDateString() : null;
    if (lastFiredDate === now.toDateString()) return;

    self.registration
      .showNotification(reminder.title, {
        body: reminder.body || "Time to check in with Vita!",
        icon: '/icons/vita-192.png',
        badge: '/icons/badge-72.png',
        tag: reminder.id,
        requireInteraction: false,
        data: {
          reminderId: reminder.id,
          taskId: reminder.taskId,
          url: `/?reminder=${reminder.id}`,
        },
      })
      .catch(() => {});

    reminder.lastFired = now.toISOString();
  });
}

// Handle notification click → focus app tab
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = data.url || '/';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Try to focus an existing tab
        for (const client of clientList) {
          if (new URL(client.url).origin === self.location.origin) {
            return client.focus().then((c) => {
              c.postMessage({ type: 'REMINDER_CLICKED', reminderId: data.reminderId });
              return c;
            });
          }
        }
        // Open new tab if none found
        return clients.openWindow(targetUrl);
      })
  );
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});
