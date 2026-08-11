const fs = require('fs');
const {
  SYSTEM_PROMPT_FILE,
  MAX_HISTORY_TO_MODEL,
  MAX_TOOL_CALLS,
  STREAM_EDIT_INTERVAL_MS,
  STREAM_MIN_CHARS,
  STREAM_MIN_LENGTH,
  botConfig,
} = require('../config');
const { getProviderConfig } = require('./models');
const { getToolsForUser, executeTool } = require('./tools');

/** Pull <think>...</think> blocks out of model text. Returns { thinks, cleaned }. */
function extractThink(text) {
  if (typeof text !== 'string' || !text) return { thinks: [], cleaned: text || '' };
  const thinks = [];
  let cleaned = text;
  const re = /<think>([\s\S]*?)<\/think>/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const t = (m[1] || '').trim();
    if (t) thinks.push(t);
  }
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Unclosed tag at end (streaming / truncated)
  const open = cleaned.match(/<think>([\s\S]*)$/i);
  if (open) {
    const t = (open[1] || '').trim();
    if (t) thinks.push(t);
    cleaned = cleaned.replace(/<think>[\s\S]*$/i, '').trim();
  }
  return { thinks, cleaned };
}

async function askAI(user, rawHistory = [], options = {}) {
  const {
    streamCallback,
    statusCallback,
    aiMessage,
    isOwner = false,
    conversationThreads,
    client,
    startTime,
  } = options;
  const prov = getProviderConfig();
  if (!prov.apiKey) return { error: `${prov.keyEnv} missing` };
  const url = `${prov.base}/chat/completions`;
  const apiKey = prov.apiKey;

  let systemPromptTemplate = '';
  try {
    systemPromptTemplate = fs.readFileSync(SYSTEM_PROMPT_FILE, 'utf8');
  } catch {
    systemPromptTemplate =
      'You are a helpful assistant. To end your prompt, use [<end_of_llm_response>], EXACTLY like that.';
  }

  let systemPrompt = systemPromptTemplate
    .replace(/\{\{username\}\}/g, user.username)
    .replace(/\{\{displayName\}\}/g, user.displayName || user.globalName || user.username);

  systemPrompt += `\n\nYou have access to tools (bot commands). Use them when helpful — before answering, during reasoning, or after gathering info. Never call a tool named "ai". After using tools, answer the user naturally using the tool results. Max ${MAX_TOOL_CALLS} tool calls.`;

  const trimmedHistory =
    rawHistory.length > MAX_HISTORY_TO_MODEL ? rawHistory.slice(-MAX_HISTORY_TO_MODEL) : rawHistory;

  const formattedMessages = trimmedHistory.map(msg => {
    if (msg.role === 'user') {
      const speakerName = msg.displayName || msg.userId || 'User';
      const content =
        typeof msg.content === 'string' && msg.content.length > 1200
          ? msg.content.slice(0, 1197) + '…'
          : msg.content;
      return { role: 'user', content: `[${speakerName}]: ${content}` };
    }
    if (msg.role === 'tool') {
      return { role: 'tool', tool_call_id: msg.tool_call_id, content: msg.content };
    }
    if (msg.role === 'assistant' && msg.tool_calls) {
      return { role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls };
    }
    const content =
      typeof msg.content === 'string' && msg.content.length > 1200
        ? msg.content.slice(0, 1197) + '…'
        : msg.content;
    return { role: msg.role, content };
  });

  let messages = [{ role: 'system', content: systemPrompt }, ...formattedMessages];
  const tools = getToolsForUser(isOwner);
  const fallbacks =
    botConfig.provider === 'mistral'
      ? ['mistral-small-latest', 'mistral-medium-latest', 'open-mistral-7b']
      : ['gpt-3.5-turbo', 'gpt-4o-mini', 'mistral'];
  const modelsToTry = [botConfig.aiModel, ...fallbacks].filter((v, i, a) => a.indexOf(v) === i);

  let toolCallCount = 0;
  let usedModel = botConfig.aiModel;

  if (typeof statusCallback === 'function') {
    await statusCallback({ type: 'thinking' }).catch(() => {});
  }

  for (let round = 0; round <= MAX_TOOL_CALLS; round++) {
    let data = null;
    let modelUsed = null;

    for (const model of modelsToTry) {
      try {
        const body = { model, messages, stream: false, tools, tool_choice: 'auto' };
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`API (${model}) error ${response.status}:`, errorText);
          continue;
        }
        data = await response.json();
        modelUsed = model;
        break;
      } catch (err) {
        console.error(`Model "${model}" failed:`, err.message);
      }
    }

    if (!data) return { error: 'All AI models failed.' };
    usedModel = modelUsed;

    const choice = data.choices?.[0];
    if (!choice) return { error: 'Empty response from model' };

    const msg = choice.message;
    const toolCalls = msg.tool_calls;

    if (msg.content && toolCalls?.length && typeof statusCallback === 'function') {
      const { thinks, cleaned } = extractThink(msg.content);
      if (thinks.length) {
        await statusCallback({ type: 'think', texts: thinks }).catch(() => {});
      }
      if (cleaned) {
        await statusCallback({ type: 'partial', text: cleaned }).catch(() => {});
      }
    }

    if (!toolCalls || toolCalls.length === 0) {
      let reply = msg.content || '';
      const marker = '[<end_of_llm_response>]';
      const idx = reply.indexOf(marker);
      if (idx !== -1) reply = reply.substring(0, idx).trim();

      // Surface any <think> blocks before streaming/returning the clean reply
      const extracted = extractThink(reply);
      if (extracted.thinks.length && typeof statusCallback === 'function') {
        await statusCallback({ type: 'think', texts: extracted.thinks }).catch(() => {});
      }
      reply = extracted.cleaned;

      if (streamCallback && reply.length > STREAM_MIN_LENGTH) {
        try {
          const streamRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model: usedModel, messages, stream: true }),
          });

          if (streamRes.ok && streamRes.body) {
            let full = '';
            let lastEdit = 0;
            let lastLen = 0;
            const reader = streamRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const payload = line.slice(6).trim();
                if (payload === '[DONE]') continue;
                try {
                  const chunk = JSON.parse(payload);
                  const delta = chunk.choices?.[0]?.delta?.content;
                  if (delta) {
                    full += delta;
                    const now = Date.now();
                    const charsSince = full.length - lastLen;
                    if (
                      (now - lastEdit >= STREAM_EDIT_INTERVAL_MS && charsSince >= STREAM_MIN_CHARS) ||
                      (lastEdit === 0 && full.length >= 15)
                    ) {
                      lastEdit = now;
                      lastLen = full.length;
                      let preview = full;
                      const m = preview.indexOf(marker);
                      if (m !== -1) preview = preview.substring(0, m).trim();
                      const prevExtracted = extractThink(preview);
                      if (prevExtracted.thinks.length && typeof statusCallback === 'function') {
                        await statusCallback({ type: 'think', texts: prevExtracted.thinks }).catch(() => {});
                      }
                      await streamCallback(prevExtracted.cleaned, false);
                    }
                  }
                } catch {}
              }
            }

            const m = full.indexOf(marker);
            if (m !== -1) full = full.substring(0, m).trim();
            const finalExtracted = extractThink(full);
            if (finalExtracted.thinks.length && typeof statusCallback === 'function') {
              await statusCallback({ type: 'think', texts: finalExtracted.thinks }).catch(() => {});
            }
            await streamCallback(finalExtracted.cleaned, true);
            return { success: true, reply: finalExtracted.cleaned, model: usedModel };
          }
        } catch (streamErr) {
          console.error('Streaming failed, falling back:', streamErr.message);
        }
      }

      return { success: true, reply, model: usedModel };
    }

    if (toolCallCount + toolCalls.length > MAX_TOOL_CALLS) {
      toolCalls.splice(MAX_TOOL_CALLS - toolCallCount);
    }
    if (toolCalls.length === 0) {
      const fallback = extractThink(msg.content || '(no response)');
      if (fallback.thinks.length && typeof statusCallback === 'function') {
        await statusCallback({ type: 'think', texts: fallback.thinks }).catch(() => {});
      }
      return { success: true, reply: fallback.cleaned || '(no response)', model: usedModel };
    }

    messages.push({
      role: 'assistant',
      content: msg.content || null,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      if (toolCallCount >= MAX_TOOL_CALLS) break;
      toolCallCount++;

      const fnName = tc.function?.name;
      let fnArgs = {};
      try {
        fnArgs = JSON.parse(tc.function?.arguments || '{}');
      } catch {
        fnArgs = {};
      }

      if (typeof statusCallback === 'function') {
        await statusCallback({ type: 'tool', name: fnName, args: fnArgs }).catch(() => {});
      }

      if (fnName === 'ai' || fnName === 'ask_ai') {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify({ ok: false, error: 'Calling /ai recursively is not allowed.' }),
        });
        continue;
      }

      const result = await executeTool(fnName, fnArgs, {
        user,
        isOwner,
        aiMessage,
        conversationThreads,
        client,
        startTime,
      });
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }

    if (typeof statusCallback === 'function') {
      await statusCallback({ type: 'thinking' }).catch(() => {});
    }
  }

  return { error: 'Max tool call rounds reached.' };
}

module.exports = { askAI };
