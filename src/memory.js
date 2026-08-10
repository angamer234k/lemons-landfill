const fs = require('fs');
const { MEMORY_FILE, MAX_MEMORY_MESSAGES } = require('./config');

const userMemories = new Map();

function loadMemories() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
      for (const [userId, history] of Object.entries(data)) {
        userMemories.set(userId, history);
      }
      console.log(`Loaded memories for ${userMemories.size} users.`);
    }
  } catch (err) {
    console.error('Failed to load user memories:', err.message);
  }
}

function saveMemories() {
  try {
    const obj = Object.fromEntries(userMemories);
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.error('Failed to save user memories:', err.message);
  }
}

function getUserMemory(userId) {
  return userMemories.get(userId) || [];
}

function updateUserMemory(userId, newMessages) {
  let history = getUserMemory(userId);
  history = [...history, ...newMessages];
  if (history.length > MAX_MEMORY_MESSAGES) {
    history = history.slice(-MAX_MEMORY_MESSAGES);
  }
  userMemories.set(userId, history);
  saveMemories();
}

function clearUserMemory(userId) {
  userMemories.delete(userId);
  saveMemories();
}

module.exports = {
  loadMemories,
  saveMemories,
  getUserMemory,
  updateUserMemory,
  clearUserMemory,
};
