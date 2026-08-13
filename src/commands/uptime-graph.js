const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const roblox = require('../roblox');

const PERIODS = {
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '14d': 14 * 24 * 60 * 60 * 1000,
};

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTime(ts) {
  return new Date(ts).toLocaleString('en-GB', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Build a compact sparkline of recent checks (█ = online, ░ = offline) */
function buildSparkline(entries, maxBars = 48) {
  if (entries.length === 0) return 'No data yet';

  // Sample evenly if we have more points than bars
  let points = entries;
  if (entries.length > maxBars) {
    const step = entries.length / maxBars;
    points = [];
    for (let i = 0; i < maxBars; i++) {
      const idx = Math.min(Math.floor(i * step), entries.length - 1);
      points.push(entries[idx]);
    }
  }

  return points.map(e => (e.online ? '█' : '░')).join('');
}

/** Build a readable session list (most recent first, limited) */
function buildSessionList(sessions, limit = 8) {
  if (sessions.length === 0) return 'No sessions recorded yet.';

  const recent = sessions.slice(-limit).reverse();
  const lines = recent.map(s => {
    const icon = s.online ? '🟢' : '🔴';
    const label = s.online ? 'ONLINE ' : 'OFFLINE';
    const start = formatTime(s.start);
    const end = formatTime(s.end);
    const dur = formatDuration(s.end - s.start);
    return `${icon} **${label}** \`${start}\` → \`${end}\` (${dur})`;
  });

  if (sessions.length > limit) {
    lines.push(`_…and ${sessions.length - limit} older session(s)_`);
  }
  return lines.join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('uptime-graph')
    .setDescription('Show a graph + stats of Roblox host uptime history.')
    .addStringOption(opt =>
      opt
        .setName('period')
        .setDescription('How far back to look')
        .setRequired(false)
        .addChoices(
          { name: 'Last 12 hours', value: '12h' },
          { name: 'Last 24 hours', value: '24h' },
          { name: 'Last 3 days', value: '3d' },
          { name: 'Last 7 days', value: '7d' },
          { name: 'Last 14 days', value: '14d' }
        )
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    await interaction.deferReply();

    const periodKey = interaction.options.getString('period') || '24h';
    const sinceMs = PERIODS[periodKey] || PERIODS['24h'];

    const stats = roblox.getUptimeStats(sinceMs);
    const entries = roblox.getHistory(sinceMs);

    if (stats.totalChecks === 0) {
      await interaction.editReply({
        content:
          '📭 No uptime data yet.\n' +
          'The bot needs a few presence checks (every ~10 min) before a graph can be built.',
      });
      return;
    }

    const sparkline = buildSparkline(entries);
    const sessionList = buildSessionList(stats.sessions);

    const pct = stats.uptimePercent.toFixed(1);
    const barFilled = Math.round(stats.uptimePercent / 5); // 20 segments
    const bar =
      '▓'.repeat(barFilled) + '░'.repeat(20 - barFilled);

    const color = stats.currentOnline ? 0x00ff00 : 0xff0000;
    const statusLabel = stats.currentOnline ? 'ONLINE' : 'OFFLINE';

    const embed = new EmbedBuilder()
      .setTitle(`📈 Roblox Host Uptime — ${periodKey}`)
      .setColor(color)
      .setDescription(
        `**Current:** ${statusLabel}\n` +
          `**Uptime:** \`${pct}%\`  \`${bar}\`\n` +
          `**Checks:** \`${stats.onlineChecks}\` online / \`${stats.totalChecks}\` total`
      )
      .addFields(
        {
          name: 'Sparkline (█ online · ░ offline)',
          value: '```\n' + sparkline + '\n```',
          inline: false,
        },
        {
          name: 'Recent sessions',
          value: sessionList,
          inline: false,
        },
        {
          name: 'Longest online',
          value: `\`${formatDuration(stats.longestOnlineMs)}\``,
          inline: true,
        },
        {
          name: 'Longest offline',
          value: `\`${formatDuration(stats.longestOfflineMs)}\``,
          inline: true,
        },
        {
          name: 'Current streak',
          value: `\`${formatDuration(stats.currentStreakMs)}\` ${statusLabel.toLowerCase()}`,
          inline: true,
        }
      )
      .setFooter({
        text: 'History recorded every ~10 min · Times in MSK',
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
