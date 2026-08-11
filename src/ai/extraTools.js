const { getWeather } = require('../utils/weather');

const reminders = new Map();

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

/** DuckDuckGo Instant Answer API – good for entities / definitions, often empty otherwise */
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

/**
 * Scrape organic results from DuckDuckGo HTML endpoint (no JS, no key).
 * This is what actually returns real web results.
 */
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
  // Each result block roughly looks like:
  // <a class="result__a" href="...">Title</a>
  // ... class="result__snippet">snippet</...>
  const blockRe =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td)>)/gi;

  let m;
  while ((m = blockRe.exec(html)) !== null && results.length < 6) {
    let href = m[1];
    // DDG wraps external links: //duckduckgo.com/l/?uddg=ENCODED&...
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try {
        href = decodeURIComponent(uddg[1]);
      } catch {
        /* keep original */
      }
    }
    // skip internal / ad links
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

  // Fallback simpler parse if the combined regex missed
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

  // 1) Instant answer (fast, sparse)
  try {
    const instant = await searchInstantAnswer(q);
    if (instant && instant.length) {
      out.results.push(...instant);
      out.sources.push('instant');
    }
  } catch (err) {
    console.error('search_web instant error:', err.message);
  }

  // 2) Organic results (the real search)
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

  // Keep payload small for the model
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

  return null;
}

module.exports = { extraToolDefs, executeExtraTool };
