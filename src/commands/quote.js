const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const QUOTES = [
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
  { text: 'In the middle of difficulty lies opportunity.', author: 'Albert Einstein' },
  { text: 'It does not matter how slowly you go as long as you do not stop.', author: 'Confucius' },
  { text: 'Everything you can imagine is real.', author: 'Pablo Picasso' },
  { text: 'Simplicity is the ultimate sophistication.', author: 'Leonardo da Vinci' },
  { text: 'Do what you can, with what you have, where you are.', author: 'Theodore Roosevelt' },
  { text: 'The best time to plant a tree was 20 years ago. The second best time is now.', author: 'Chinese Proverb' },
  { text: 'Stay hungry, stay foolish.', author: 'Stewart Brand / Steve Jobs' },
  { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', author: 'Aristotle' },
  { text: 'Life is what happens when you’re busy making other plans.', author: 'John Lennon' },
  { text: 'Be yourself; everyone else is already taken.', author: 'Oscar Wilde' },
  { text: 'If you want to go fast, go alone. If you want to go far, go together.', author: 'African Proverb' },
  { text: 'The future belongs to those who believe in the beauty of their dreams.', author: 'Eleanor Roosevelt' },
  { text: 'Not all those who wander are lost.', author: 'J.R.R. Tolkien' },
  { text: 'It always seems impossible until it’s done.', author: 'Nelson Mandela' },
  { text: 'Creativity is intelligence having fun.', author: 'Albert Einstein' },
  { text: 'A lemon a day keeps the blandness away.', author: 'lemonAI' },
  { text: 'When life gives you lemons, make a Discord bot.', author: 'lemonAI' },
  { text: 'Ship it. Fix it later. (Within reason.)', author: 'Every developer eventually' },
  { text: 'The code works on my machine.', author: 'Anonymous' },
  { text: 'First, solve the problem. Then, write the code.', author: 'John Johnson' },
  { text: 'Talk is cheap. Show me the code.', author: 'Linus Torvalds' },
  { text: 'Programs must be written for people to read, and only incidentally for machines to execute.', author: 'Harold Abelson' },
  { text: 'The only true wisdom is in knowing you know nothing.', author: 'Socrates' },
  { text: 'You miss 100% of the shots you don’t take.', author: 'Wayne Gretzky' },
  { text: 'Whether you think you can or you think you can’t, you’re right.', author: 'Henry Ford' },
  { text: 'Happiness is not something ready-made. It comes from your own actions.', author: 'Dalai Lama' },
  { text: 'The quieter you become, the more you can hear.', author: 'Ram Dass' },
  { text: 'Done is better than perfect.', author: 'Sheryl Sandberg' },
  { text: 'Make it work, make it right, make it fast.', author: 'Kent Beck' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quote')
    .setDescription('Get a random quote.')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    const embed = new EmbedBuilder()
      .setTitle('💬 Quote')
      .setDescription(`*"${q.text}"*

— **${q.author}**`)
      .setColor(0x5865f2)
      .setFooter({ text: 'lemonAI quotes' });

    await interaction.reply({ embeds: [embed] });
  },
};
