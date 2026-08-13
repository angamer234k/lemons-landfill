const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const FACTS = [
  'Honey never spoils. Archaeologists have found 3000-year-old pots of honey that were still edible.',
  'Octopuses have three hearts and blue blood.',
  'A day on Venus is longer than a year on Venus.',
  'Bananas are berries, but strawberries are not.',
  'Sharks are older than trees — they’ve existed for ~400 million years.',
  'There are more stars in the universe than grains of sand on all of Earth’s beaches.',
  'Wombat poop is cube-shaped.',
  'The Eiffel Tower can be 15 cm taller in summer due to thermal expansion.',
  'A group of flamingos is called a flamboyance.',
  'Otters hold hands while sleeping so they don’t drift apart.',
  'The shortest war in history lasted 38–45 minutes (Britain vs Zanzibar, 1896).',
  'Cows have best friends and get stressed when separated.',
  'A bolt of lightning is five times hotter than the surface of the sun.',
  'Sloths can hold their breath longer than dolphins (up to 40 minutes).',
  'The inventor of the Pringles can is buried in one.',
  'Some cats are allergic to humans.',
  'A single cloud can weigh more than a million pounds.',
  'Kangaroos can’t walk backwards.',
  'The heart of a blue whale is about the size of a small car.',
  'Cleopatra lived closer in time to the moon landing than to the building of the Great Pyramid.',
  'Your stomach gets a new lining every 3–4 days so it doesn’t digest itself.',
  'There are more possible games of chess than atoms in the observable universe.',
  'Hot water freezes faster than cold water under certain conditions (Mpemba effect).',
  'A shrimp’s heart is in its head.',
  'The average person walks the equivalent of three times around the world in a lifetime.',
  'Lemons float, but limes sink.',
  'The unicorn is the national animal of Scotland.',
  'A jiffy is an actual unit of time: 1/100th of a second.',
  'Polar bear skin is black; their fur is transparent.',
  'The longest English word without a vowel is “rhythms”.',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fact')
    .setDescription('Get a random fun fact.')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const fact = FACTS[Math.floor(Math.random() * FACTS.length)];
    const embed = new EmbedBuilder()
      .setTitle('🧠 Random Fact')
      .setDescription(fact)
      .setColor(0xfdff94)
      .setFooter({ text: 'lemonAI facts' });

    await interaction.reply({ embeds: [embed] });
  },
};
