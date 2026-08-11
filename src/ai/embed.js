const { EmbedBuilder } = require('discord.js');

function buildAIEmbed({ title, description, embedColor, model, replies, maxReplies, customTitle, customColor }) {
  let desc = description;
  if (desc.length > 4090) desc = desc.slice(0, 4087) + '…';
  const finalTitle = customTitle || title;
  const finalColor = customColor || embedColor;
  return new EmbedBuilder()
    .setTitle(finalTitle)
    .setDescription(desc)
    .setColor(finalColor)
    .setTimestamp()
    .setFooter({ text: `Model: ${model} • Replies: ${replies}/${maxReplies}` });
}

module.exports = { buildAIEmbed };
