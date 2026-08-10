const { SlashCommandBuilder } = require('discord.js');
const { OWNER_ID } = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Manage лемон.space invites (Owner only).')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2])
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create a new invite link.')
        .addIntegerOption(opt =>
          opt
            .setName('expires_in')
            .setDescription('Expiration in seconds (e.g. 3600, 86400). Leave empty for permanent.')
        )
    )
    .addSubcommand(sub => sub.setName('list').setDescription('List active invites.'))
    .addSubcommand(sub =>
      sub
        .setName('revoke')
        .setDescription('Revoke an active invite.')
        .addStringOption(opt =>
          opt.setName('token').setDescription('The UUID token to revoke.').setRequired(true)
        )
    ),

  async execute(interaction) {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({
        content: '❌ Only the bot owner can use this command.',
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();
    const onlineSecret = process.env.ONLINE_SECRET;

    if (!onlineSecret) {
      return interaction.reply({
        content: '❌ `ONLINE_SECRET` is not set in the .env file.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    if (sub === 'create') {
      const expiresIn = interaction.options.getInteger('expires_in');
      const body = { password: onlineSecret };
      if (expiresIn) body.expiresIn = expiresIn;

      try {
        const res = await fetch('https://лемон.space/api/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();

        if (data.ok) {
          await interaction.editReply(
            `✅ **Invite Created!**\n**Link:** \`${data.link}\`\n**Token:** \`${data.token}\`\n**Expires in:** ${data.expiresIn ? `${data.expiresIn}s` : 'Permanent'}`
          );
        } else {
          await interaction.editReply('❌ Failed to create invite.');
        }
      } catch (err) {
        await interaction.editReply(`❌ Error: ${err.message}`);
      }
      return;
    }

    if (sub === 'list') {
      try {
        const res = await fetch(
          `https://лемон.space/api/invite?password=${encodeURIComponent(onlineSecret)}`
        );
        const data = await res.json();

        if (data.tokens && data.tokens.length > 0) {
          const list = data.tokens
            .map(t => `- \`${t.token}\` (TTL: ${t.ttl === -1 ? 'Permanent' : t.ttl + 's'})\n  <${t.link}>`)
            .join('\n');
          await interaction.editReply(`📋 **Active Invites:**\n${list}`);
        } else {
          await interaction.editReply('📋 No active invites found.');
        }
      } catch (err) {
        await interaction.editReply(`❌ Error: ${err.message}`);
      }
      return;
    }

    if (sub === 'revoke') {
      const token = interaction.options.getString('token');
      try {
        const res = await fetch('https://лемон.space/api/invite', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: onlineSecret, token }),
        });

        if (res.ok) {
          await interaction.editReply(`✅ Invite \`${token}\` revoked successfully.`);
        } else {
          await interaction.editReply('❌ Failed to revoke invite. Make sure the token is correct.');
        }
      } catch (err) {
        await interaction.editReply(`❌ Error: ${err.message}`);
      }
    }
  },
};
