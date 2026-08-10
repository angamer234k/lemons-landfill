/**
 * Safe Discord message helpers + fun utility functions.
 */

async function safeEditMessage(message, payload, interaction = null) {
  const messageId = message?.id || interaction?.message?.id;
  if (!messageId) return false;

  // 1) Interaction webhook — reliable path for user-installed apps
  if (interaction?.webhook) {
    try {
      await interaction.webhook.editMessage(messageId, payload);
      return true;
    } catch (err) {
      // fall through
    }
  }

  // 2) Direct message.edit
  if (message) {
    try {
      await message.edit(payload);
      return true;
    } catch (err) {
      // ChannelNotCached / Missing Access — expected on user installs
    }
  }

  return false;
}

async function safeDeleteMessage(message, interaction = null) {
  const messageId = message?.id || interaction?.message?.id;
  if (!messageId) return false;

  if (interaction?.webhook) {
    try {
      await interaction.webhook.deleteMessage(messageId);
      return true;
    } catch (err) {
      // fall through
    }
  }

  if (message) {
    try {
      await message.delete();
      return true;
    } catch (err) {
      // expected on user installs
    }
  }

  return false;
}

function generatePassword(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

function textToEmoji(text) {
  return text
    .toLowerCase()
    .split('')
    .map(char => {
      if (char >= 'a' && char <= 'z') return `:regional_indicator_${char}:`;
      if (char >= '0' && char <= '9') return `:${char}:`;
      return char;
    })
    .join(' ');
}

function mockText(text) {
  return text
    .split('')
    .map((char, i) => (i % 2 === 0 ? char.toLowerCase() : char.toUpperCase()))
    .join('');
}

const eightBallResponses = [
  'It is certain.', 'It is decidedly so.', 'Without a doubt.',
  'Yes – definitely.', 'You may rely on it.', 'As I see it, yes.',
  'Most likely.', 'Outlook good.', 'Yes.', 'Signs point to yes.',
  'Reply hazy, try again.', 'Ask again later.', 'Better not tell you now.',
  'Cannot predict now.', 'Concentrate and ask again.', "Don't count on it.",
  'My reply is no.', 'My sources say no.', 'Outlook not so good.',
  'Very doubtful.', 'Possibly, but not guaranteed.', 'The stars say maybe.',
];

const compliments = [
  'You have an amazing sense of humor!',
  'Your kindness is a gift to this world.',
  'You are incredibly smart and creative.',
  'You light up every room you enter.',
  'You have a fantastic smile.',
  'You are a great friend to everyone.',
  'You are so brave and strong.',
  'Your ideas are brilliant.',
  'You have a beautiful heart.',
  'You make the world a better place.',
  'You are absolutely unique and amazing.',
  'Your positivity is contagious.',
  'You are inspiring!',
  'You are a true gem.',
  'You are loved and appreciated.',
];

function flipCoin() {
  return Math.random() < 0.5 ? 'Heads' : 'Tails';
}

async function urbanLookup(term) {
  const url = `https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Urban Dictionary API error');
  const data = await res.json();
  if (!data.list || data.list.length === 0) return null;
  const entry = data.list[0];
  return {
    definition: entry.definition.length > 1000 ? entry.definition.slice(0, 997) + '...' : entry.definition,
    example: entry.example
      ? (entry.example.length > 500 ? entry.example.slice(0, 497) + '...' : entry.example)
      : 'No example provided.',
    author: entry.author,
    permalink: entry.permalink,
  };
}

module.exports = {
  safeEditMessage,
  safeDeleteMessage,
  generatePassword,
  textToEmoji,
  mockText,
  eightBallResponses,
  compliments,
  flipCoin,
  urbanLookup,
};
