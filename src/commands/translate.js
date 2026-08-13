const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const LANGS = [
  { name: 'English', value: 'en' },
  { name: 'Russian', value: 'ru' },
  { name: 'Spanish', value: 'es' },
  { name: 'French', value: 'fr' },
  { name: 'German', value: 'de' },
  { name: 'Italian', value: 'it' },
  { name: 'Portuguese', value: 'pt' },
  { name: 'Polish', value: 'pl' },
  { name: 'Ukrainian', value: 'uk' },
  { name: 'Turkish', value: 'tr' },
  { name: 'Japanese', value: 'ja' },
  { name: 'Chinese (Simplified)', value: 'zh-CN' },
  { name: 'Korean', value: 'ko' },
  { name: 'Arabic', value: 'ar' },
  { name: 'Hindi', value: 'hi' },
  { name: 'Dutch', value: 'nl' },
  { name: 'Swedish', value: 'sv' },
  { name: 'Czech', value: 'cs' },
  { name: 'Romanian', value: 'ro' },
  { name: 'Greek', value: 'el' },
];

async function translateText(text, from, to) {
  const pair = `${from}|${to}`;
  const url =
    'https://api.mymemory.translated.net/get?q=' +
    encodeURIComponent(text) +
    '&langpair=' +
    encodeURIComponent(pair);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Translate API HTTP ${res.status}`);
  const data = await res.json();

  const translated = data?.responseData?.translatedText;
  if (!translated) throw new Error('No translation returned');

  // MyMemory returns MATCH warning strings sometimes
  if (/INVALID SOURCE LANGUAGE|PLEASE SELECT/i.test(translated)) {
    throw new Error('Invalid language pair');
  }

  return {
    translated,
    detected: data?.responseData?.detectedLanguage || null,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('translate')
    .setDescription('Translate text into another language.')
    .addStringOption(opt =>
      opt.setName('text').setDescription('Text to translate').setRequired(true).setMaxLength(1000)
    )
    .addStringOption(opt =>
      opt
        .setName('to')
        .setDescription('Target language')
        .setRequired(true)
        .addChoices(...LANGS)
    )
    .addStringOption(opt =>
      opt
        .setName('from')
        .setDescription('Source language (default: auto)')
        .setRequired(false)
        .addChoices({ name: 'Auto-detect', value: 'autodetect' }, ...LANGS)
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    await interaction.deferReply();

    const text = interaction.options.getString('text', true);
    const to = interaction.options.getString('to', true);
    let from = interaction.options.getString('from') || 'autodetect';

    // MyMemory uses "autodetect" as source
    if (from === 'auto') from = 'autodetect';

    try {
      const { translated } = await translateText(text, from, to);
      const toName = LANGS.find(l => l.value === to)?.name || to;
      const fromLabel = from === 'autodetect' ? 'auto' : LANGS.find(l => l.value === from)?.name || from;

      const embed = new EmbedBuilder()
        .setTitle(`🌐 ${fromLabel} → ${toName}`)
        .setColor(0x5865f2)
        .addFields(
          { name: 'Original', value: text.slice(0, 1020) },
          { name: 'Translation', value: translated.slice(0, 1020) }
        )
        .setFooter({ text: 'via MyMemory' });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Translate error:', err.message);
      await interaction.editReply(`❌ Translation failed: ${err.message}`);
    }
  },
};
