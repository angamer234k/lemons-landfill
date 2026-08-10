const { botConfig } = require('../config');

let cachedModelsByProvider = { navy: null, mistral: null };
let cachedModelsAtByProvider = { navy: 0, mistral: 0 };

function getProviderConfig() {
  const p = botConfig.provider === 'mistral' ? 'mistral' : 'navy';
  if (p === 'mistral') {
    return {
      name: 'mistral',
      base: 'https://api.mistral.ai/v1',
      apiKey: process.env.MISTRAL_API_KEY,
      keyEnv: 'MISTRAL_API_KEY',
    };
  }
  return {
    name: 'navy',
    base: 'https://api.navy/v1',
    apiKey: process.env.NAVY_API_KEY,
    keyEnv: 'NAVY_API_KEY',
  };
}

async function fetchTextModels(provider = botConfig.provider) {
  const p = provider === 'mistral' ? 'mistral' : 'navy';
  const now = Date.now();
  if (cachedModelsByProvider[p] && now - cachedModelsAtByProvider[p] < 5 * 60 * 1000) {
    return cachedModelsByProvider[p];
  }

  try {
    if (p === 'mistral') {
      const key = process.env.MISTRAL_API_KEY;
      if (!key) {
        return [
          { id: 'mistral-small-latest', multiplier: 1, premium: false },
          { id: 'mistral-medium-latest', multiplier: 1, premium: false },
        ];
      }
      const res = await fetch('https://api.mistral.ai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const models = (data.data || [])
        .filter(m => {
          const id = (m.id || '').toLowerCase();
          if (id.includes('embed')) return false;
          if (id.includes('moderation')) return false;
          return true;
        })
        .map(m => ({ id: m.id, multiplier: 1, premium: false }))
        .sort((a, b) => a.id.localeCompare(b.id));
      cachedModelsByProvider.mistral = models.length
        ? models
        : [
            { id: 'mistral-small-latest', multiplier: 1, premium: false },
            { id: 'mistral-medium-latest', multiplier: 1, premium: false },
            { id: 'mistral-large-latest', multiplier: 1, premium: false },
          ];
      cachedModelsAtByProvider.mistral = now;
      return cachedModelsByProvider.mistral;
    }

    const res = await fetch('https://api.navy/v1/models');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.data || [])
      .filter(m => {
        if (m.endpoint && m.endpoint !== '/v1/chat/completions') return false;
        if (Array.isArray(m.output_modalities) && !m.output_modalities.includes('text')) return false;
        if (m.supports_image_output === true && m.supports_vision === false && !m.supports_tools) return false;
        return true;
      })
      .map(m => ({
        id: m.id,
        multiplier: typeof m.token_multiplier === 'number' ? m.token_multiplier : 1,
        premium: !!m.premium,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    cachedModelsByProvider.navy = models;
    cachedModelsAtByProvider.navy = now;
    return models;
  } catch (err) {
    console.error(`Failed to fetch ${p} models:`, err.message);
    if (cachedModelsByProvider[p]) return cachedModelsByProvider[p];
    if (p === 'mistral') {
      return [
        { id: 'mistral-small-latest', multiplier: 1, premium: false },
        { id: 'mistral-medium-latest', multiplier: 1, premium: false },
        { id: 'mistral-large-latest', multiplier: 1, premium: false },
      ];
    }
    return [
      { id: 'gpt-3.5-turbo', multiplier: 1, premium: false },
      { id: 'gpt-4o-mini', multiplier: 1, premium: false },
      { id: 'mistral', multiplier: 1, premium: false },
    ];
  }
}

function formatModelChoice(m) {
  if (botConfig.provider === 'mistral') {
    return { name: m.id.slice(0, 100), value: m.id };
  }
  const mult = m.multiplier === 0 ? 'free' : `×${m.multiplier}`;
  const prem = m.premium ? ' ★' : '';
  const name = `${m.id} (${mult})${prem}`;
  return { name: name.slice(0, 100), value: m.id };
}

module.exports = {
  getProviderConfig,
  fetchTextModels,
  formatModelChoice,
};
