import crypto from "node:crypto";

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function textFromContentPart(part) {
  if (typeof part === "string") {
    return part;
  }

  if (Array.isArray(part)) {
    return part.map(textFromContentPart).filter(Boolean).join("\n");
  }

  if (!part || typeof part !== "object") {
    return "";
  }

  if (typeof part.text === "string") {
    return part.text;
  }

  if (typeof part.content === "string") {
    return part.content;
  }

  if (part.type === "input_text" && typeof part.text === "string") {
    return part.text;
  }

  if (part.type === "text" && typeof part.text === "string") {
    return part.text;
  }

  if (Array.isArray(part.content)) {
    return textFromContentPart(part.content);
  }

  return "";
}

function normalizeTextBlocks(content) {
  const text = textFromContentPart(content).trim();
  return text ? [{ type: "text", text }] : [];
}

function normalizeChatTools(tools) {
  return (Array.isArray(tools) ? tools : [])
    .filter((tool) => tool?.type === "function" && tool.function?.name)
    .map((tool) => ({
      kind: "client",
      name: cleanText(tool.function.name),
      description: cleanText(tool.function.description),
      inputSchema:
        tool.function.parameters && typeof tool.function.parameters === "object"
          ? clone(tool.function.parameters)
          : {},
    }))
    .filter((tool) => tool.name);
}

function normalizeToolChoice(toolChoice) {
  if (toolChoice?.type === "function" && toolChoice.function?.name) {
    return {
      type: "tool",
      name: cleanText(toolChoice.function.name),
    };
  }

  return toolChoice ?? "auto";
}

function normalizeAssistantToolCalls(toolCalls) {
  return (Array.isArray(toolCalls) ? toolCalls : [])
    .filter((toolCall) => toolCall?.type === "function" && toolCall.function?.name)
    .map((toolCall) => {
      let input = {};
      if (typeof toolCall.function.arguments === "string") {
        try {
          input = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          input = { arguments: toolCall.function.arguments };
        }
      }

      return {
        type: "tool_use",
        id: cleanText(toolCall.id) || randomId("call"),
        name: cleanText(toolCall.function.name),
        input,
      };
    });
}

function normalizeChatMessages(messages) {
  const system = [];
  const normalizedMessages = [];

  for (const message of Array.isArray(messages) ? messages : []) {
    const role = cleanText(message?.role) || "user";
    const textBlocks = normalizeTextBlocks(message?.content);

    if (role === "system" || role === "developer") {
      system.push(...textBlocks.map((block) => block.text));
      continue;
    }

    if (role === "tool" || role === "function") {
      const toolUseId = cleanText(message?.tool_call_id) || cleanText(message?.name);
      if (textBlocks.length || toolUseId) {
        normalizedMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUseId || randomId("call"),
              is_error: false,
              content: textBlocks.length ? textBlocks : [{ type: "text", text: "" }],
            },
          ],
        });
      }
      continue;
    }

    if (role === "assistant") {
      const content = [
        ...textBlocks,
        ...normalizeAssistantToolCalls(message?.tool_calls),
      ];
      if (content.length) {
        normalizedMessages.push({ role: "assistant", content });
      }
      continue;
    }

    if (textBlocks.length) {
      normalizedMessages.push({
        role,
        content: textBlocks,
      });
    }
  }

  return {
    system,
    messages: normalizedMessages,
  };
}

export function normalizeChatCompletionsRequest(body) {
  const normalized = normalizeChatMessages(body?.messages);
  return {
    protocol: "openai-chat-completions",
    requestedModel:
      typeof body?.model === "string" && body.model.trim()
        ? body.model.trim()
        : "tabbit/priority",
    publicModel: body?.model || "tabbit/priority",
    system: normalized.system,
    messages: normalized.messages,
    tools: {
      client: normalizeChatTools(body?.tools),
      server: [],
    },
    toolChoice: normalizeToolChoice(body?.tool_choice),
    metadata:
      body?.metadata && typeof body.metadata === "object" ? clone(body.metadata) : {},
    stream: Boolean(body?.stream),
    maxOutputTokens:
      Number.isFinite(Number(body?.max_completion_tokens)) &&
      Number(body.max_completion_tokens) > 0
        ? Number(body.max_completion_tokens)
        : Number.isFinite(Number(body?.max_tokens)) && Number(body.max_tokens) > 0
          ? Number(body.max_tokens)
          : null,
    thinking: null,
    rawBody: clone(body),
  };
}

function responseUsage(usageEstimate = {}) {
  const inputTokens = usageEstimate.input_tokens || 1;
  const outputTokens = usageEstimate.output_tokens || 1;
  return {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: usageEstimate.total_tokens || inputTokens + outputTokens,
  };
}

function blockToToolCall(block, index) {
  return {
    id: block.id || randomId("call"),
    type: "function",
    function: {
      name: block.name,
      arguments: JSON.stringify(block.input || {}),
    },
    index,
  };
}

function messageFromBlocks(blocks) {
  const text = blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
  const toolCalls = blocks
    .filter((block) => block.type === "tool_use")
    .map(blockToToolCall);

  const message = {
    role: "assistant",
    content: toolCalls.length ? null : text,
  };

  if (toolCalls.length) {
    message.tool_calls = toolCalls;
  }

  return {
    message,
    finishReason: toolCalls.length ? "tool_calls" : "stop",
  };
}

export function buildChatCompletionResponse(normalizedRequest, sessionResult) {
  const { message, finishReason } = messageFromBlocks(sessionResult.contentBlocks);
  return {
    id: randomId("chatcmpl"),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: sessionResult.selectedModel || normalizedRequest.publicModel,
    choices: [
      {
        index: 0,
        message,
        logprobs: null,
        finish_reason: finishReason,
      },
    ],
    usage: responseUsage(sessionResult.usageEstimate),
    system_fingerprint: null,
  };
}

function writeSseEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function splitTextChunks(text) {
  return text.match(/[\s\S]{1,80}/g) ?? [];
}

export function streamChatCompletionResponse(res, normalizedRequest, sessionResult) {
  const id = randomId("chatcmpl");
  const created = Math.floor(Date.now() / 1000);
  const model = sessionResult.selectedModel || normalizedRequest.publicModel;
  const text = sessionResult.contentBlocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
  const toolCalls = sessionResult.contentBlocks
    .filter((block) => block.type === "tool_use")
    .map(blockToToolCall);

  res.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
  });

  const baseChunk = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    system_fingerprint: null,
  };

  writeSseEvent(res, {
    ...baseChunk,
    choices: [{ index: 0, delta: { role: "assistant" }, logprobs: null, finish_reason: null }],
  });

  if (toolCalls.length) {
    writeSseEvent(res, {
      ...baseChunk,
      choices: [
        {
          index: 0,
          delta: { tool_calls: toolCalls },
          logprobs: null,
          finish_reason: null,
        },
      ],
    });
    writeSseEvent(res, {
      ...baseChunk,
      choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: "tool_calls" }],
    });
  } else {
    for (const chunk of splitTextChunks(text)) {
      writeSseEvent(res, {
        ...baseChunk,
        choices: [
          {
            index: 0,
            delta: { content: chunk },
            logprobs: null,
            finish_reason: null,
          },
        ],
      });
    }
    writeSseEvent(res, {
      ...baseChunk,
      choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: "stop" }],
    });
  }

  res.write("data: [DONE]\n\n");
  res.end();
}
