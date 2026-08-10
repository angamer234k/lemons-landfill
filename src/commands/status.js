const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ROBLOX_USER_ID, ROBLOX_GAME_ID, CUSTOM_DESCRIPTION } = require('../config');
const roblox = require('../roblox');

async function fetchPresence() {
  const response = await fetch('https://presence.roblox.com/v1/presence/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userIds: [ROBLOX_USER_ID] }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const presence = data.userPresences?.find(p => p.userId === ROBLOX_USER_ID);
  if (!presence) return { isOnline: false, raw: null };
  const isOnline = presence.placeId === ROBLOX_GAME_ID;
  return { isOnline, raw: presence };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check live Roblox host status.')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const { isOnline, raw } = await fetchPresence();
      const color = isOnline ? 0x00ff00 : 0xff0000;
      const title = isOnline ? 'ONLINE' : 'OFFLINE';

      const embed = new EmbedBuilder()
        .setTitle(`🎮 ${title}`)
        .setDescription(CUSTOM_DESCRIPTION)
        .setColor(color)
        .addFields(
          { name: 'Cached flag', value: roblox.currentIsOnline ? 'ONLINE' : 'OFFLINE', inline: true },
          { name: 'Live check', value: title, inline: true },
          {
            name: 'Place ID',
            value: raw?.placeId ? String(raw.placeId) : 'n/a',
            inline: true,
          }
        )
        .setTimestamp()
        .setFooter({ text: 'Live presence check' });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Status error:', err.message);
      await interaction.editReply(`❌ Failed to check status: ${err.message}`);
    }
  },
};
