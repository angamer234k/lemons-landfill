const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { CUSTOM_DESCRIPTION } = require('../config');
const roblox = require('../roblox');

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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('host')
    .setDescription('Quick glance at Roblox host status + today’s uptime.')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    await interaction.deferReply();

    const dayMs = 24 * 60 * 60 * 1000;
    const stats = roblox.getUptimeStats(dayMs);
    const isOnline = roblox.currentIsOnline;

    // Last status change from sessions
    let lastChangeText = 'n/a';
    if (stats.sessions && stats.sessions.length > 0) {
      const last = stats.sessions[stats.sessions.length - 1];
      lastChangeText = `${formatTime(last.start)} (${formatDuration(Date.now() - last.start)} ago)`;
    }

    const color = isOnline ? 0x00ff00 : 0xff0000;
    const title = isOnline ? '🟢 ONLINE' : '🔴 OFFLINE';
    const pct = stats.totalChecks > 0 ? stats.uptimePercent.toFixed(1) : '—';

    const embed = new EmbedBuilder()
      .setTitle(`Host status — ${title}`)
      .setDescription(CUSTOM_DESCRIPTION)
      .setColor(color)
      .addFields(
        {
          name: 'Today’s uptime',
          value: stats.totalChecks > 0 ? `\`${pct}%\` (${stats.onlineChecks}/${stats.totalChecks} checks)` : '`No data yet`',
          inline: true,
        },
        {
          name: 'Current streak',
          value:
            stats.totalChecks > 0
              ? `\`${formatDuration(stats.currentStreakMs)}\` ${isOnline ? 'online' : 'offline'}`
              : '`—`',
          inline: true,
        },
        {
          name: 'Last status change',
          value: `\`${lastChangeText}\``,
          inline: false,
        }
      )
      .setFooter({
        text: 'Quick glance · Use /uptime-graph for full history',
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
