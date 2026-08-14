const fs = require('fs');
const path = require('path');
const STORE_FILE = path.join(process.cwd(), 'custom_commands.json');
let store = { commands: [], disabled: {}, roleDisabled: {} };

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      store = {
        commands: Array.isArray(raw.commands) ? raw.commands.map(migrate) : [],
        disabled: raw.disabled || {},
        roleDisabled: raw.roleDisabled || {},
      };
    }
  } catch (e) { console.error('custom_commands load:', e.message); }
}
function saveStore() {
  try { fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2)); }
  catch (e) { console.error('custom_commands save:', e.message); }
}
function migrate(c) {
  if (Array.isArray(c.actions) && c.actions.length) return c;
  const actions = [];
  if (c.response) {
    actions.push({
      id: 'a_legacy', type: 'reply',
      content: c.responseType === 'embed' ? '' : c.response,
      embed: c.responseType === 'embed' ? { description: c.response, color: c.embedColor || 0xfdff94 } : null,
      ephemeral: false,
    });
  }
  return { ...c, actions, options: c.options || [] };
}
function sanitizeName(n) {
  return String(n || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}
function getAllCommands() { return store.commands.slice(); }
function getCommandByName(name, guildId = null) {
  const n = sanitizeName(name);
  return store.commands.find(c => c.enabled && c.name === n && (!c.guildId || c.guildId === guildId))
    || store.commands.find(c => c.enabled && c.name === n && !c.guildId);
}
function validateActions(actions) {
  if (!Array.isArray(actions) || !actions.length) throw new Error('Flow needs at least one action');
  const ok = new Set(['reply','edit_reply','dm','add_role','remove_role','react','wait','condition','send_channel','delete_reply','timeout','nickname','random_reply','stop','log']);
  for (const a of actions) if (!a || !ok.has(a.type)) throw new Error('Unknown action type: ' + a?.type);
}
function normOpts(opts) {
  if (!Array.isArray(opts)) return [];
  return opts.slice(0, 10).map(o => ({
    name: sanitizeName(o.name) || 'opt',
    description: String(o.description || 'option').slice(0, 100),
    type: ['string','integer','boolean','user','role','channel'].includes(o.type) ? o.type : 'string',
    required: !!o.required,
  }));
}
function normAction(a) {
  const id = a.id || ('a_' + Math.random().toString(36).slice(2, 9));
  const base = { id, type: a.type };
  if (['reply','edit_reply','dm','send_channel'].includes(a.type)) {
    return {
      ...base,
      content: String(a.content || '').slice(0, 2000),
      embed: a.embed && typeof a.embed === 'object' ? {
        title: String(a.embed.title || '').slice(0, 256),
        description: String(a.embed.description || '').slice(0, 4000),
        color: typeof a.embed.color === 'number' ? a.embed.color : 0xfdff94,
        footer: String(a.embed.footer || '').slice(0, 200),
      } : null,
      ephemeral: !!a.ephemeral,
      channelId: a.channelId ? String(a.channelId) : null,
      target: a.target === 'option' ? 'option' : 'invoker',
      optionName: a.optionName ? sanitizeName(a.optionName) : null,
    };
  }
  if (a.type === 'add_role' || a.type === 'remove_role') {
    return { ...base, roleId: String(a.roleId || ''), target: a.target === 'option' ? 'option' : 'invoker', optionName: a.optionName ? sanitizeName(a.optionName) : null };
  }
  if (a.type === 'react') return { ...base, emoji: String(a.emoji || '🍋').slice(0, 64) };
  if (a.type === 'wait') return { ...base, ms: Math.min(15000, Math.max(0, Number(a.ms) || 0)) };
  if (a.type === 'condition') {
    return {
      ...base,
      when: ['has_role','missing_role','is_owner','option_equals','option_truthy'].includes(a.when) ? a.when : 'has_role',
      roleId: a.roleId ? String(a.roleId) : null,
      optionName: a.optionName ? sanitizeName(a.optionName) : null,
      equals: a.equals != null ? String(a.equals) : null,
      skipOnFail: Math.min(20, Math.max(1, Number(a.skipOnFail) || 1)),
    };
  }
  if (a.type === 'delete_reply') return base;
  if (a.type === 'timeout') {
    return {
      ...base,
      seconds: Math.min(2419200, Math.max(0, Number(a.seconds) || 60)),
      target: a.target === 'option' ? 'option' : 'invoker',
      optionName: a.optionName ? sanitizeName(a.optionName) : null,
      reason: String(a.reason || 'flow').slice(0, 200),
    };
  }
  if (a.type === 'nickname') {
    return {
      ...base,
      nick: String(a.nick || '').slice(0, 32),
      target: a.target === 'option' ? 'option' : 'invoker',
      optionName: a.optionName ? sanitizeName(a.optionName) : null,
    };
  }
  if (a.type === 'random_reply') {
    const choices = Array.isArray(a.choices) ? a.choices.map(x => String(x).slice(0, 500)).filter(Boolean).slice(0, 25) : [];
    return { ...base, choices, ephemeral: !!a.ephemeral };
  }
  if (a.type === 'stop') return base;
  if (a.type === 'log') {
    return {
      ...base,
      content: String(a.content || '').slice(0, 1000),
      channelId: a.channelId ? String(a.channelId) : null,
    };
  }
  return base;
}
function addCommand(data) {
  const name = sanitizeName(data.name);
  if (!name) throw new Error('Invalid command name');
  if (store.commands.some(c => c.name === name && (c.guildId || null) === (data.guildId || null)))
    throw new Error('Command /' + name + ' already exists for this scope');
  let actions = Array.isArray(data.actions) ? data.actions : [];
  if ((!actions || !actions.length) && data.response) {
    actions = [{
      type: 'reply',
      content: data.responseType === 'embed' ? '' : String(data.response),
      embed: data.responseType === 'embed' ? { description: String(data.response), color: 0xfdff94 } : null,
      ephemeral: false,
    }];
  }
  validateActions(actions);
  const cmd = {
    id: Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    name,
    description: String(data.description || 'Custom flow command').slice(0, 100),
    options: normOpts(data.options),
    actions: actions.map(normAction),
    guildId: data.guildId || null,
    createdBy: data.createdBy || 'unknown',
    createdAt: Date.now(),
    enabled: data.enabled !== false,
  };
  store.commands.push(cmd); saveStore(); return cmd;
}
function updateCommand(id, patch) {
  const idx = store.commands.findIndex(c => c.id === id);
  if (idx === -1) throw new Error('Command not found');
  const cur = store.commands[idx];
  if (patch.name !== undefined) {
    const name = sanitizeName(patch.name);
    if (!name) throw new Error('Invalid command name');
    if (store.commands.some(c => c.id !== id && c.name === name && (c.guildId || null) === (cur.guildId || null)))
      throw new Error('Command /' + name + ' already exists');
    cur.name = name;
  }
  if (patch.description !== undefined) cur.description = String(patch.description).slice(0, 100);
  if (patch.actions !== undefined) { validateActions(patch.actions); cur.actions = patch.actions.map(normAction); }
  if (patch.options !== undefined) cur.options = normOpts(patch.options);
  if (typeof patch.enabled === 'boolean') cur.enabled = patch.enabled;
  delete cur.response; delete cur.responseType; delete cur.embedColor;
  saveStore(); return cur;
}
function deleteCommand(id) {
  const idx = store.commands.findIndex(c => c.id === id);
  if (idx === -1) throw new Error('Command not found');
  const [removed] = store.commands.splice(idx, 1); saveStore(); return removed;
}
function isCommandDisabled(guildId, commandName, memberRoles = []) {
  if (!guildId) return false;
  const name = String(commandName).toLowerCase();
  if ((store.disabled[guildId] || []).includes(name)) return true;
  const roleMap = store.roleDisabled[guildId] || {};
  for (const roleId of memberRoles) if ((roleMap[roleId] || []).includes(name)) return true;
  return false;
}
function setGuildDisabled(guildId, commandNames) {
  if (!guildId) throw new Error('guildId required');
  store.disabled[guildId] = (commandNames || []).map(n => String(n).toLowerCase());
  saveStore(); return store.disabled[guildId];
}
function setRoleDisabled(guildId, roleId, commandNames) {
  if (!guildId || !roleId) throw new Error('guildId and roleId required');
  if (!store.roleDisabled[guildId]) store.roleDisabled[guildId] = {};
  store.roleDisabled[guildId][roleId] = (commandNames || []).map(n => String(n).toLowerCase());
  saveStore(); return store.roleDisabled[guildId][roleId];
}
function getDisabled(guildId) {
  return { guild: store.disabled[guildId] || [], roles: store.roleDisabled[guildId] || {} };
}
loadStore();
module.exports = {
  loadStore, saveStore, sanitizeName, getAllCommands, getCommandByName,
  addCommand, updateCommand, deleteCommand, isCommandDisabled, setGuildDisabled, setRoleDisabled, getDisabled,
  normOpts, normAction, validateActions,
};
