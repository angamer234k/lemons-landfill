const net = require('net');
const dns = require('dns').promises;
const { getWeather } = require('../utils/weather');

const reminders = new Map();

// HTTP tool limits (only these)
const HTTP_TIMEOUT_MS = 12_000;
const HTTP_MAX_BODY_BYTES = 150_000; // ~150 KB — keeps model context sane

const extraToolDefs = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather for a city using Open-Meteo.',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string', description: 'City name, e.g. London or Tokyo' } },
        required: ['city'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description: 'Set a reminder for the current user. They will be DMed after the delay.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'What to remind them about' },
          minutes: { type: 'number', description: 'Minutes from now (0.5 to 10080)', minimum: 0.5, maximum: 10080 },
        },
        required: ['text', 'minutes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description:
        'Search the web for current information, facts, news, or anything not in your training data. Returns a short instant answer (when available) plus organic search results (title, snippet, url). Prefer this over guessing.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search query' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description:
        'Fetch a URL over HTTP(S) and return status, headers summary, and response body text (truncated). Use to read web pages, APIs, raw content, etc.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL including https://' },
          method: {
            type: 'string',
            description: 'HTTP method',
            enum: ['GET', 'HEAD', 'POST'],
          },
          headers: {
            type: 'object',
            description: 'Optional request headers as key-value strings',
          },
          body: {
            type: 'string',
            description: 'Optional request body (for POST)',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ping_host',
      description:
        'Check if a host is reachable. Resolves DNS and opens a TCP connection to a port (default 80, or 443 for https-looking hosts). Returns latency in ms.',
      parameters: {
        type: 'object',
        properties: {
          host: { type: 'string', description: 'Hostname or IP, e.g. example.com or 1.1.1.1' },
          port: { type: 'integer', description: 'TCP port (1-65535). Default 80, or 443 if host looks like https.' },
        },
        required: ['host'],
      },
    },
  },
];

const UA = 'Mozilla/5.0 (compatible; lemonAI-bot/1.1; +https://github.com/angamer234k/lemons-landfill)';

async function fetchWithTimeout(url, options = {}, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Read response body with a hard byte cap. */
async function readBodyCapped(res, maxBytes = HTTP_MAX_BODY_BYTES) {
  if (!res.body) {
    const text = await res.text();
    const buf = Buffer.from(text, 'utf8');
    if (buf.length <= maxBytes) return { text, bytes: buf.length, truncated: false };
    return {
      text: buf.subarray(0, maxBytes).toString('utf8'),
      bytes: maxBytes,
      truncated: true,
      totalHint: buf.length,
    };
  }

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const remaining = maxBytes - total;
    if (remaining <= 0) {
      truncated = true;
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
    if (value.byteLength > remaining) {
      chunks.push(value.slice(0, remaining));
      total += remaining;
      truncated = true;
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }

  const buf = Buffer.concat(chunks.map(c => Buffer.from(c)));
  let text;
  try {
    text = buf.toString('utf8');
  } catch {
    text = buf.toString('latin1');
  }

  return { text, bytes: total, truncated };
}

function pickHeaders(headers) {
  const interesting = [
    'content-type',
    'content-length',
    'content-encoding',
    'server',
    'location',
    'cache-control',
    'last-modified',
    'date',
  ];
  const out = {};
  for (const key of interesting) {
    const v = headers.get(key);
    if (v) out[key] = v;
  }
  return out;
}

async function fetchUrl(args) {
  let url = String(args.url || '').trim();
  if (!url) return { ok: false, error: 'url is required' };
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const method = String(args.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'POST'].includes(method)) {
    return { ok: false, error: 'method must be GET, HEAD, or POST' };
  }

  const headers = { 'User-Agent': UA, Accept: '*/*' };
  if (args.headers && typeof args.headers === 'object') {
    for (const [k, v] of Object.entries(args.headers)) {
      if (v == null) continue;
      headers[String(k)] = String(v);
    }
  }

  const init = { method, headers, redirect: 'follow' };
  if (method === 'POST' && args.body != null) {
    init.body = String(args.body);
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const started = Date.now();
  try {
    const res = await fetchWithTimeout(url, init, HTTP_TIMEOUT_MS);
    const elapsed_ms = Date.now() - started;

    const summary = {
      ok: true,
      url: res.url || url,
      status: res.status,
      statusText: res.statusText,
      redirected: res.redirected,
      headers: pickHeaders(res.headers),
      elapsed_ms,
    };

    if (method === 'HEAD') {
      return summary;
    }

    const body = await readBodyCapped(res, HTTP_MAX_BODY_BYTES);
    summary.body_bytes = body.bytes;
    summary.body_truncated = body.truncated;
    if (body.truncated) {
      summary.note = `Body truncated to ${HTTP_MAX_BODY_BYTES} bytes.`;
    }
    summary.body = body.text;
    return summary;
  } catch (err) {
    const elapsed_ms = Date.now() - started;
    const msg = err?.name === 'AbortError' ? `Timed out after ${HTTP_TIMEOUT_MS}ms` : err.message;
    return { ok: false, error: msg, elapsed_ms, url };
  }
}

function normalizeHostPort(host, port) {
  let h = String(host || '').trim();
  let p = port != null ? Number(port) : NaN;

  h = h.replace(/^https?:\/\//i, '');
  h = h.split('/')[0];
  if (h.includes(':') && !h.startsWith('[')) {
    const parts = h.split(':');
    if (parts.length === 2 && /^\d+$/.test(parts[1])) {
      h = parts[0];
      if (!Number.isFinite(p)) p = Number(parts[1]);
    }
  }

  if (!Number.isFinite(p) || p < 1 || p > 65535) {
    p = 80;
    if (String(host).toLowerCase().includes('https')) p = 443;
  }

  return { host: h, port: p };
}

function tcpConnect(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = net.connect({ host, port }, () => {
      const ms = Date.now() - started;
      socket.destroy();
      resolve(ms);
    });
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error(`TCP connect timed out after ${timeoutMs}ms`));
    });
    socket.on('error', err => {
      socket.destroy();
      reject(err);
    });
  });
}

async function pingHost(args) {
  const { host, port } = normalizeHostPort(args.host, args.port);
  if (!host) return { ok: false, error: 'host is required' };

  const started = Date.now();
  let addresses = [];
  try {
    const r = await dns.lookup(host, { all: true });
    addresses = r.map(x => ({ address: x.address, family: x.family }));
  } catch (err) {
    return {
      ok: false,
      error: `DNS lookup failed: ${err.message}`,
      host,
      elapsed_ms: Date.now() - started,
    };
  }

  try {
    const latency_ms = await tcpConnect(host, port, HTTP_TIMEOUT_MS);
    return {
      ok: true,
      host,
      port,
      addresses,
      latency_ms,
      elapsed_ms: Date.now() - started,
      note: 'TCP connect success (not ICMP ping).',
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      host,
      port,
      addresses,
      elapsed_ms: Date.now() - started,
    };
  }
}

async function searchInstantAnswer(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=lemonAI`;
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const data = await res.json();
  const results = [];

  if (data.AbstractText) {
    results.push({
      type: 'abstract',
      text: data.AbstractText,
      source: data.AbstractSource || '',
      url: data.AbstractURL || '',
    });
  }
  if (data.Answer) {
    results.push({ type: 'answer', text: String(data.Answer) });
  }
  if (data.Definition) {
    results.push({
      type: 'definition',
      text: data.Definition,
      source: data.DefinitionSource || '',
      url: data.DefinitionURL || '',
    });
  }
  if (Array.isArray(data.RelatedTopics)) {
    for (const t of data.RelatedTopics.slice(0, 6)) {
      if (t.Text) {
        results.push({ type: 'related', text: t.Text, url: t.FirstURL || '' });
      } else if (Array.isArray(t.Topics)) {
        for (const sub of t.Topics.slice(0, 2)) {
          if (sub.Text) results.push({ type: 'related', text: sub.Text, url: sub.FirstURL || '' });
        }
      }
    }
  }
  return results.length ? results : null;
}

async function searchOrganic(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    },
    9000
  );
  if (!res.ok) throw new Error(`Organic search HTTP ${res.status}`);
  const html = await res.text();

  const results = [];
  const blockRe =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td)>)/gi;

  let m;
  while ((m = blockRe.exec(html)) !== null && results.length < 6) {
    let href = m[1];
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try {
        href = decodeURIComponent(uddg[1]);
      } catch {
        /* keep original */
      }
    }
    if (!href.startsWith('http') || href.includes('duckduckgo.com')) continue;

    const title = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const snippet = (m[3] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!title) continue;

    results.push({
      type: 'organic',
      title: title.slice(0, 200),
      snippet: snippet.slice(0, 300),
      url: href,
    });
  }

  if (results.length === 0) {
    const titleRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = titleRe.exec(html)) !== null && results.length < 5) {
      let href = m[1];
      const uddg = href.match(/[?&]uddg=([^&]+)/);
      if (uddg) {
        try {
          href = decodeURIComponent(uddg[1]);
        } catch {
          /* keep */
        }
      }
      if (!href.startsWith('http') || href.includes('duckduckgo.com')) continue;
      const title = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (title) results.push({ type: 'organic', title: title.slice(0, 200), snippet: '', url: href });
    }
  }

  return results;
}

async function searchWeb(query) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: 'Query is required' };

  const out = { ok: true, query: q, results: [], sources: [] };

  try {
    const instant = await searchInstantAnswer(q);
    if (instant && instant.length) {
      out.results.push(...instant);
      out.sources.push('instant');
    }
  } catch (err) {
    console.error('search_web instant error:', err.message);
  }

  try {
    const organic = await searchOrganic(q);
    if (organic.length) {
      out.results.push(...organic);
      out.sources.push('organic');
    }
  } catch (err) {
    console.error('search_web organic error:', err.message);
  }

  if (out.results.length === 0) {
    out.note =
      'No results returned. The query may be too vague, blocked, or the search providers are temporarily unavailable. Try rephrasing.';
  }

  if (out.results.length > 8) out.results = out.results.slice(0, 8);

  return out;
}

async function executeExtraTool(name, args, context) {
  const { user, client } = context;

  if (name === 'get_weather') {
    const city = String(args.city || '').trim();
    if (!city) return { ok: false, error: 'City is required' };
    return await getWeather(city);
  }

  if (name === 'set_reminder') {
    const text = String(args.text || '').trim();
    let minutes = Number(args.minutes);
    if (!text) return { ok: false, error: 'Reminder text is required' };
    if (!Number.isFinite(minutes) || minutes < 0.5) minutes = 0.5;
    if (minutes > 10080) minutes = 10080;
    const ms = Math.round(minutes * 60 * 1000);
    const at = new Date(Date.now() + ms);
    if (!client) return { ok: false, error: 'Client unavailable for reminders' };

    const timeout = setTimeout(async () => {
      try {
        const u = await client.users.fetch(user.id);
        await u.send({
          embeds: [{ title: '⏰ Reminder', description: text, color: 0xfdff94, timestamp: new Date().toISOString() }],
        });
      } catch (err) {
        console.error('Reminder DM failed:', err.message);
      }
      const list = reminders.get(user.id) || [];
      reminders.set(
        user.id,
        list.filter(r => r.timeout !== timeout)
      );
    }, ms);

    const list = reminders.get(user.id) || [];
    list.push({ timeout, text, at: at.toISOString() });
    reminders.set(user.id, list);

    return {
      ok: true,
      result: {
        text,
        minutes,
        fires_at: at.toISOString(),
        note: 'You will be DMed when the reminder fires. Make sure DMs from the bot are open.',
      },
    };
  }

  if (name === 'search_web') {
    const query = String(args.query || '').trim();
    if (!query) return { ok: false, error: 'Query is required' };
    try {
      return await searchWeb(query);
    } catch (err) {
      console.error('search_web fatal:', err.message);
      return { ok: false, error: `Search failed: ${err.message}` };
    }
  }

  if (name === 'fetch_url') {
    return await fetchUrl(args || {});
  }

  if (name === 'ping_host') {
    return await pingHost(args || {});
  }

  return null;
}

module.exports = { extraToolDefs, executeExtraTool };
