const fs = require('fs');
const path = require('path');

const REMINDERS_FILE = path.join(__dirname, '..', 'reminders.json');
const MAX_REMINDER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MIN_REMINDER_MS = 30 * 1000; // 30 seconds

/** @type {Map<string, { id: string, userId: string, channelId: string | null, message: string, dueAt: number, timeout: NodeJS.Timeout | null }>} */
const reminders = new Map();
let clientRef = null;

function loadReminders() {
  try {
    if (fs.existsSync(REMINDERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8'));
      if (Array.isArray(data)) {
        const now = Date.now();
        for (const r of data) {
          if (r.dueAt > now) {
            reminders.set(r.id, { ...r, timeout: null });
          }
        }
        console.log(`Loaded ${reminders.size} pending reminder(s).`);
      }
    }
  } catch (err) {
    console.error('Failed to load reminders:', err.message);
  }
}

function saveReminders() {
  try {
    const list = [...reminders.values()].map(({ id, userId, channelId, message, dueAt }) => ({
      id,
      userId,
      channelId,
      message,
      dueAt,
    }));
    fs.writeFileSync(REMINDERS_FILE, JSON.stringify(list, null, 2));
  } catch (err) {
    console.error('Failed to save reminders:', err.message);
  }
}

function parseDuration(input) {
  if (!input || typeof input !== 'string') return null;
  const str = input.trim().toLowerCase();
  const re = /(\d+)\s*(d|h|m|s)/g;
  let total = 0;
  let matched = false;
  let m;
  while ((m = re.exec(str)) !== null) {
    matched = true;
    const n = parseInt(m[1], 10);
    const unit = m[2];
    if (unit === 'd') total += n * 86400000;
    else if (unit === 'h') total += n * 3600000;
    else if (unit === 'm') total += n * 60000;
    else if (unit === 's') total += n * 1000;
  }
  if (!matched || total <= 0) return null;
  return total;
}

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (secs && parts.length === 0) parts.push(`${secs}s`);
  else if (secs && days === 0 && hours === 0) parts.push(`${secs}s`);
  return parts.join(' ') || '0s';
}

async function fireReminder(reminder) {
  reminders.delete(reminder.id);
  saveReminders();

  if (!clientRef) return;

  const content = `⏰ **Reminder:** ${reminder.message}`;

  try {
    const user = await clientRef.users.fetch(reminder.userId);
    await user.send({ content }).catch(async () => {
      if (reminder.channelId) {
        const channel = await clientRef.channels.fetch(reminder.channelId).catch(() => null);
        if (channel?.isTextBased?.()) {
          await channel.send({ content: `<@${reminder.userId}> ${content}` }).catch(() => {});
        }
      }
    });
  } catch (err) {
    console.error('Failed to deliver reminder:', err.message);
  }
}

function scheduleReminder(reminder) {
  const delay = reminder.dueAt - Date.now();
  if (delay <= 0) {
    fireReminder(reminder);
    return;
  }
  const timeout = setTimeout(() => fireReminder(reminder), delay);
  reminder.timeout = timeout;
}

function addReminder({ userId, channelId, message, durationMs }) {
  if (durationMs < MIN_REMINDER_MS) {
    throw new Error(`Minimum reminder time is ${formatDuration(MIN_REMINDER_MS)}.`);
  }
  if (durationMs > MAX_REMINDER_MS) {
    throw new Error(`Maximum reminder time is ${formatDuration(MAX_REMINDER_MS)}.`);
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const reminder = {
    id,
    userId,
    channelId: channelId || null,
    message: message.slice(0, 500),
    dueAt: Date.now() + durationMs,
    timeout: null,
  };

  reminders.set(id, reminder);
  saveReminders();
  scheduleReminder(reminder);
  return reminder;
}

function getUserReminders(userId) {
  return [...reminders.values()]
    .filter(r => r.userId === userId)
    .sort((a, b) => a.dueAt - b.dueAt);
}

function getReminderCount() {
  return reminders.size;
}

function cancelReminder(id, userId) {
  const r = reminders.get(id);
  if (!r || r.userId !== userId) return false;
  if (r.timeout) clearTimeout(r.timeout);
  reminders.delete(id);
  saveReminders();
  return true;
}

function initReminders(client) {
  clientRef = client;
  loadReminders();
  for (const r of reminders.values()) {
    scheduleReminder(r);
  }
}

module.exports = {
  parseDuration,
  formatDuration,
  addReminder,
  getUserReminders,
  getReminderCount,
  cancelReminder,
  initReminders,
  MAX_REMINDER_MS,
  MIN_REMINDER_MS,
};
