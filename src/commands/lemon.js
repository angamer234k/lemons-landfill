const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const LEMON_LINES = [
  'When life gives you lemons… make a Discord bot and overengineer it.',
  'You are the main squeeze. Don’t forget it.',
  'Stay zesty. The landfill can wait.',
  'A slightly sour attitude is just flavor.',
  'Fresh lemon energy detected. Do not dilute.',
  'If you’re feeling pulp-y, take a break.',
  'Rind tough. Heart soft. Classic lemon.',
  'Warning: excessive zest may cause unsolicited opinions.',
  'This is your sign to hydrate and touch grass (or a lemon tree).',
  'Bitter today, lemonade tomorrow.',
  'You can’t spell “legendary” without… okay you can, but still. Lemon.',
  'The landfill accepts bad takes. Yours might still be salvageable.',
  'Squeeze the day. Not your friends. Unless they ask.',
  'Vitamin C won’t fix your code, but it won’t hurt either.',
  'You are 87% lemon juice and 13% unresolved merge conflicts.',
  'A true lemon never molds — it becomes lore.',
  'Out of juice? Recharge. The host isn’t the only thing that needs uptime.',
  'Mild threat: I will zest you if you skip breakfast.',
  'Lemon oracle says: ship the feature, cry later.',
  'Your vibe is citrus-forward with notes of chaos.',
  'Don’t be mid. Be tart.',
  'If it’s not a little sour, is it even real?',
  'Landfill tip: discard ego, keep the peel of confidence.',
  'You rolled a critical zest. Something good is coming.',
  'The lemon does not ask permission to be bright.',
  'Today’s forecast: partly chaotic with a chance of lemonade.',
  'Remember: even fancy restaurants serve lemon wedges. You’re essential.',
  'Pulpy situations build character. Or at least good stories.',
  'I ran the numbers. You’re still a good lemon.',
  'Go forth and be slightly inconvenient in a helpful way.',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lemon')
    .setDescription('Receive a random lemon fortune, tip, or mild threat.')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const line = LEMON_LINES[Math.floor(Math.random() * LEMON_LINES.length)];
    const embed = new EmbedBuilder()
      .setTitle('🍋 Lemon Oracle')
      .setDescription(line)
      .setColor(0xfdff94)
      .setFooter({ text: 'lemonAI · stay zesty' });

    await interaction.reply({ embeds: [embed] });
  },
};
