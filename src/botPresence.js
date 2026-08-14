const fs = require('fs');
const path = require('path');
const { ActivityType } = require('discord.js');

const STORE_FILE = path.join(process.cwd(), 'bot_presence.json');

const ACTIVITY_MAP = {
  playing: ActivityType.Playing,
  streaming: ActivityType.Streaming,
  listening: ActivityType.Listening,
  watching: ActivityType.Watching,
  competing: ActivityType.Competing,
  custom: ActivityType.Custom,
};

/** @type {{ status: string, activityType: string, activityName: string, activityUrl?: string }} */
let presence = {
  status: 'idle',
  activityType: 'custom',
  activityName: 'lemons in the landfill 🍋',
  activityUrl: '',
};

function load() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      presence = {
        status: ['online', 'idle', 'dnd', 'invisible'].includes(raw.status) ? raw.status : 'idle',
        activityType: ACTIVITY_MAP[raw.activityType] !== undefined ? raw.activityType : 'custom',
        activityName: String(raw.activityName || '').slice(0, 128),
        activityUrl: String(raw.activityUrl || '').slice(0, 200),
      };
    }
  } catch (err) {
    console.error('Failed to load bot_presence.json:', err.message);
  }
}

function save() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(presence, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save bot_presence.json:', err.message);
  }
}

function getPresence() {
  return { ...presence };
}

function setPresenceConfig(patch = {}) {
  if (['online', 'idle', 'dnd', 'invisible'].includes(patch.status)) {
    presence.status = patch.status;
  }
  if (patch.activityType && ACTIVITY_MAP[patch.activityType] !== undefined) {
    presence.activityType = patch.activityType;
  }
  if (typeof patch.activityName === 'string') {
    presence.activityName = patch.activityName.slice(0, 128);
  }
  if (typeof patch.activityUrl === 'string') {
    presence.activityUrl = patch.activityUrl.slice(0, 200);
  }
  save();
  return getPresence();
}

/**
 * Apply presence to a ready Discord client.
 * Custom status (speech bubble) uses ActivityType.Custom + name/state.
 */
async function applyPresence(client) {
  if (!client?.user) return getPresence();

  const type = ACTIVITY_MAP[presence.activityType] ?? ActivityType.Custom;
  const activities = [];

  if (presence.activityName && presence.activityName.trim()) {
    const activity = {
      name: presence.activityName,
      type,
    };
    // Custom status uses `state` in discord.js for the bubble text in some clients;
    // `name` is still required. For Custom, Discord shows the name as the status text.
    if (type === ActivityType.Custom) {
      activity.state = presence.activityName;
    }
    if (type === ActivityType.Streaming && presence.activityUrl) {
      activity.url = presence.activityUrl;
    }
    activities.push(activity);
  }

  await client.user.setPresence({
    status: presence.status,
    activities,
  });

  return getPresence();
}

load();

module.exports = {
  getPresence,
  setPresenceConfig,
  applyPresence,
  ACTIVITY_MAP,
};
