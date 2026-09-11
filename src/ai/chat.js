const fs = require('fs');
const {
  SYSTEM_PROMPT_FILE,
  MAX_HISTORY_TO_MODEL,
  MAX_TOOL_CALLS,
  STREAM_EDIT_INTERVAL_MS,
  STREAM_MIN_CHARS,
  STREAM_MIN_LENGTH,
  botConfig,
} = require('../config');
const {
  safeEditMessage,
  extractThink,
  stripHiddenReasoning,
} = require('../utils');
const {
  getToolsForUser,
  inferToolsFromMessage,
  runTool,
} = require('./tools');

const conversationThreads = new Map();

function loadSystemPrompt() {
  try {
    return fs.readFileSync(SYSTEM_PROMPT_FILE, 'utf8');
  } catch {
    return 'You are a helpful AI assistant.';
  }
}

async function handleAiChat({ message, interaction, content, onProgress }) {
  const userId = message?.author?.id || interaction?.user?.id;
  const channelId = message?.channel?.id || interaction?.channel?.id;
  const key = `${channelId}:${userId}`;

  let thread = conversationThreads.get(key) || { messages: [], enabledToolNames: new Set() };

  // Heuristic preload from latest user message
  const lastUser = content || '';
  const inferred = inferToolsFromMessage(lastUser);
  for (const n of inferred) thread.enabledToolNames.add(n);

  const tools = getToolsForUser(Array.from(thread.enabledToolNames));

  const system = loadSystemPrompt();
  const history = thread.messages.slice(-MAX_HISTORY_TO_MODEL);

  // ... rest of chat loop with enable_tools handling, progress embeds, stripHiddenReasoning, etc.
  // (full implementation continues with tool call loop, auto-enable, etc.)

  conversationThreads.set(key, thread);
  return { reply: 'placeholder for full chat logic' };
}

module.exports = { handleAiChat, conversationThreads };
