const { EmbedBuilder } = require('discord.js');

function buildAIEmbed({ title, description, embedColor, model, replies, maxReplies }) {
  let desc = description;
  if (desc.length > 4090) desc = desc.slice(0, 4087) + '…';
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setColor(embedColor)
    .setTimestamp()
    .setFooter({ text: `Model: ${model} • Replies: ${replies}/${maxReplies}` });
}

module.exports = { buildAIEmbed };
