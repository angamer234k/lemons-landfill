const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const os = require('os');
const { botConfig } = require('../config');

async function getNavyUsage() {
  const apiKey = process.env.NAVY_API_KEY;
  try {
    const response = await fetch('https://api.navy/v1/usage', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function getUptime(startTime) {
  const diff = Date.now() - startTime;
  const seconds = Math.floor(diff / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

function getSystemInfo() {
  const platform = os.platform();
  const arch = os.arch();
  const cpus = os.cpus();
  const totalMem = os.totalmem() / 1024 ** 3;
  const freeMem = os.freemem() / 1024 ** 3;
  const usedMem = totalMem - freeMem;
  const loadAvg = os.loadavg();
  return {
    os: `${platform} ${arch}`,
    cpu: `${cpus.length} cores`,
    ram: `${usedMem.toFixed(2)} GB / ${totalMem.toFixed(2)} GB (${((usedMem / totalMem) * 100).toFixed(1)}%)`,
    load: loadAvg.map(l => l.toFixed(2)).join(' '),
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show bot stats, AI usage, and system info.')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction, ctx) {
    await interaction.deferReply();
    const usageData = await getNavyUsage();
    let usageText = 'N/A';

    if (usageData) {
      if (usageData.plan && usageData.usage && usageData.limits) {
        const pct =
          typeof usageData.usage.percent_used === 'number'
            ? usageData.usage.percent_used.toFixed(1)
            : '0.0';
        usageText =
          `* **Plan**: \`${usageData.plan}\`\n` +
          `* **Daily Tokens**: \`${(usageData.usage.tokens_used_today || 0).toLocaleString()}\` / \`${(usageData.limits.tokens_per_day || 0).toLocaleString()}\` (${pct}%)\n` +
          `* **Requests Per Minute**: \`${usageData.rate_limits?.per_minute?.used || 0}\` / \`${usageData.rate_limits?.per_minute?.limit || usageData.limits.rpm || '?'}\``;
      } else if (typeof usageData === 'object') {
        const parts = [];
        if (usageData.used !== undefined) parts.push(`* **Used**: \`${usageData.used}\``);
        if (usageData.remaining !== undefined) parts.push(`* **Remaining**: \`${usageData.remaining}\``);
        if (usageData.limit !== undefined) parts.push(`* **Daily Limit**: \`${usageData.limit}\``);
        if (usageData.daily_limit !== undefined) parts.push(`* **Daily Limit**: \`${usageData.daily_limit}\``);
        usageText = parts.length > 0 ? parts.join('\n') : '```json\n' + JSON.stringify(usageData, null, 2) + '\n```';
      } else {
        usageText = String(usageData);
      }
    }

    const systemInfo = getSystemInfo();
    const uptime = getUptime(ctx.startTime);
    const ping = ctx.client.ws.ping;

    const embed = new EmbedBuilder()
      .setTitle('📊 Bot Statistics')
      .setColor(0x5865F2)
      .addFields(
        { name: '🤖 AI Usage (Navy)', value: usageText, inline: false },
        { name: '🔌 Provider', value: `\`${botConfig.provider}\``, inline: true },
        { name: '🧠 Active Model', value: `\`${botConfig.aiModel}\``, inline: true },
        { name: '🕐 Uptime', value: `\`${uptime}\``, inline: true },
        { name: '📶 Ping', value: `\`${ping}ms\``, inline: true },
        { name: '💾 RAM', value: `\`${systemInfo.ram}\``, inline: true },
        { name: '🖥️ OS', value: `\`${systemInfo.os}\``, inline: true },
        { name: '⚙️ CPU', value: `\`${systemInfo.cpu}\``, inline: true },
        { name: '📊 Load', value: `\`${systemInfo.load}\``, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Stats automatically update live' });

    await interaction.editReply({ embeds: [embed] });
  },
};
