const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const STORE_FILE = path.join(process.cwd(), 'custom_commands.json');

/** @type {{ commands: Array<CustomCommand>, disabled: Record<string, string[]>, roleDisabled: Record<string, Record<string, string[]>> }} */
let store = {
  commands: [],
  // guildId -> list of disabled built-in or custom command names
  disabled: {},
  // guildId -> roleId -> list of disabled command names
  roleDisabled: {},
};

/**
 * @typedef {Object} CustomCommand
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} response
 * @property {'plain'|'embed'} responseType
 * @property {number} [embedColor]
 * @property {string} [guildId]  // null/undefined = global
 * @property {string} createdBy
 * @property {number} createdAt
 * @property {boolean} enabled
 */

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      store = {
        commands: Array.isArray(raw.commands) ? raw.commands : [],
        disabled: raw.disabled && typeof raw.disabled === 'object' ? raw.disabled : {},
        roleDisabled: raw.roleDisabled && typeof raw.roleDisabled === 'object' ? raw.roleDisabled : {},
      };
    }
  } catch (err) {
    console.error('Failed to load custom_commands.json:', err.message);
  }
}

function saveStore() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save custom_commands.json:', err.message);
  }
}

function sanitizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32);
}

function listCommands(guildId = null) {
  return store.commands.filter(c => {
    if (!c.enabled) return false;
    if (!c.guildId) return true;
    return guildId ? c.guildId === guildId : true;
  });
}

function getAllCommands() {
  return store.commands.slice();
}

function getCommandByName(name, guildId = null) {
  const n = sanitizeName(name);
  return (
    store.commands.find(c => c.enabled && c.name === n && (!c.guildId || c.guildId === guildId)) ||
    store.commands.find(c => c.enabled && c.name === n && !c.guildId)
  );
}

function addCommand(data) {
  const name = sanitizeName(data.name);
  if (!name || name.length < 1) throw new Error('Invalid command name');
  if (store.commands.some(c => c.name === name && (c.guildId || null) === (data.guildId || null))) {
    throw new Error(`Command /${name} already exists for this scope`);
  }

  const cmd = {
    id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    description: String(data.description || 'Custom command').slice(0, 100),
    response: String(data.response || '').slice(0, 2000),
    responseType: data.responseType === 'embed' ? 'embed' : 'plain',
    embedColor: typeof data.embedColor === 'number' ? data.embedColor : 0xfdff94,
    guildId: data.guildId || null,
    createdBy: data.createdBy || 'unknown',
    createdAt: Date.now(),
    enabled: data.enabled !== false,
  };

  if (!cmd.response.trim()) throw new Error('Response cannot be empty');

  store.commands.push(cmd);
  saveStore();
  return cmd;
}

function updateCommand(id, patch) {
  const idx = store.commands.findIndex(c => c.id === id);
  if (idx === -1) throw new Error('Command not found');
  const cur = store.commands[idx];

  if (patch.name !== undefined) {
    const name = sanitizeName(patch.name);
    if (!name) throw new Error('Invalid command name');
    if (store.commands.some(c => c.id !== id && c.name === name && (c.guildId || null) === (cur.guildId || null))) {
      throw new Error(`Command /${name} already exists`);
    }
    cur.name = name;
  }
  if (patch.description !== undefined) cur.description = String(patch.description).slice(0, 100);
  if (patch.response !== undefined) {
    const r = String(patch.response).slice(0, 2000);
    if (!r.trim()) throw new Error('Response cannot be empty');
    cur.response = r;
  }
  if (patch.responseType !== undefined) cur.responseType = patch.responseType === 'embed' ? 'embed' : 'plain';
  if (typeof patch.embedColor === 'number') cur.embedColor = patch.embedColor;
  if (typeof patch.enabled === 'boolean') cur.enabled = patch.enabled;

  saveStore();
  return cur;
}

function deleteCommand(id) {
  const idx = store.commands.findIndex(c => c.id === id);
  if (idx === -1) throw new Error('Command not found');
  const [removed] = store.commands.splice(idx, 1);
  saveStore();
  return removed;
}

function isCommandDisabled(guildId, commandName, memberRoles = []) {
  if (!guildId) return false;
  const name = String(commandName).toLowerCase();

  const guildDisabled = store.disabled[guildId] || [];
  if (guildDisabled.includes(name)) return true;

  const roleMap = store.roleDisabled[guildId] || {};
  for (const roleId of memberRoles) {
    const list = roleMap[roleId] || [];
    if (list.includes(name)) return true;
  }
  return false;
}

function setGuildDisabled(guildId, commandNames) {
  if (!guildId) throw new Error('guildId required');
  store.disabled[guildId] = (commandNames || []).map(n => String(n).toLowerCase());
  saveStore();
  return store.disabled[guildId];
}

function setRoleDisabled(guildId, roleId, commandNames) {
  if (!guildId || !roleId) throw new Error('guildId and roleId required');
  if (!store.roleDisabled[guildId]) store.roleDisabled[guildId] = {};
  store.roleDisabled[guildId][roleId] = (commandNames || []).map(n => String(n).toLowerCase());
  saveStore();
  return store.roleDisabled[guildId][roleId];
}

function getDisabled(guildId) {
  return {
    guild: store.disabled[guildId] || [],
    roles: store.roleDisabled[guildId] || {},
  };
}

/** Build SlashCommandBuilder instances for registration */
function buildSlashBuilders() {
  return store.commands
    .filter(c => c.enabled)
    .map(c =>
      new SlashCommandBuilder()
        .setName(c.name)
        .setDescription(c.description || 'Custom command')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
    );
}

async function registerCustomCommands(client) {
  if (!client?.user?.id || !process.env.DISCORD_TOKEN) return { registered: 0 };

  const { REST, Routes } = require('discord.js');
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  // Register global custom commands only (guild-scoped ones stay in-memory for message fallback)
  const globalCmds = store.commands.filter(c => c.enabled && !c.guildId);
  const body = globalCmds.map(c =>
    new SlashCommandBuilder()
      .setName(c.name)
      .setDescription(c.description || 'Custom command')
      .setIntegrationTypes([0, 1])
      .setContexts([0, 1, 2])
      .toJSON()
  );

  // Merge with built-in by re-registering everything is handled in index; here we only track customs.
  // Actual merge happens in index.js registerCommands.
  return { registered: body.length, body };
}

function getCustomSlashJSON() {
  return store.commands
    .filter(c => c.enabled && !c.guildId)
    .map(c =>
      new SlashCommandBuilder()
        .setName(c.name)
        .setDescription(c.description || 'Custom command')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .toJSON()
    );
}

async function executeCustom(interaction, cmd) {
  if (cmd.responseType === 'embed') {
    await interaction.reply({
      embeds: [
        {
          description: cmd.response,
          color: cmd.embedColor || 0xfdff94,
        },
      ],
    });
  } else {
    await interaction.reply({ content: cmd.response });
  }
}

loadStore();

module.exports = {
  loadStore,
  saveStore,
  listCommands,
  getAllCommands,
  getCommandByName,
  addCommand,
  updateCommand,
  deleteCommand,
  isCommandDisabled,
  setGuildDisabled,
  setRoleDisabled,
  getDisabled,
  buildSlashBuilders,
  registerCustomCommands,
  getCustomSlashJSON,
  executeCustom,
  sanitizeName,
};
