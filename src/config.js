// ---------- CONFIG ----------
const ROBLOX_USER_ID = 10855335836;
const ROBLOX_GAME_ID = 16855862021;
const DISCORD_CHANNEL_ID = '1532647917368639559';
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const CUSTOM_DESCRIPTION = 'oh this is the live status for host-it';
const SYSTEM_PROMPT_FILE = './systemPrompt.txt';
const OWNER_ID = '1131451961942749206';
const NUDGE_SECRET = process.env.NUDGE_SECRET || 'change-me';
const MEMORY_FILE = './user_memories.json';
const MAX_MEMORY_MESSAGES = 10;       // persistent memory kept on disk
const MAX_HISTORY_TO_MODEL = 8;       // max messages sent to the API per request
const EMBED_SPLIT_THRESHOLD = 3900;
const MAX_TOOL_CALLS = 50;
const STREAM_EDIT_INTERVAL_MS = 400;
const STREAM_MIN_CHARS = 35;
const STREAM_MIN_LENGTH = 15;

const botConfig = {
  maxReplies: 5,
  allowOthersToReply: false,
  aiModel: 'mistral-medium-latest',
  provider: 'mistral', // 'navy' | 'mistral'
};

const PROVIDER_DEFAULTS = {
  navy: { model: 'gpt-3.5-turbo', base: 'https://api.navy/v1' },
  mistral: { model: 'mistral-small-latest', base: 'https://api.mistral.ai/v1' },
};

module.exports = {
  ROBLOX_USER_ID,
  ROBLOX_GAME_ID,
  DISCORD_CHANNEL_ID,
  CHECK_INTERVAL_MS,
  CUSTOM_DESCRIPTION,
  SYSTEM_PROMPT_FILE,
  OWNER_ID,
  NUDGE_SECRET,
  MEMORY_FILE,
  MAX_MEMORY_MESSAGES,
  MAX_HISTORY_TO_MODEL,
  EMBED_SPLIT_THRESHOLD,
  MAX_TOOL_CALLS,
  STREAM_EDIT_INTERVAL_MS,
  STREAM_MIN_CHARS,
  STREAM_MIN_LENGTH,
  botConfig,
  PROVIDER_DEFAULTS,
};
