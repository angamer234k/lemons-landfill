const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'user_timezones.json');

/** @type {Map<string, string>} userId -> IANA timezone */
const zones = new Map();

function loadTimezones() {
  try {
    if (fs.existsSync(FILE)) {
      const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      for (const [id, tz] of Object.entries(data)) {
        if (typeof tz === 'string') zones.set(id, tz);
      }
      console.log(`Loaded timezones for ${zones.size} users.`);
    }
  } catch (err) {
    console.error('Failed to load timezones:', err.message);
  }
}

function saveTimezones() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(zones), null, 2));
  } catch (err) {
    console.error('Failed to save timezones:', err.message);
  }
}

function isValidTimeZone(tz) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function setUserTimezone(userId, tz) {
  if (!isValidTimeZone(tz)) return false;
  zones.set(userId, tz);
  saveTimezones();
  return true;
}

function getUserTimezone(userId) {
  return zones.get(userId) || null;
}

function clearUserTimezone(userId) {
  const ok = zones.delete(userId);
  if (ok) saveTimezones();
  return ok;
}

function getAllTimezones() {
  return new Map(zones);
}

function formatInZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(date);
}

// Common zones for autocomplete
const COMMON_ZONES = [
  'Europe/Moscow',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Warsaw',
  'Europe/Kyiv',
  'Europe/Istanbul',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

loadTimezones();

module.exports = {
  isValidTimeZone,
  setUserTimezone,
  getUserTimezone,
  clearUserTimezone,
  getAllTimezones,
  formatInZone,
  COMMON_ZONES,
};
