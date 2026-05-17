import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { WebSocket } from "ws";

import { createGatewayServer } from "../src/gateway-app.js";
import {
  OpenAiAssistantsStore,
  createAssistantsRuntime,
} from "../src/openai-assistants.js";
import { installRealtimeServer } from "../src/openai-realtime.js";
import {
  normalizeAnthropicRequest,
  buildStructuredPrompt,
  parseStructuredEnvelope,
  runGatewaySession,
} from "../src/session-core.js";
import {
  normalizeServerToolDefinition,
  executeServerToolUse,
} from "../src/server-tools.js";

async function startServer(overrides = {}) {
  const server = createGatewayServer({
    apiKey: "test-key",
    getBridgeHealth: async () => ({ status: "ok", runtimeInitialized: false }),
    getGatewayModelCatalog: async () => [
      {
        id: "tabbit/Claude-Sonnet-4.6",
        displayName: "Claude-Sonnet-4.6",
        tabbit_display_name: "Claude-Sonnet-4.6",
        selectedModel: "Claude-Sonnet-4.6",
        supports_tools: true,
        available_in_tabbit_catalog: true,
      },
      {
        id: "tabbit/priority",
        displayName: "priority",
        tabbit_display_name: "priority",
        selectedModel: null,
        supports_tools: true,
        available_in_tabbit_catalog: true,
      },
    ],
    sendPromptToTabbit: async ({ prompt }) => {
      if (prompt.includes("Repair the following assistant output")) {
        return {
          ok: true,
          text: JSON.stringify({
            stop_reason: "end_turn",
            content: [{ type: "text", text: "repaired" }],
          }),
          gatewayModelId: "tabbit/Claude-Sonnet-4.6",
          attemptedModels: ["tabbit/Claude-Sonnet-4.6"],
          fallbackHappened: false,
        };
      }

      return {
        ok: true,
        text: JSON.stringify({
          stop_reason: "end_turn",
          content: [{ type: "text", text: "hello from tabbit" }],
        }),
        gatewayModelId: "tabbit/Claude-Sonnet-4.6",
        attemptedModels: ["tabbit/Claude-Sonnet-4.6"],
        fallbackHappened: false,
      };
    },
    runGatewaySession: overrides.runGatewaySession,
    assistantsRuntime: overrides.assistantsRuntime,
  });

  if (overrides.realtime) {
    installRealtimeServer(server, {
      apiKey: "test-key",
      runGatewaySession:
        overrides.realtimeRunGatewaySession ||
        overrides.runGatewaySession ||
        (async () => ({
          ok: true,
          contentBlocks: [{ type: "text", text: "hello from tabbit" }],
          stopReason: "end_turn",
          selectedModel: "tabbit/Claude-Sonnet-4.6",
          attemptedModels: ["tabbit/Claude-Sonnet-4.6"],
          fallbackHappened: false,
          usageEstimate: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        })),
    });
  }

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return {
      response,
      body: await response.json(),
    };
  }

  return {
    response,
    body: await response.text(),
  };
}

async function createTempAssistantsRuntime() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tabbit2api-asst-"));
  const statePath = path.join(dir, "state.json");
  return {
    dir,
    statePath,
    runtime: createAssistantsRuntime({
      store: new OpenAiAssistantsStore(statePath),
    }),
  };
}

async function collectRealtimeEvents(baseUrl, actions, headers = {}) {
  const wsUrl = `${baseUrl.replace("http://", "ws://")}/v1/realtime?model=tabbit/priority`;
  const ws = new WebSocket(wsUrl, {
    headers,
  });
  const events = [];
  ws.on("message", (raw) => {
    events.push(JSON.parse(raw.toString("utf8")));
  });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  for (const action of actions) {
    ws.send(JSON.stringify(action));
  }

  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 500);
    ws.on("message", (raw) => {
      const event = JSON.parse(raw.toString("utf8"));
      if (event.type === "response.done" || event.type === "error") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  ws.close();
  return events;
}

test("GET /v1/models returns OpenAI shape by default", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const { response, body } = await requestJson(`${baseUrl}/v1/models`, {
      headers: {
        Authorization: "Bearer test-key",
      },
    });

    assert.equal(response.status, 200);
    assert.equal(body.object, "list");
    assert.equal(Array.isArray(body.data), true);
  } finally {
    await stopServer(server);
  }
});

test("GET /v1/models returns Anthropic shape with anthropic headers", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const { response, body } = await requestJson(`${baseUrl}/v1/models`, {
      headers: {
        "x-api-key": "test-key",
        "anthropic-version": "2023-06-01",
      },
    });

    assert.equal(response.status, 200);
    assert.equal(Array.isArray(body.data), true);
    assert.equal(body.data[0].type, "model");
  } finally {
    await stopServer(server);
  }
});

test("Anthropic routes tolerate a duplicated /v1 prefix", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const { response, body } = await requestJson(`${baseUrl}/v1/v1/models`, {
      headers: {
        "x-api-key": "test-key",
        "anthropic-version": "2023-06-01",
      },
    });

    assert.equal(response.status, 200);
    assert.equal(Array.isArray(body.data), true);
    assert.equal(body.data[0].type, "model");
  } finally {
    await stopServer(server);
  }
});

test("GET /v1/models/{id} returns Anthropic model details", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const { response, body } = await requestJson(
      `${baseUrl}/v1/models/tabbit%2Fpriority`,
      {
        headers: {
          "x-api-key": "test-key",
          "anthropic-version": "2023-06-01",
        },
      },
    );

    assert.equal(response.status, 200);
    assert.equal(body.id, "tabbit/priority");
  } finally {
    await stopServer(server);
  }
});

test("Anthropic routes reject removed Claude-style model aliases", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const { response, body } = await requestJson(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": "test-key",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    assert.equal(response.status, 400);
    assert.equal(body.type, "error");
    assert.equal(body.error.type, "invalid_request_error");

    const tokenCount = await requestJson(`${baseUrl}/v1/messages/count_tokens`, {
      method: "POST",
      headers: {
        "x-api-key": "test-key",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    assert.equal(tokenCount.response.status, 400);
    assert.equal(tokenCount.body.type, "error");
    assert.equal(tokenCount.body.error.type, "invalid_request_error");
  } finally {
    await stopServer(server);
  }
});

test("POST /v1/messages/count_tokens returns a stable estimate", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const { response, body } = await requestJson(
      `${baseUrl}/v1/messages/count_tokens`,
      {
        method: "POST",
        headers: {
          "x-api-key": "test-key",
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "tabbit/priority",
          messages: [{ role: "user", content: "hello" }],
        }),
      },
    );

    assert.equal(response.status, 200);
    assert.equal(typeof body.input_tokens, "number");
    assert.equal(body.input_tokens > 0, true);
  } finally {
    await stopServer(server);
  }
});

test("POST /v1/messages returns Anthropic response body", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const { response, body } = await requestJson(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": "test-key",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "tabbit/priority",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(body.type, "message");
    assert.equal(body.role, "assistant");
    assert.equal(body.content[0].type, "text");
  } finally {
    await stopServer(server);
  }
});

test("POST /v1/messages streams Anthropic SSE events", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": "test-key",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "tabbit/priority",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /event: message_start/);
    assert.match(text, /event: content_block_start/);
    assert.match(text, /event: message_stop/);
  } finally {
    await stopServer(server);
  }
});

test("POST /v1/responses preserves OpenAI wire shape", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const { response, body } = await requestJson(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "tabbit/priority",
        input: "hello",
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(body.object, "response");
    assert.equal(body.output[0].type, "message");
  } finally {
    await stopServer(server);
  }
});

test("POST /v1/chat/completions returns OpenAI chat completion shape", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const { response, body } = await requestJson(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "tabbit/priority",
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "hello" },
        ],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(body.object, "chat.completion");
    assert.equal(body.choices[0].message.role, "assistant");
    assert.equal(body.choices[0].message.content, "hello from tabbit");
  } finally {
    await stopServer(server);
  }
});

test("POST /v1/chat/completions streams chat chunks and DONE", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "tabbit/priority",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /"object":"chat\.completion\.chunk"/);
    assert.match(text, /"role":"assistant"/);
    assert.match(text, /data: \[DONE\]/);
  } finally {
    await stopServer(server);
  }
});

test("POST /v1/chat/completions rejects missing auth and empty messages", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const unauthorized = await requestJson(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "tabbit/priority",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    assert.equal(unauthorized.response.status, 401);
    assert.equal(unauthorized.body.error.type, "authentication_error");

    const empty = await requestJson(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "tabbit/priority",
        messages: [],
      }),
    });
    assert.equal(empty.response.status, 400);
    assert.equal(empty.body.error.type, "invalid_request_error");
  } finally {
    await stopServer(server);
  }
});

test("POST /v1/chat/completions maps client tool calls", async () => {
  const { server, baseUrl } = await startServer({
    runGatewaySession: async () => ({
      ok: true,
      contentBlocks: [
        {
          type: "tool_use",
          id: "call_1",
          name: "lookup",
          input: { query: "tabbit" },
        },
      ],
      stopReason: "tool_use",
      selectedModel: "tabbit/Claude-Sonnet-4.6",
      attemptedModels: ["tabbit/Claude-Sonnet-4.6"],
      fallbackHappened: false,
      usageEstimate: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
      },
    }),
  });
  try {
    const { response, body } = await requestJson(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "tabbit/priority",
        messages: [{ role: "user", content: "hello" }],
        tools: [
          {
            type: "function",
            function: {
              name: "lookup",
              parameters: { type: "object" },
            },
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(body.choices[0].finish_reason, "tool_calls");
    assert.equal(body.choices[0].message.content, null);
    assert.equal(body.choices[0].message.tool_calls[0].function.name, "lookup");
    assert.equal(
      body.choices[0].message.tool_calls[0].function.arguments,
      '{"query":"tabbit"}',
    );
  } finally {
    await stopServer(server);
  }
});

test("Assistants text workflow persists assistant, thread, message, and run state", async () => {
  const { statePath, runtime } = await createTempAssistantsRuntime();
  const { server, baseUrl } = await startServer({ assistantsRuntime: runtime });
  try {
    const assistantResult = await requestJson(`${baseUrl}/v1/assistants`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "tabbit/priority",
        name: "tester",
        instructions: "Answer briefly.",
      }),
    });
    assert.equal(assistantResult.response.status, 200);
    assert.equal(assistantResult.body.object, "assistant");

    const threadResult = await requestJson(`${baseUrl}/v1/threads`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    assert.equal(threadResult.response.status, 200);
    assert.equal(threadResult.body.object, "thread");

    const runResult = await requestJson(
      `${baseUrl}/v1/threads/${threadResult.body.id}/runs`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          assistant_id: assistantResult.body.id,
        }),
      },
    );
    assert.equal(runResult.response.status, 200);
    assert.equal(runResult.body.status, "completed");

    const messages = await requestJson(
      `${baseUrl}/v1/threads/${threadResult.body.id}/messages?order=asc`,
      {
        headers: {
          Authorization: "Bearer test-key",
        },
      },
    );
    assert.equal(messages.response.status, 200);
    assert.equal(messages.body.data.at(-1).role, "assistant");
    assert.equal(messages.body.data.at(-1).content[0].text.value, "hello from tabbit");

    const rawState = JSON.parse(await fs.readFile(statePath, "utf8"));
    assert.equal(Boolean(rawState.assistants[assistantResult.body.id]), true);
    assert.equal(Boolean(rawState.threads[threadResult.body.id]), true);
    assert.equal(Boolean(rawState.runs[runResult.body.id]), true);
  } finally {
    await stopServer(server);
  }
});

test("Assistants runtime reloads persisted state from disk", async () => {
  const { statePath, runtime } = await createTempAssistantsRuntime();
  const assistant = await runtime.createAssistant({
    model: "tabbit/priority",
    name: "persisted",
  });

  const reloaded = createAssistantsRuntime({
    store: new OpenAiAssistantsStore(statePath),
  });
  const listed = await reloaded.listAssistants();
  assert.equal(listed.data[0].id, assistant.id);
  assert.equal(listed.data[0].name, "persisted");
});

test("Assistants run enters requires_action and resumes after tool outputs", async () => {
  let runCalls = 0;
  const { runtime } = await createTempAssistantsRuntime();
  const { server, baseUrl } = await startServer({
    assistantsRuntime: runtime,
    runGatewaySession: async () => {
      runCalls += 1;
      if (runCalls === 1) {
        return {
          ok: true,
          contentBlocks: [
            {
              type: "tool_use",
              id: "call_1",
              name: "lookup",
              input: { query: "tabbit" },
            },
          ],
          stopReason: "tool_use",
          selectedModel: "tabbit/Claude-Sonnet-4.6",
          attemptedModels: ["tabbit/Claude-Sonnet-4.6"],
          fallbackHappened: false,
          usageEstimate: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        };
      }

      return {
        ok: true,
        contentBlocks: [{ type: "text", text: "tool result accepted" }],
        stopReason: "end_turn",
        selectedModel: "tabbit/Claude-Sonnet-4.6",
        attemptedModels: ["tabbit/Claude-Sonnet-4.6"],
        fallbackHappened: false,
        usageEstimate: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      };
    },
  });
  try {
    const assistant = await requestJson(`${baseUrl}/v1/assistants`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "tabbit/priority",
        tools: [{ type: "function", function: { name: "lookup" } }],
      }),
    });
    const thread = await requestJson(`${baseUrl}/v1/threads`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "lookup" }],
      }),
    });
    const run = await requestJson(`${baseUrl}/v1/threads/${thread.body.id}/runs`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        assistant_id: assistant.body.id,
      }),
    });
    assert.equal(run.body.status, "requires_action");
    assert.equal(
      run.body.required_action.submit_tool_outputs.tool_calls[0].function.name,
      "lookup",
    );

    const resumed = await requestJson(
      `${baseUrl}/v1/threads/${thread.body.id}/runs/${run.body.id}/submit_tool_outputs`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          tool_outputs: [{ tool_call_id: "call_1", output: "found" }],
        }),
      },
    );
    assert.equal(resumed.body.status, "completed");
  } finally {
    await stopServer(server);
  }
});

test("Assistants run streaming returns assistant SSE events", async () => {
  const { runtime } = await createTempAssistantsRuntime();
  const { server, baseUrl } = await startServer({ assistantsRuntime: runtime });
  try {
    const assistant = await requestJson(`${baseUrl}/v1/assistants`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "tabbit/priority" }),
    });
    const thread = await requestJson(`${baseUrl}/v1/threads`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    const response = await fetch(`${baseUrl}/v1/threads/${thread.body.id}/runs`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        assistant_id: assistant.body.id,
        stream: true,
      }),
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /event: thread\.run\.created/);
    assert.match(text, /event: thread\.message\.delta/);
    assert.match(text, /data: \[DONE\]/);
  } finally {
    await stopServer(server);
  }
});

test("Realtime WebSocket text session returns response events", async () => {
  const { server, baseUrl } = await startServer({ realtime: true });
  try {
    const events = await collectRealtimeEvents(
      baseUrl,
      [
        {
          type: "session.update",
          session: { instructions: "Be brief." },
        },
        {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "hello" }],
          },
        },
        { type: "response.create" },
      ],
      { Authorization: "Bearer test-key" },
    );

    assert.equal(events[0].type, "session.created");
    assert.equal(events.some((event) => event.type === "session.updated"), true);
    assert.equal(
      events.some((event) => event.type === "conversation.item.created"),
      true,
    );
    assert.equal(events.some((event) => event.type === "response.text.delta"), true);
    assert.equal(events.at(-1).type, "response.done");
  } finally {
    await stopServer(server);
  }
});

test("Realtime WebSocket rejects missing auth", async () => {
  const { server, baseUrl } = await startServer({ realtime: true });
  try {
    const wsUrl = `${baseUrl.replace("http://", "ws://")}/v1/realtime?model=tabbit/priority`;
    await assert.rejects(
      () =>
        new Promise((resolve, reject) => {
          const ws = new WebSocket(wsUrl);
          ws.once("open", () => {
            ws.close();
            resolve();
          });
          ws.once("error", reject);
        }),
      /Unexpected server response: 401/,
    );
  } finally {
    await stopServer(server);
  }
});

test("Realtime WebSocket returns unsupported error for audio events", async () => {
  const { server, baseUrl } = await startServer({ realtime: true });
  try {
    const events = await collectRealtimeEvents(
      baseUrl,
      [{ type: "input_audio_buffer.append", audio: "AAAA" }],
      { Authorization: "Bearer test-key" },
    );
    assert.equal(events.at(-1).type, "error");
    assert.equal(
      events.at(-1).error.code,
      "unsupported_realtime_audio",
    );
  } finally {
    await stopServer(server);
  }
});

test("normalizeAnthropicRequest separates client and server tools", () => {
  const normalized = normalizeAnthropicRequest(
    {
      model: "tabbit/priority",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        { name: "bash", input_schema: { type: "object" } },
        { type: "web_search_20250305", name: "web_search" },
      ],
    },
    {
      normalizeModel: (model) => model,
      normalizeServerTool: normalizeServerToolDefinition,
    },
  );

  assert.equal(normalized.tools.client.length, 1);
  assert.equal(normalized.tools.server.length, 1);
  assert.equal(normalized.tools.server[0].name, "web_search");
});

test("buildStructuredPrompt includes tool contract and conversation", () => {
  const normalized = normalizeAnthropicRequest(
    {
      model: "tabbit/priority",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "bash", input_schema: { type: "object" } }],
    },
    {
      normalizeModel: (model) => model,
      normalizeServerTool: normalizeServerToolDefinition,
    },
  );

  const prompt = buildStructuredPrompt(normalized);
  assert.match(prompt, /Return exactly one JSON object/);
  assert.match(prompt, /Available client tools/);
  assert.match(prompt, /Conversation state/);
});

test("parseStructuredEnvelope accepts fenced JSON", () => {
  const parsed = parseStructuredEnvelope(`
\`\`\`json
{
  "stop_reason": "tool_use",
  "content": [
    {
      "type": "tool_use",
      "id": "toolu_1",
      "name": "bash",
      "input": { "command": "pwd" }
    }
  ]
}
\`\`\`
`);

  assert.equal(parsed.stopReason, "tool_use");
  assert.equal(parsed.contentBlocks[0].type, "tool_use");
});

test("runGatewaySession executes server tool loop and returns final text", async () => {
  let calls = 0;
  const normalized = normalizeAnthropicRequest(
    {
      model: "tabbit/priority",
      messages: [{ role: "user", content: "search now" }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    },
    {
      normalizeModel: (model) => model,
      normalizeServerTool: normalizeServerToolDefinition,
    },
  );

  const result = await runGatewaySession(normalized, {
    sendPromptToTabbit: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: true,
          text: JSON.stringify({
            stop_reason: "tool_use",
            content: [
              {
                type: "server_tool_use",
                id: "srvtoolu_1",
                name: "web_search",
                input: { query: "tabbit2api" },
              },
            ],
          }),
          gatewayModelId: "tabbit/Claude-Sonnet-4.6",
          attemptedModels: ["tabbit/Claude-Sonnet-4.6"],
          fallbackHappened: false,
        };
      }

      return {
        ok: true,
        text: JSON.stringify({
          stop_reason: "end_turn",
          content: [{ type: "text", text: "done" }],
        }),
        gatewayModelId: "tabbit/Claude-Sonnet-4.6",
        attemptedModels: ["tabbit/Claude-Sonnet-4.6"],
        fallbackHappened: false,
      };
    },
    executeServerToolUse: async () => ({
      type: "web_search_tool_result",
      tool_use_id: "srvtoolu_1",
      is_error: false,
      content: [{ type: "web_search_result", title: "A", url: "https://a.test" }],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.contentBlocks.at(-1).type, "text");
  assert.equal(result.usageEstimate.server_tool_use.web_search_requests, 1);
});

test("executeServerToolUse handles unsupported tools explicitly", async () => {
  const result = await executeServerToolUse({
    id: "srvtoolu_1",
    name: "unknown_tool",
    input: {},
  });

  assert.equal(result.is_error, true);
  assert.match(result.content[0].text, /Unsupported server tool/);
});

test("executeServerToolUse can fetch and extract text", async () => {
  const result = await executeServerToolUse(
    {
      id: "srvtoolu_2",
      name: "web_fetch",
      input: {
        url: "https://example.com",
      },
    },
    {
      fetch: async () =>
        new Response("<html><body><h1>Hello</h1><p>World</p></body></html>", {
          status: 200,
          headers: {
            "content-type": "text/html",
          },
        }),
    },
  );

  assert.equal(result.is_error, false);
  assert.equal(result.type, "web_fetch_tool_result");
  assert.match(result.content[0].text, /Hello World/);
});

test("executeServerToolUse can run javascript code", async () => {
  const result = await executeServerToolUse({
    id: "srvtoolu_3",
    name: "code_execution",
    input: {
      language: "javascript",
      code: "console.log(2 + 2)",
    },
  });

  assert.equal(result.is_error, false);
  assert.equal(result.type, "code_execution_tool_result");
  assert.match(result.content[0].text, /4/);
});

test("runGatewaySession repairs malformed structured output once", async () => {
  let calls = 0;
  const normalized = normalizeAnthropicRequest(
    {
      model: "tabbit/priority",
      messages: [{ role: "user", content: "hello" }],
    },
    {
      normalizeModel: (model) => model,
      normalizeServerTool: normalizeServerToolDefinition,
    },
  );

  const result = await runGatewaySession(normalized, {
    sendPromptToTabbit: async ({ prompt }) => {
      calls += 1;
      if (prompt.includes("Repair the following assistant output")) {
        return {
          ok: true,
          text: JSON.stringify({
            stop_reason: "end_turn",
            content: [{ type: "text", text: "repaired response" }],
          }),
          gatewayModelId: "tabbit/Claude-Sonnet-4.6",
          attemptedModels: ["tabbit/Claude-Sonnet-4.6"],
          fallbackHappened: false,
        };
      }

      return {
        ok: true,
        text: "```json\n{ not valid json }\n```",
        gatewayModelId: "tabbit/Claude-Sonnet-4.6",
        attemptedModels: ["tabbit/Claude-Sonnet-4.6"],
        fallbackHappened: false,
      };
    },
    executeServerToolUse: async () => {
      throw new Error("should not execute server tools in this test");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.contentBlocks[0].text, "repaired response");
  assert.equal(calls, 2);
});

test("server tool route returns invalid_request for unknown tool types", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const { response, body } = await requestJson(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": "test-key",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "tabbit/priority",
        messages: [{ role: "user", content: "hello" }],
        tools: [{ type: "future_tool_999", name: "future" }],
      }),
    });

    assert.equal(response.status, 400);
    assert.equal(body.type, "error");
    assert.equal(body.error.type, "invalid_request_error");
  } finally {
    await stopServer(server);
  }
});
