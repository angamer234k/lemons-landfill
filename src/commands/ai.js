const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { OWNER_ID, EMBED_SPLIT_THRESHOLD, botConfig } = require('../config');
const { getUserMemory, updateUserMemory } = require('../memory');
const { safeEditMessage, safeDeleteMessage } = require('../helpers');
const { askAI, buildAIEmbed } = require('../ai');

function formatHistoryDescription(history, opts = {}) {
  const { excludeLastUser = false, aiLine = null, followUpLabel = null } = opts;
  let description = '';
  const end = excludeLastUser ? history.length - 1 : history.length;
  for (let i = 0; i < end; i++) {
    const msg = history[i];
    if (msg.role === 'user') {
      const name = msg.displayName || msg.userId || 'User';
      const label = i === 0 ? `${name}:` : `${name} (follow-up ${Math.ceil(i / 2)}):`;
      description += `**${label}** ${msg.content}\n\n`;
    } else if (msg.role === 'assistant') {
      description += `**AI:** ${msg.content}\n\n`;
    }
  }
  if (followUpLabel) {
    description += followUpLabel;
  }
  if (aiLine !== null) {
    description += `**AI:** ${aiLine}`;
  }
  return description;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ai')
    .setDescription('Chat with AI with memory.')
    .addStringOption(opt =>
      opt.setName('prompt').setDescription('Your message').setRequired(true)
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction, ctx) {
    const prompt = interaction.options.getString('prompt');
    const user = interaction.user;
    await interaction.deferReply();

    const isOwner = user.id === OWNER_ID;
    const priorMemory = getUserMemory(user.id);
    const initialHistory = [
      ...priorMemory,
      { role: 'user', content: prompt, userId: user.id, displayName: user.displayName || user.username },
    ];

    const title = `${user.displayName || user.username} asked: ${prompt.slice(0, 100)}`;
    let baseDesc = '';
    if (priorMemory.length > 0) baseDesc += `*_(memory from previous convos loaded)_*\n\n`;
    baseDesc += `**${user.displayName || user.username}:** ${prompt}\n\n`;

    const placeholderEmbed = buildAIEmbed({
      title,
      description: baseDesc + '**AI:** ⏳ Thinking…',
      embedColor: 0x5865F2,
      model: botConfig.aiModel,
      replies: 0,
      maxReplies: botConfig.maxReplies,
    });

    const sent = await interaction.editReply({ embeds: [placeholderEmbed], components: [], fetchReply: true });

    // Register thread early so tools (e.g. customize_embed) can update title/color mid-response
    const threadState = {
      user,
      prompt,
      replies: 0,
      history: initialHistory,
      embedColor: 0x5865F2,
      title,
      model: botConfig.aiModel,
    };
    ctx.conversationThreads.set(sent.id, threadState);

    let embedColor = threadState.embedColor;
    let usedModel = threadState.model;

    const renderAiLine = async (aiLine, isFinal = false) => {
      // Always read latest title/color from threadState (updated by customize_embed tool)
      const currentTitle = threadState.title || title;
      const currentColor = threadState.embedColor ?? embedColor;
      embedColor = currentColor; // keep local in sync
      let description = baseDesc + `**AI:** ${aiLine}${isFinal ? '' : (aiLine.includes('⏳') || aiLine.includes('🔧') ? '' : ' ▌')}`;
      if (description.length > EMBED_SPLIT_THRESHOLD) {
        description = description.slice(0, EMBED_SPLIT_THRESHOLD - 10) + '…';
      }
      const embed = buildAIEmbed({
        title: currentTitle,
        description,
        embedColor: currentColor,
        model: usedModel,
        replies: 0,
        maxReplies: botConfig.maxReplies,
      });
      try {
        await interaction.editReply({ embeds: [embed] });
      } catch {}
    };

    const statusCallback = async (status) => {
      if (status.type === 'thinking') await renderAiLine('⏳ Thinking…');
      else if (status.type === 'tool') await renderAiLine(`🔧 \`${status.name}\`…`);
      else if (status.type === 'partial') await renderAiLine(status.text || '…');
    };

    const streamCallback = async (partial, isFinal) => {
      let reply = partial;
      const colorMatch = reply.match(/\[C;#[0-9A-Fa-f]{6}\]/);
      if (colorMatch) {
        const hex = colorMatch[0].replace('[C;', '').replace(']', '');
        embedColor = parseInt(hex.replace('#', ''), 16);
        threadState.embedColor = embedColor;
        reply = reply.replace(colorMatch[0], '').trim();
      }
      await renderAiLine(reply, isFinal);
    };

    const result = await askAI(user, initialHistory, {
      streamCallback,
      statusCallback,
      aiMessage: sent,
      isOwner,
      conversationThreads: ctx.conversationThreads,
      client: ctx.client,
      startTime: ctx.startTime,
    });

    if (result.error) {
      await interaction.editReply({ content: `❌ AI error: ${result.error}`, embeds: [], components: [] });
      return;
    }

    let reply = result.reply;
    usedModel = result.model || botConfig.aiModel;
    const colorMatch = reply.match(/\[C;#[0-9A-Fa-f]{6}\]/);
    if (colorMatch) {
      const hex = colorMatch[0].replace('[C;', '').replace(']', '');
      embedColor = parseInt(hex.replace('#', ''), 16);
      threadState.embedColor = embedColor;
      reply = reply.replace(colorMatch[0], '').trim();
    }

    const fullHistory = [...initialHistory, { role: 'assistant', content: reply }];
    updateUserMemory(user.id, [
      { role: 'user', content: prompt, userId: user.id, displayName: user.displayName || user.username },
      { role: 'assistant', content: reply },
    ]);

    // Sync final state
    threadState.history = fullHistory;
    threadState.embedColor = embedColor;
    threadState.model = usedModel;
    const finalTitle = threadState.title || title;

    let description = baseDesc + `**AI:** ${reply}`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ai_reply_${interaction.id}`).setLabel('Reply').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ai_delete').setLabel('Delete').setStyle(ButtonStyle.Secondary)
    );

    if (description.length > EMBED_SPLIT_THRESHOLD) {
      const mainDesc = description.slice(0, EMBED_SPLIT_THRESHOLD - 20) + '\n\n*[continued in reply…]*';
      const restDesc = description.slice(EMBED_SPLIT_THRESHOLD - 20);
      const mainEmbed = buildAIEmbed({
        title: finalTitle, description: mainDesc, embedColor, model: usedModel, replies: 0, maxReplies: botConfig.maxReplies,
      });
      await interaction.editReply({ embeds: [mainEmbed], components: [row] });
      const contEmbed = new EmbedBuilder()
        .setTitle('…continued')
        .setDescription(restDesc.length > 4090 ? restDesc.slice(0, 4087) + '…' : restDesc)
        .setColor(embedColor)
        .setFooter({ text: `Model: ${usedModel}` });
      await interaction.followUp({ embeds: [contEmbed] });
    } else {
      const embed = buildAIEmbed({
        title: finalTitle, description, embedColor, model: usedModel, replies: 0, maxReplies: botConfig.maxReplies,
      });
      await interaction.editReply({ embeds: [embed], components: [row] });
    }

    // threadState already in the map and updated
  },

  async handleButton(interaction, ctx) {
    const customId = interaction.customId;

    if (customId === 'ai_delete') {
      const messageId = interaction.message?.id;
      const thread = messageId ? ctx.conversationThreads.get(messageId) : null;

      if (thread && interaction.user.id !== thread.user.id && interaction.user.id !== OWNER_ID) {
        await interaction.reply({ content: '❌ Only the person who started this conversation can delete it.', ephemeral: true });
        return true;
      }
      await safeDeleteMessage(interaction.message).catch(() => {});
      if (messageId) ctx.conversationThreads.delete(messageId);
      await interaction.deferUpdate().catch(() => {});
      return true;
    }

    if (customId === 'ai_reply_done') {
      await interaction.reply({ content: 'This conversation has ended.', ephemeral: true });
      return true;
    }

    if (customId.startsWith('ai_reply_')) {
      const messageId = interaction.message?.id;
      const thread = messageId ? ctx.conversationThreads.get(messageId) : null;
      if (!thread) {
        await interaction.reply({ content: '❌ This conversation is no longer active.', ephemeral: true });
        return true;
      }

      if (interaction.user.id !== thread.user.id && !botConfig.allowOthersToReply && interaction.user.id !== OWNER_ID) {
        await interaction.reply({ content: '❌ Only the original user can reply (or owner has disabled others).', ephemeral: true });
        return true;
      }
      if (thread.replies >= botConfig.maxReplies) {
        await interaction.reply({ content: `❌ Max replies (${botConfig.maxReplies}) reached.`, ephemeral: true });
        return true;
      }

      const modal = new ModalBuilder()
        .setCustomId(`ai_modal_${messageId}`)
        .setTitle('Continue the conversation');
      const input = new TextInputBuilder()
        .setCustomId('reply_input')
        .setLabel('Your message')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1500);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    return false;
  },

  async handleModal(interaction, ctx) {
    if (!interaction.customId.startsWith('ai_modal_')) return false;
    const messageId = interaction.customId.replace('ai_modal_', '');
    const thread = ctx.conversationThreads.get(messageId);
    if (!thread) {
      await interaction.reply({ content: '❌ This conversation is no longer active.', ephemeral: true });
      return true;
    }

    if (interaction.user.id !== thread.user.id && !botConfig.allowOthersToReply && interaction.user.id !== OWNER_ID) {
      await interaction.reply({ content: '❌ Only the original user can reply.', ephemeral: true });
      return true;
    }
    if (thread.replies >= botConfig.maxReplies) {
      await interaction.reply({ content: `❌ Max replies (${botConfig.maxReplies}) reached.`, ephemeral: true });
      return true;
    }

    const followUp = interaction.fields.getTextInputValue('reply_input');
    const user = interaction.user;
    const isOwner = user.id === OWNER_ID;
    const history = thread.history || [];
    history.push({ role: 'user', content: followUp, userId: user.id, displayName: user.displayName || user.username });

    await interaction.deferUpdate();
    const originalMessage = interaction.message;
    let embedColor = thread.embedColor || 0x5865F2;
    let usedModel = thread.model || botConfig.aiModel;
    const name = user.displayName || user.username;
    const followUpHeader = `**${name} (follow-up ${thread.replies + 1}):** ${followUp}\n\n`;

    const renderAiLine = async (aiLine, isFinal = false) => {
      // Re-read from thread so customize_embed mid-reply sticks
      const currentTitle = thread.title || '💬 Conversation';
      const currentColor = thread.embedColor ?? embedColor;
      embedColor = currentColor;
      let description = formatHistoryDescription(history, {
        excludeLastUser: true,
        followUpLabel: followUpHeader,
        aiLine: aiLine + (isFinal || aiLine.includes('⏳') || aiLine.includes('🔧') ? '' : ' ▌'),
      });
      if (description.length > EMBED_SPLIT_THRESHOLD) {
        description = description.slice(0, EMBED_SPLIT_THRESHOLD - 10) + '…';
      }
      const embed = buildAIEmbed({
        title: currentTitle,
        description,
        embedColor: currentColor,
        model: usedModel,
        replies: thread.replies,
        maxReplies: botConfig.maxReplies,
      });
      try {
        await safeEditMessage(originalMessage, { embeds: [embed] }, interaction);
      } catch {}
    };

    await renderAiLine('⏳ Thinking…');

    const statusCallback = async (status) => {
      if (status.type === 'thinking') await renderAiLine('⏳ Thinking…');
      else if (status.type === 'tool') await renderAiLine(`🔧 \`${status.name}\`…`);
      else if (status.type === 'partial') await renderAiLine(status.text || '…');
    };

    const streamCallback = async (partial, isFinal) => {
      let reply = partial;
      const colorMatch = reply.match(/\[C;#[0-9A-Fa-f]{6}\]/);
      if (colorMatch) {
        const hex = colorMatch[0].replace('[C;', '').replace(']', '');
        embedColor = parseInt(hex.replace('#', ''), 16);
        thread.embedColor = embedColor;
        reply = reply.replace(colorMatch[0], '').trim();
      }
      await renderAiLine(reply, isFinal);
    };

    const result = await askAI(user, history, {
      streamCallback,
      statusCallback,
      aiMessage: interaction.message,
      isOwner,
      conversationThreads: ctx.conversationThreads,
      client: ctx.client,
      startTime: ctx.startTime,
    });

    if (result.error) {
      await interaction.followUp({ content: `❌ AI error: ${result.error}`, ephemeral: true });
      return true;
    }

    let reply = result.reply;
    usedModel = result.model || usedModel;
    const colorMatch = reply.match(/\[C;#[0-9A-Fa-f]{6}\]/);
    if (colorMatch) {
      const hex = colorMatch[0].replace('[C;', '').replace(']', '');
      embedColor = parseInt(hex.replace('#', ''), 16);
      reply = reply.replace(colorMatch[0], '').trim();
    }
    history.push({ role: 'assistant', content: reply });
    thread.history = history;
    thread.replies += 1;
    thread.embedColor = embedColor;
    thread.model = usedModel;

    updateUserMemory(user.id, [
      { role: 'user', content: followUp, userId: user.id, displayName: user.displayName || user.username },
      { role: 'assistant', content: reply },
    ]);

    let description = formatHistoryDescription(history);
    if (description.length > 4000) description = description.slice(0, 3997) + '…';

    const row = new ActionRowBuilder();
    if (thread.replies >= botConfig.maxReplies) {
      row.addComponents(
        new ButtonBuilder().setCustomId('ai_reply_done').setLabel('Conversation Ended').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('ai_delete').setLabel('Delete').setStyle(ButtonStyle.Secondary)
      );
    } else {
      row.addComponents(
        new ButtonBuilder().setCustomId(`ai_reply_${messageId}`).setLabel('Continue').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('ai_delete').setLabel('Delete').setStyle(ButtonStyle.Secondary)
      );
    }

    try {
      if (description.length > EMBED_SPLIT_THRESHOLD) {
        const mainDesc = description.slice(0, EMBED_SPLIT_THRESHOLD - 20) + '\n\n*[continued in reply…]*';
        const restDesc = description.slice(EMBED_SPLIT_THRESHOLD - 20);
        const mainEmbed = buildAIEmbed({
          title: thread.title || '💬 Conversation',
          description: mainDesc,
          embedColor,
          model: usedModel,
          replies: thread.replies,
          maxReplies: botConfig.maxReplies,
        });
        await safeEditMessage(originalMessage, { embeds: [mainEmbed], components: [row] }, interaction);
        const contEmbed = new EmbedBuilder()
          .setTitle('…continued')
          .setDescription(restDesc.length > 4090 ? restDesc.slice(0, 4087) + '…' : restDesc)
          .setColor(embedColor)
          .setFooter({ text: `Model: ${usedModel}` });
        await interaction.followUp({ embeds: [contEmbed] }).catch(() => {});
      } else {
        const embed = buildAIEmbed({
          title: thread.title || '💬 Conversation',
          description,
          embedColor,
          model: usedModel,
          replies: thread.replies,
          maxReplies: botConfig.maxReplies,
        });
        await safeEditMessage(originalMessage, { embeds: [embed], components: [row] }, interaction);
      }
    } catch (e) {
      console.error('Final edit failed:', e);
    }
    return true;
  },
};
