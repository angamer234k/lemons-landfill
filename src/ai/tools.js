const os = require('os');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { botConfig } = require('../config');
const {
  safeEditMessage,
  extractThink,
  stripHiddenReasoning,
} = require('../utils');
const { getNetworkToolDefs, runNetworkTool } = require('./networkTools');
const { getExtraToolDefs, runExtraTool } = require('./extraTools');

// Meta tools always available so the model can discover + enable more
const META_TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'list_tools',
      description: 'List all available tool names and short descriptions. Call this when you need capabilities you do not currently have.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enable_tools',
      description: 'Enable one or more tools by name so their full schemas become available for subsequent calls. Prefer enabling only what you need.',
      parameters: {
        type: 'object',
        properties: {
          names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Exact tool names to enable (from list_tools)',
          },
        },
        required: ['names'],
      },
    },
  },
];

// Conversation helpers that are cheap and frequently useful
const ALWAYS_ON_HELPERS = [
  'web_search',
  'fetch_url',
  'code_interpreter',
  'run_python',
];

function getAllToolDefs() {
  // Full catalog (network + extra + any others registered)
  const network = getNetworkToolDefs();
  const extra = getExtraToolDefs();
  // Deduplicate by name
  const byName = new Map();
  for (const t of [...network, ...extra]) {
    const n = t.function?.name || t.name;
    if (n) byName.set(n, t);
  }
  return Array.from(byName.values());
}

function getToolsForUser(enabledNames) {
  const all = getAllToolDefs();
  const enabled = new Set(enabledNames || []);
  // Always include meta tools
  const out = [...META_TOOL_DEFS];
  for (const t of all) {
    const n = t.function?.name || t.name;
    if (enabled.has(n) || ALWAYS_ON_HELPERS.includes(n)) {
      out.push(t);
    }
  }
  return out;
}

function inferToolsFromMessage(text) {
  if (!text || typeof text !== 'string') return [];
  const t = text.toLowerCase();
  const wanted = new Set();

  // Network / recon keywords
  if (/\b(dns|whois|ssl|tls|cert|certificate|ip info|cidr|http probe|redirect|website up|email dns|security audit|api probe|http request)\b/.test(t) ||
      /\b(lookup|inspect|probe|scan host|check site|headers|status code)\b/.test(t) ||
      /https?:\/\//.test(t) ||
      /\b[a-z0-9.-]+\.[a-z]{2,}\b/.test(t)) {
    for (const n of ['dns_lookup','whois_lookup','ssl_inspect','ip_info','http_probe','redirect_trace','website_up','email_dns','cidr_info','security_audit','http_request','api_probe']) {
      wanted.add(n);
    }
  }

  // Code / python
  if (/\b(python|code|script|run code|execute|calculate|math|plot)\b/.test(t)) {
    wanted.add('code_interpreter');
    wanted.add('run_python');
  }

  // Web
  if (/\b(search|google|look up|find info|news|what is)\b/.test(t)) {
    wanted.add('web_search');
    wanted.add('fetch_url');
  }

  return Array.from(wanted);
}

async function runTool(name, args, ctx) {
  if (name === 'list_tools') {
    const all = getAllToolDefs();
    const lines = all.map(t => {
      const n = t.function?.name || t.name;
      const d = t.function?.description || t.description || '';
      return `- ${n}: ${d.slice(0, 120)}`;
    });
    return { ok: true, tools: lines.join('\n') };
  }
  if (name === 'enable_tools') {
    const names = Array.isArray(args?.names) ? args.names : [];
    return { ok: true, enabled: names, note: 'Tools will be available on next model turn' };
  }

  // Network tools
  if (typeof runNetworkTool === 'function') {
    const netResult = await runNetworkTool(name, args, ctx);
    if (netResult !== undefined) return netResult;
  }
  // Extra tools
  if (typeof runExtraTool === 'function') {
    const extraResult = await runExtraTool(name, args, ctx);
    if (extraResult !== undefined) return extraResult;
  }

  return { ok: false, error: `Unknown tool: ${name}` };
}

module.exports = {
  getAllToolDefs,
  getToolsForUser,
  inferToolsFromMessage,
  runTool,
  META_TOOL_DEFS,
  ALWAYS_ON_HELPERS,
};
