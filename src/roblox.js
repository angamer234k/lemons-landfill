const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const {
  ROBLOX_USER_ID,
  ROBLOX_GAME_ID,
  DISCORD_CHANNEL_ID,
  CUSTOM_DESCRIPTION,
} = require('./config');

const HISTORY_FILE = path.join(__dirname, '..', 'uptime_history.json');
const MAX_HISTORY_ENTRIES = 864; // ~3 days at 5-min intervals

let statusMessage = null;
let currentIsOnline = false;
let history = [];

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (Array.isArray(data)) {
        history = data;
        console.log(`Loaded ${history.length} uptime history entries.`);
      }
    }
  } catch (err) {
    console.error('Failed to load uptime history:', err.message);
    history = [];
  }
}

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 0));
  } catch (err) {
    console.error('Failed to save uptime history:', err.message);
  }
}

function recordPresence(isOnline) {
  const entry = { ts: Date.now(), online: !!isOnline };
  history.push(entry);
  if (history.length > MAX_HISTORY_ENTRIES) {
    history = history.slice(-MAX_HISTORY_ENTRIES);
  }
  saveHistory();
}

function getHistory(sinceMs = 0) {
  if (!sinceMs) return [...history];
  const cutoff = Date.now() - sinceMs;
  return history.filter(e => e.ts >= cutoff);
}

function getUptimeStats(sinceMs = 24 * 60 * 60 * 1000) {
  const entries = getHistory(sinceMs);
  if (entries.length === 0) {
    return {
      totalChecks: 0,
      onlineChecks: 0,
      uptimePercent: 0,
      sessions: [],
      currentStreakMs: 0,
      longestOnlineMs: 0,
      longestOfflineMs: 0,
    };
  }

  const onlineChecks = entries.filter(e => e.online).length;
  const uptimePercent = (onlineChecks / entries.length) * 100;

  // Build continuous sessions from consecutive same-state checks
  const sessions = [];
  let current = { online: entries[0].online, start: entries[0].ts, end: entries[0].ts };

  for (let i = 1; i < entries.length; i++) {
    const e = entries[i];
    if (e.online === current.online) {
      current.end = e.ts;
    } else {
      sessions.push({ ...current });
      current = { online: e.online, start: e.ts, end: e.ts };
    }
  }
  sessions.push(current);

  // Approximate duration: extend last session to now if recent (< ~2 check intervals)
  const now = Date.now();
  const last = sessions[sessions.length - 1];
  if (now - last.end < 12 * 60 * 1000) {
    last.end = now;
  }

  let longestOnlineMs = 0;
  let longestOfflineMs = 0;
  for (const s of sessions) {
    const dur = s.end - s.start;
    if (s.online) longestOnlineMs = Math.max(longestOnlineMs, dur);
    else longestOfflineMs = Math.max(longestOfflineMs, dur);
  }

  const currentStreakMs = last.end - last.start;

  return {
    totalChecks: entries.length,
    onlineChecks,
    uptimePercent,
    sessions,
    currentStreakMs,
    longestOnlineMs,
    longestOfflineMs,
    currentOnline: last.online,
  };
}

function buildEmbed(isOnline) {
  const color = isOnline ? 0x00FF00 : 0xFF0000;
  const title = isOnline ? 'ONLINE' : 'OFFLINE';
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(CUSTOM_DESCRIPTION)
    .setColor(color)
    .setTimestamp()
    .setFooter({ text: 'Last updated' });
}

async function updateStatusEmbed(client, isOnline) {
  currentIsOnline = isOnline;
  let channel = client.channels.cache.get(DISCORD_CHANNEL_ID);
  if (!channel) {
    try {
      channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    } catch (error) {
      console.error('Could not locate the status channel:', error.message);
      return;
    }
  }
  if (!channel) return;
  const embed = buildEmbed(isOnline);
  try {
    if (statusMessage) {
      await statusMessage.edit({ embeds: [embed] });
    } else {
      statusMessage = await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    if (error.code === 10008) statusMessage = null;
  }
}

async function checkPresence(client) {
  try {
    const response = await fetch('https://presence.roblox.com/v1/presence/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: [ROBLOX_USER_ID] }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const presence = data.userPresences?.find(p => p.userId === ROBLOX_USER_ID);
    if (!presence) return;
    const isOnline = presence.placeId === ROBLOX_GAME_ID;
    recordPresence(isOnline);
    await updateStatusEmbed(client, isOnline);
    console.log(`Status: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
  } catch (error) {
    console.error('Error checking presence:', error.message);
  }
}

// Load history on module init
loadHistory();

module.exports = {
  updateStatusEmbed,
  checkPresence,
  getHistory,
  getUptimeStats,
  loadHistory,
  get currentIsOnline() {
    return currentIsOnline;
  },
};
