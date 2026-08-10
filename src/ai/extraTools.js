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
      description: 'Search the web (DuckDuckGo instant answers). Good for facts, definitions, quick info.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search query' } },
        required: ['query'],
      },
    },
  },
];

async function searchWeb(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'lemonAI-bot/1.0' } });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const data = await res.json();
  const results = [];
  if (data.AbstractText) {
    results.push({ type: 'abstract', text: data.AbstractText, source: data.AbstractSource || data.AbstractURL || '' });
  }
  if (data.Answer) results.push({ type: 'answer', text: data.Answer });
  if (Array.isArray(data.RelatedTopics)) {
    for (const t of data.RelatedTopics.slice(0, 5)) {
      if (t.Text) results.push({ type: 'related', text: t.Text, url: t.FirstURL || '' });
      else if (t.Topics) {
        for (const sub of t.Topics.slice(0, 2)) {
          if (sub.Text) results.push({ type: 'related', text: sub.Text, url: sub.FirstURL || '' });
        }
      }
    }
  }
  if (results.length === 0) {
    return { ok: true, query, results: [], note: 'No instant answers. Try a more specific query.' };
  }
  return { ok: true, query, results };
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
      reminders.set(user.id, list.filter(r => r.timeout !== timeout));
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
    return await searchWeb(query);
  }

  return null;
}

module.exports = { extraToolDefs, executeExtraTool };
