import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import { isAuthorized } from "./http-utils.js";
import { normalizeChatCompletionsRequest } from "./openai-chat.js";

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sendJson(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function textFromContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (
        (part?.type === "input_text" || part?.type === "text") &&
        typeof part.text === "string"
      ) {
        return part.text;
      }

      if (part?.type === "input_audio" || part?.type === "audio") {
        return "[Unsupported audio input]";
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function responseText(sessionResult) {
  return sessionResult.contentBlocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

function splitText(text) {
  return text.match(/[\s\S]{1,80}/g) ?? [];
}

function errorPayload(message, code = "unsupported_event") {
  return {
    type: "error",
    error: {
      type: "invalid_request_error",
      code,
      message,
    },
  };
}

function realtimeSession(model) {
  return {
    id: randomId("sess"),
    object: "realtime.session",
    model,
    modalities: ["text"],
    instructions: "",
    voice: null,
    input_audio_format: null,
    output_audio_format: null,
    input_audio_transcription: null,
    turn_detection: null,
    tools: [],
    tool_choice: "auto",
    temperature: 1,
    max_response_output_tokens: null,
  };
}

export function installRealtimeServer(server, options = {}) {
  const apiKey = options.apiKey || process.env.TABBIT_API_KEY || "sk-tabbit-local";
  const runGatewaySession = options.runGatewaySession;
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname !== "/v1/realtime") {
      return;
    }

    if (!isAuthorized(req, apiKey)) {
      socket.write(
        "HTTP/1.1 401 Unauthorized\r\n" +
          'WWW-Authenticate: Bearer realm="tabbit-local-gateway"\r\n' +
          "Connection: close\r\n\r\n",
      );
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const session = realtimeSession(url.searchParams.get("model") || "tabbit/priority");
    const conversation = [];

    sendJson(ws, {
      type: "session.created",
      event_id: randomId("event"),
      session,
    });

    ws.on("message", async (raw) => {
      let event;
      try {
        event = JSON.parse(raw.toString("utf8"));
      } catch {
        sendJson(ws, errorPayload("Realtime events must be valid JSON.", "invalid_json"));
        return;
      }

      if (event.type === "session.update") {
        Object.assign(session, event.session || {});
        session.modalities = ["text"];
        session.model = cleanText(session.model) || url.searchParams.get("model") || "tabbit/priority";
        sendJson(ws, {
          type: "session.updated",
          event_id: randomId("event"),
          session,
        });
        return;
      }

      if (event.type === "conversation.item.create") {
        const item = {
          id: event.item?.id || randomId("item"),
          object: "realtime.item",
          type: event.item?.type || "message",
          status: "completed",
          role: event.item?.role || "user",
          content: event.item?.content || [],
        };
        conversation.push(item);
        sendJson(ws, {
          type: "conversation.item.created",
          event_id: randomId("event"),
          previous_item_id: event.previous_item_id || null,
          item,
        });
        return;
      }

      if (
        event.type?.includes("audio") ||
        event.type === "input_audio_buffer.append" ||
        event.type === "input_audio_buffer.commit" ||
        event.type === "input_audio_buffer.clear"
      ) {
        sendJson(
          ws,
          errorPayload(
            "This local gateway supports Realtime text events only; audio, WebRTC SDP, and SIP are not supported.",
            "unsupported_realtime_audio",
          ),
        );
        return;
      }

      if (event.type !== "response.create") {
        sendJson(ws, errorPayload(`Unsupported realtime event '${event.type}'.`));
        return;
      }

      const responseId = randomId("resp");
      const outputItemId = randomId("item");
      sendJson(ws, {
        type: "response.created",
        event_id: randomId("event"),
        response: {
          id: responseId,
          object: "realtime.response",
          status: "in_progress",
          status_details: null,
          output: [],
          created_at: now(),
        },
      });

      const messages = conversation
        .filter((item) => item.type === "message")
        .map((item) => ({
          role: item.role === "assistant" ? "assistant" : "user",
          content: textFromContent(item.content),
        }))
        .filter((message) => cleanText(message.content));

      const normalized = normalizeChatCompletionsRequest({
        model: session.model,
        messages: [
          ...(session.instructions
            ? [{ role: "system", content: session.instructions }]
            : []),
          ...messages,
        ],
        tools: session.tools,
        tool_choice: session.tool_choice,
        temperature: session.temperature,
        max_completion_tokens: session.max_response_output_tokens,
      });

      const sessionResult = await runGatewaySession(normalized);
      if (!sessionResult.ok) {
        sendJson(
          ws,
          errorPayload(
            sessionResult.detail || "Tabbit bridge request failed.",
            sessionResult.error || "api_error",
          ),
        );
        return;
      }

      const text = responseText(sessionResult);
      sendJson(ws, {
        type: "response.output_item.added",
        event_id: randomId("event"),
        response_id: responseId,
        output_index: 0,
        item: {
          id: outputItemId,
          object: "realtime.item",
          type: "message",
          status: "in_progress",
          role: "assistant",
          content: [],
        },
      });

      for (const delta of splitText(text)) {
        sendJson(ws, {
          type: "response.text.delta",
          event_id: randomId("event"),
          response_id: responseId,
          item_id: outputItemId,
          output_index: 0,
          content_index: 0,
          delta,
        });
      }

      sendJson(ws, {
        type: "response.text.done",
        event_id: randomId("event"),
        response_id: responseId,
        item_id: outputItemId,
        output_index: 0,
        content_index: 0,
        text,
      });

      const responseItem = {
        id: outputItemId,
        object: "realtime.item",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "text", text }],
      };
      conversation.push(responseItem);
      sendJson(ws, {
        type: "response.output_item.done",
        event_id: randomId("event"),
        response_id: responseId,
        output_index: 0,
        item: responseItem,
      });
      sendJson(ws, {
        type: "response.done",
        event_id: randomId("event"),
        response: {
          id: responseId,
          object: "realtime.response",
          status: "completed",
          status_details: null,
          output: [responseItem],
          usage: {
            input_tokens: sessionResult.usageEstimate?.input_tokens || 0,
            output_tokens: sessionResult.usageEstimate?.output_tokens || 0,
            total_tokens: sessionResult.usageEstimate?.total_tokens || 0,
          },
        },
      });
    });
  });

  return wss;
}
