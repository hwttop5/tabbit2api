import crypto from "node:crypto";
import { countTokens } from "@anthropic-ai/tokenizer";
import {
  normalizeAnthropicRequest as normalizeAnthropicRequestCore,
  buildStructuredPrompt,
} from "./session-core.js";

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function chunkString(text, maxLength = 160) {
  return text.match(new RegExp(`[\\s\\S]{1,${maxLength}}`, "g")) ?? [];
}

function blockToAnthropic(block) {
  if (block.type === "text") {
    return {
      type: "text",
      text: block.text,
    };
  }

  if (block.type === "tool_use") {
    return {
      type: "tool_use",
      id: block.id,
      name: block.name,
      input: block.input,
    };
  }

  if (block.type === "server_tool_use") {
    return {
      type: "server_tool_use",
      id: block.id,
      name: block.name,
      input: block.input,
    };
  }

  if (block.type === "server_tool_result") {
    return {
      type: block.result_type,
      tool_use_id: block.tool_use_id,
      is_error: Boolean(block.is_error),
      content: block.content,
      ...block.extra,
    };
  }

  return {
    type: "text",
    text: JSON.stringify(block),
  };
}

function responseUsage(usageEstimate) {
  return {
    input_tokens: usageEstimate.input_tokens,
    output_tokens: usageEstimate.output_tokens,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    server_tool_use: {
      web_search_requests: usageEstimate.server_tool_use.web_search_requests,
      web_fetch_requests: usageEstimate.server_tool_use.web_fetch_requests,
    },
  };
}

export function normalizeAnthropicRequest(body, helpers) {
  return normalizeAnthropicRequestCore(body, helpers);
}

export function countAnthropicTokens(normalizedRequest) {
  return {
    input_tokens: countTokens(buildStructuredPrompt(normalizedRequest)),
  };
}

export function buildAnthropicResponse(normalizedRequest, sessionResult) {
  return {
    id: randomId("msg"),
    type: "message",
    role: "assistant",
    model: normalizedRequest.publicModel || normalizedRequest.requestedModel,
    content: sessionResult.contentBlocks.map(blockToAnthropic),
    stop_reason: sessionResult.stopReason,
    stop_sequence: null,
    usage: responseUsage(sessionResult.usageEstimate),
  };
}

function writeSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function contentBlockStartShape(block) {
  if (block.type === "text") {
    return {
      type: "text",
      text: "",
    };
  }

  if (block.type === "tool_use" || block.type === "server_tool_use") {
    return {
      type: block.type,
      id: block.id,
      name: block.name,
      input: {},
    };
  }

  return block;
}

export function streamAnthropicResponse(res, response) {
  res.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
  });

  writeSseEvent(res, "message_start", {
    type: "message_start",
    message: {
      ...response,
      content: [],
    },
  });

  response.content.forEach((block, index) => {
    writeSseEvent(res, "content_block_start", {
      type: "content_block_start",
      index,
      content_block: contentBlockStartShape(block),
    });

    if (block.type === "text") {
      for (const chunk of chunkString(block.text, 120)) {
        writeSseEvent(res, "content_block_delta", {
          type: "content_block_delta",
          index,
          delta: {
            type: "text_delta",
            text: chunk,
          },
        });
      }
    } else if (block.type === "tool_use" || block.type === "server_tool_use") {
      for (const chunk of chunkString(JSON.stringify(block.input), 120)) {
        writeSseEvent(res, "content_block_delta", {
          type: "content_block_delta",
          index,
          delta: {
            type: "input_json_delta",
            partial_json: chunk,
          },
        });
      }
    }

    writeSseEvent(res, "content_block_stop", {
      type: "content_block_stop",
      index,
    });
  });

  writeSseEvent(res, "message_delta", {
    type: "message_delta",
    delta: {
      stop_reason: response.stop_reason,
      stop_sequence: null,
    },
    usage: response.usage,
  });

  writeSseEvent(res, "message_stop", {
    type: "message_stop",
  });

  res.end();
}

