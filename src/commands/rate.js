const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

function seededScore(str) {
  // Stable-ish score from string so same input ≈ same rating in a session vibe,
  // but still feels random across different inputs.
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  // Mix with a light time bucket so it's not permanently fixed forever
  const bucket = Math.floor(Date.now() / (1000 * 60 * 30)); // changes ~every 30m
  const mixed = Math.abs(hash ^ bucket);
  return mixed % 11; // 0–10
}

function verdict(score) {
  if (score <= 1) return ['trash-tier', 'The landfill is calling.'];
  if (score <= 3) return ['mid', 'Not illegal, just unfortunate.'];
  if (score <= 5) return ['okay-ish', 'Could be juiced into something better.'];
  if (score <= 7) return ['solid', 'Respectable citrus energy.'];
  if (score <= 9) return ['goated', 'Main-squeeze material.'];
  return ['perfect 10', 'Peak lemon. Do not dilute.'];
}

function bar(score) {
  const filled = '🍋'.repeat(score);
  const empty = '⚪'.repeat(10 - score);
  return filled + empty;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rate')
    .setDescription('Rate anything from 0 to 10.')
    .addStringOption(opt =>
      opt
        .setName('thing')
        .setDescription('What should be rated?')
        .setRequired(true)
        .setMaxLength(200)
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const thing = interaction.options.getString('thing', true).trim();
    const score = seededScore(thing.toLowerCase());
    const [label, comment] = verdict(score);

    const embed = new EmbedBuilder()
      .setTitle('📊 Rating')
      .setColor(score >= 7 ? 0x57f287 : score >= 4 ? 0xfee75c : 0xed4245)
      .setDescription(
        `**${thing}**\n\n` +
          `## ${score}/10 — ${label}\n` +
          `${bar(score)}\n\n` +
          `*${comment}*`
      )
      .setFooter({ text: 'lemonAI ratings · highly scientific' });

    await interaction.reply({ embeds: [embed] });
  },
};
