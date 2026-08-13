const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

function parseDice(input) {
  const str = (input || 'd20').trim().toLowerCase().replace(/\s+/g, '');
  // forms: d20, 2d6, 2d6+3, 1d20-1, 20 (treated as d20)
  let m = str.match(/^(\d+)?d(\d+)([+-]\d+)?$/);
  if (m) {
    const count = Math.min(Math.max(parseInt(m[1] || '1', 10), 1), 50);
    const sides = Math.min(Math.max(parseInt(m[2], 10), 2), 1000);
    const mod = m[3] ? parseInt(m[3], 10) : 0;
    return { count, sides, mod };
  }
  m = str.match(/^(\d+)$/);
  if (m) {
    const sides = Math.min(Math.max(parseInt(m[1], 10), 2), 1000);
    return { count: 1, sides, mod: 0 };
  }
  return null;
}

function rollDie(sides) {
  return 1 + Math.floor(Math.random() * sides);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll dice (e.g. d20, 2d6, 1d20+3).')
    .addStringOption(opt =>
      opt
        .setName('dice')
        .setDescription('Dice expression — default d20')
        .setRequired(false)
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const expr = interaction.options.getString('dice') || 'd20';
    const parsed = parseDice(expr);

    if (!parsed) {
      await interaction.reply({
        content: '❌ Couldn’t parse that. Try `d20`, `2d6`, or `1d20+5`.',
        ephemeral: true,
      });
      return;
    }

    const { count, sides, mod } = parsed;
    const rolls = [];
    for (let i = 0; i < count; i++) rolls.push(rollDie(sides));
    const sum = rolls.reduce((a, b) => a + b, 0);
    const total = sum + mod;

    const label =
      (count > 1 ? `${count}d${sides}` : `d${sides}`) +
      (mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : '');

    const embed = new EmbedBuilder()
      .setTitle('🎲 Dice roll')
      .setColor(0x5865f2)
      .setDescription(
        `**${label}**\n` +
          (count > 1 || mod ? `Rolls: \`${rolls.join(', ')}\`\n` : '') +
          `## → ${total}`
      )
      .setFooter({ text: `${interaction.user.username} rolled` });

    await interaction.reply({ embeds: [embed] });
  },
};
