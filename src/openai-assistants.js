import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { OPENAI_ASSISTANTS_STATE_PATH } from "./config.js";
import { normalizeChatCompletionsRequest } from "./openai-chat.js";

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function defaultState() {
  return {
    assistants: {},
    threads: {},
    messages: {},
    runs: {},
  };
}

function listObject(data, after = null, limit = 20, order = "desc") {
  const items = [...data].sort((a, b) =>
    order === "asc" ? a.created_at - b.created_at : b.created_at - a.created_at,
  );
  const startIndex = after ? items.findIndex((item) => item.id === after) + 1 : 0;
  const page = items.slice(Math.max(startIndex, 0), Math.max(startIndex, 0) + limit);
  return {
    object: "list",
    data: page,
    first_id: page[0]?.id || null,
    last_id: page.at(-1)?.id || null,
    has_more: Math.max(startIndex, 0) + limit < items.length,
  };
}

function textFromContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part?.type === "text" && typeof part.text === "string") {
          return part.text;
        }

        if (part?.type === "text" && typeof part.text?.value === "string") {
          return part.text.value;
        }

        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function messageContentFromText(text) {
  return [
    {
      type: "text",
      text: {
        value: text,
        annotations: [],
      },
    },
  ];
}

function contentBlocksToText(blocks) {
  return blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

function contentBlocksToRequiredAction(runId, blocks) {
  const toolCalls = blocks.filter((block) => block.type === "tool_use");
  if (!toolCalls.length) {
    return null;
  }

  return {
    type: "submit_tool_outputs",
    submit_tool_outputs: {
      tool_calls: toolCalls.map((block) => ({
        id: block.id || randomId("call"),
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {}),
        },
      })),
    },
  };
}

function assistantMessageForRun(threadId, runId, text, metadata = {}) {
  const timestamp = now();
  return {
    id: randomId("msg"),
    object: "thread.message",
    created_at: timestamp,
    thread_id: threadId,
    run_id: runId,
    assistant_id: metadata.assistant_id || null,
    role: "assistant",
    content: messageContentFromText(text),
    attachments: [],
    metadata,
  };
}

function userMessageToChat(message) {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.metadata?.tool_call_id || null,
      content: textFromContent(message.content),
    };
  }

  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: textFromContent(message.content),
  };
}

export class OpenAiAssistantsStore {
  constructor(filePath = OPENAI_ASSISTANTS_STATE_PATH) {
    this.filePath = filePath;
    this.state = null;
    this.loaded = false;
  }

  async load() {
    if (this.loaded) {
      return this.state;
    }

    try {
      const text = await fs.readFile(this.filePath, "utf8");
      this.state = { ...defaultState(), ...JSON.parse(text) };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      this.state = defaultState();
    }

    this.loaded = true;
    return this.state;
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  async reset() {
    this.state = defaultState();
    this.loaded = true;
    await this.save();
  }
}

export function createAssistantsRuntime(options = {}) {
  const store =
    options.store instanceof OpenAiAssistantsStore
      ? options.store
      : new OpenAiAssistantsStore(options.statePath);

  async function state() {
    return store.load();
  }

  async function createAssistant(body = {}) {
    const data = await state();
    const timestamp = now();
    const assistant = {
      id: randomId("asst"),
      object: "assistant",
      created_at: timestamp,
      name: body.name ?? null,
      description: body.description ?? null,
      model: cleanText(body.model) || "tabbit/priority",
      instructions: body.instructions ?? null,
      tools: Array.isArray(body.tools) ? clone(body.tools) : [],
      tool_resources: body.tool_resources ?? {},
      metadata: body.metadata && typeof body.metadata === "object" ? clone(body.metadata) : {},
      temperature: body.temperature ?? 1,
      top_p: body.top_p ?? 1,
      response_format: body.response_format ?? "auto",
    };
    data.assistants[assistant.id] = assistant;
    await store.save();
    return assistant;
  }

  async function listAssistants(query = {}) {
    const data = await state();
    return listObject(
      Object.values(data.assistants),
      query.after,
      Number(query.limit) > 0 ? Number(query.limit) : 20,
      query.order === "asc" ? "asc" : "desc",
    );
  }

  async function getAssistant(id) {
    const data = await state();
    return data.assistants[id] || null;
  }

  async function updateAssistant(id, body = {}) {
    const assistant = await getAssistant(id);
    if (!assistant) {
      return null;
    }

    for (const key of [
      "name",
      "description",
      "model",
      "instructions",
      "tools",
      "tool_resources",
      "metadata",
      "temperature",
      "top_p",
      "response_format",
    ]) {
      if (Object.hasOwn(body, key)) {
        assistant[key] = clone(body[key]);
      }
    }

    await store.save();
    return assistant;
  }

  async function deleteAssistant(id) {
    const data = await state();
    const existed = Boolean(data.assistants[id]);
    delete data.assistants[id];
    await store.save();
    return {
      id,
      object: "assistant.deleted",
      deleted: existed,
    };
  }

  async function createThread(body = {}) {
    const data = await state();
    const timestamp = now();
    const thread = {
      id: randomId("thread"),
      object: "thread",
      created_at: timestamp,
      tool_resources: body.tool_resources ?? {},
      metadata: body.metadata && typeof body.metadata === "object" ? clone(body.metadata) : {},
    };
    data.threads[thread.id] = thread;

    for (const message of Array.isArray(body.messages) ? body.messages : []) {
      const created = createMessageShape(thread.id, message);
      data.messages[created.id] = created;
    }

    await store.save();
    return thread;
  }

  async function getThread(id) {
    const data = await state();
    return data.threads[id] || null;
  }

  async function updateThread(id, body = {}) {
    const thread = await getThread(id);
    if (!thread) {
      return null;
    }

    if (Object.hasOwn(body, "metadata")) {
      thread.metadata = clone(body.metadata || {});
    }
    if (Object.hasOwn(body, "tool_resources")) {
      thread.tool_resources = clone(body.tool_resources || {});
    }
    await store.save();
    return thread;
  }

  async function deleteThread(id) {
    const data = await state();
    const existed = Boolean(data.threads[id]);
    delete data.threads[id];
    for (const messageId of Object.keys(data.messages)) {
      if (data.messages[messageId].thread_id === id) {
        delete data.messages[messageId];
      }
    }
    for (const runId of Object.keys(data.runs)) {
      if (data.runs[runId].thread_id === id) {
        delete data.runs[runId];
      }
    }
    await store.save();
    return {
      id,
      object: "thread.deleted",
      deleted: existed,
    };
  }

  function createMessageShape(threadId, body = {}) {
    const timestamp = now();
    return {
      id: randomId("msg"),
      object: "thread.message",
      created_at: timestamp,
      thread_id: threadId,
      run_id: null,
      assistant_id: null,
      role: body.role || "user",
      content:
        typeof body.content === "string"
          ? messageContentFromText(body.content)
          : clone(body.content || []),
      attachments: Array.isArray(body.attachments) ? clone(body.attachments) : [],
      metadata: body.metadata && typeof body.metadata === "object" ? clone(body.metadata) : {},
    };
  }

  async function createMessage(threadId, body = {}) {
    const data = await state();
    if (!data.threads[threadId]) {
      return null;
    }

    const message = createMessageShape(threadId, body);
    data.messages[message.id] = message;
    await store.save();
    return message;
  }

  async function listMessages(threadId, query = {}) {
    const data = await state();
    if (!data.threads[threadId]) {
      return null;
    }

    const messages = Object.values(data.messages).filter(
      (message) => message.thread_id === threadId,
    );
    return listObject(
      messages,
      query.after,
      Number(query.limit) > 0 ? Number(query.limit) : 20,
      query.order === "asc" ? "asc" : "desc",
    );
  }

  async function getMessage(threadId, messageId) {
    const data = await state();
    const message = data.messages[messageId];
    return message?.thread_id === threadId ? message : null;
  }

  async function buildRunInput(run, assistant) {
    const data = await state();
    const messages = Object.values(data.messages)
      .filter((message) => message.thread_id === run.thread_id)
      .sort((a, b) => a.created_at - b.created_at)
      .map(userMessageToChat)
      .filter((message) => cleanText(message.content));

    return normalizeChatCompletionsRequest({
      model: run.model || assistant?.model || "tabbit/priority",
      messages: [
        ...(assistant?.instructions
          ? [{ role: "system", content: assistant.instructions }]
          : []),
        ...(run.instructions ? [{ role: "developer", content: run.instructions }] : []),
        ...messages,
      ],
      tools: run.tools || assistant?.tools || [],
      tool_choice: run.tool_choice ?? "auto",
      metadata: run.metadata,
      temperature: run.temperature ?? assistant?.temperature,
      top_p: run.top_p ?? assistant?.top_p,
      max_completion_tokens: run.max_completion_tokens || run.max_prompt_tokens,
    });
  }

  async function executeRun(run, runGatewaySession) {
    const data = await state();
    const assistant = data.assistants[run.assistant_id];
    if (!assistant) {
      run.status = "failed";
      run.failed_at = now();
      run.last_error = {
        code: "invalid_request_error",
        message: `Assistant '${run.assistant_id}' was not found.`,
      };
      await store.save();
      return run;
    }

    run.status = "in_progress";
    run.started_at = now();
    await store.save();

    const normalized = await buildRunInput(run, assistant);
    const sessionResult = await runGatewaySession(normalized);
    if (!sessionResult.ok) {
      run.status = "failed";
      run.failed_at = now();
      run.last_error = {
        code: sessionResult.error || "api_error",
        message: sessionResult.detail || "Tabbit bridge request failed.",
      };
      await store.save();
      return run;
    }

    const requiredAction = contentBlocksToRequiredAction(run.id, sessionResult.contentBlocks);
    if (requiredAction) {
      run.status = "requires_action";
      run.required_action = requiredAction;
      run.expires_at = now() + 600;
      await store.save();
      return run;
    }

    const text = contentBlocksToText(sessionResult.contentBlocks);
    const message = assistantMessageForRun(run.thread_id, run.id, text, {
      assistant_id: run.assistant_id,
      requested_model_alias: run.model || assistant.model,
      attempted_models: sessionResult.attemptedModels || [],
      fallback_happened: Boolean(sessionResult.fallbackHappened),
    });
    data.messages[message.id] = message;
    run.status = "completed";
    run.completed_at = now();
    run.required_action = null;
    run.usage = {
      prompt_tokens: sessionResult.usageEstimate?.input_tokens || 0,
      completion_tokens: sessionResult.usageEstimate?.output_tokens || 0,
      total_tokens: sessionResult.usageEstimate?.total_tokens || 0,
    };
    await store.save();
    return run;
  }

  async function createRun(threadId, body = {}, runGatewaySession) {
    const data = await state();
    if (!data.threads[threadId]) {
      return null;
    }

    const timestamp = now();
    const run = {
      id: randomId("run"),
      object: "thread.run",
      created_at: timestamp,
      thread_id: threadId,
      assistant_id: body.assistant_id || null,
      status: "queued",
      started_at: null,
      expires_at: null,
      cancelled_at: null,
      failed_at: null,
      completed_at: null,
      required_action: null,
      last_error: null,
      model: body.model || null,
      instructions: body.instructions || null,
      tools: Array.isArray(body.tools) ? clone(body.tools) : null,
      metadata: body.metadata && typeof body.metadata === "object" ? clone(body.metadata) : {},
      temperature: body.temperature ?? null,
      top_p: body.top_p ?? null,
      max_prompt_tokens: body.max_prompt_tokens ?? null,
      max_completion_tokens: body.max_completion_tokens ?? null,
      tool_choice: body.tool_choice ?? "auto",
      parallel_tool_calls: body.parallel_tool_calls ?? true,
      response_format: body.response_format ?? "auto",
      incomplete_details: null,
      usage: null,
    };
    data.runs[run.id] = run;
    await store.save();
    return executeRun(run, runGatewaySession);
  }

  async function listRuns(threadId, query = {}) {
    const data = await state();
    if (!data.threads[threadId]) {
      return null;
    }

    const runs = Object.values(data.runs).filter((run) => run.thread_id === threadId);
    return listObject(
      runs,
      query.after,
      Number(query.limit) > 0 ? Number(query.limit) : 20,
      query.order === "asc" ? "asc" : "desc",
    );
  }

  async function getRun(threadId, runId) {
    const data = await state();
    const run = data.runs[runId];
    return run?.thread_id === threadId ? run : null;
  }

  async function submitToolOutputs(threadId, runId, body = {}, runGatewaySession) {
    const data = await state();
    const run = data.runs[runId];
    if (!run || run.thread_id !== threadId) {
      return null;
    }

    const outputs = Array.isArray(body.tool_outputs) ? body.tool_outputs : [];
    for (const output of outputs) {
      const message = createMessageShape(threadId, {
        role: "tool",
        content: output.output || "",
        metadata: {
          tool_call_id: output.tool_call_id || null,
        },
      });
      data.messages[message.id] = message;
    }

    run.required_action = null;
    run.status = "queued";
    await store.save();
    return executeRun(run, runGatewaySession);
  }

  async function createThreadAndRun(body = {}, runGatewaySession) {
    const thread = await createThread(body.thread || {});
    const run = await createRun(
      thread.id,
      {
        ...body,
        assistant_id: body.assistant_id,
      },
      runGatewaySession,
    );
    return run;
  }

  return {
    store,
    createAssistant,
    listAssistants,
    getAssistant,
    updateAssistant,
    deleteAssistant,
    createThread,
    getThread,
    updateThread,
    deleteThread,
    createMessage,
    listMessages,
    getMessage,
    createRun,
    listRuns,
    getRun,
    submitToolOutputs,
    createThreadAndRun,
  };
}

export function writeAssistantSse(res, run, messages = []) {
  res.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
  });

  function event(name, data) {
    res.write(`event: ${name}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  event("thread.run.created", run);
  event(`thread.run.${run.status}`, run);
  for (const message of messages) {
    event("thread.message.created", message);
    const text = textFromContent(message.content);
    if (text) {
      event("thread.message.delta", {
        id: message.id,
        object: "thread.message.delta",
        delta: {
          content: [
            {
              index: 0,
              type: "text",
              text: { value: text, annotations: [] },
            },
          ],
        },
      });
    }
    event("thread.message.completed", message);
  }
  res.write("data: [DONE]\n\n");
  res.end();
}
