const { EmbedBuilder } = require('discord.js');
const {
  ROBLOX_USER_ID,
  ROBLOX_GAME_ID,
  DISCORD_CHANNEL_ID,
  CUSTOM_DESCRIPTION,
} = require('./config');

let statusMessage = null;
let currentIsOnline = false;

function buildEmbed(isOnline) {
  const color = isOnline ? 0x00FF00 : 0xFF0000;
  const title = isOnline ? 'ONLINE' : 'OFFLINE';
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(CUSTOM_DESCRIPTION)
    .setColor(color)
    .setTimestamp()
    .setFooter({ text: 'Last updated' });
}

async function updateStatusEmbed(client, isOnline) {
  currentIsOnline = isOnline;
  let channel = client.channels.cache.get(DISCORD_CHANNEL_ID);
  if (!channel) {
    try {
      channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    } catch (error) {
      console.error('Could not locate the status channel:', error.message);
      return;
    }
  }
  if (!channel) return;
  const embed = buildEmbed(isOnline);
  try {
    if (statusMessage) {
      await statusMessage.edit({ embeds: [embed] });
    } else {
      statusMessage = await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    if (error.code === 10008) statusMessage = null;
  }
}

async function checkPresence(client) {
  try {
    const response = await fetch('https://presence.roblox.com/v1/presence/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: [ROBLOX_USER_ID] }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const presence = data.userPresences?.find(p => p.userId === ROBLOX_USER_ID);
    if (!presence) return;
    const isOnline = presence.placeId === ROBLOX_GAME_ID;
    await updateStatusEmbed(client, isOnline);
    console.log(`Status: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
  } catch (error) {
    console.error('Error checking presence:', error.message);
  }
}

module.exports = {
  updateStatusEmbed,
  checkPresence,
  get currentIsOnline() {
    return currentIsOnline;
  },
};
