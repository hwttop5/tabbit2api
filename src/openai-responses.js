import crypto from "node:crypto";

function createTextItem(text, itemId = `msg_${crypto.randomUUID().replaceAll("-", "")}`) {
  return {
    id: itemId,
    type: "message",
    role: "assistant",
    status: "completed",
    content: [
      {
        type: "output_text",
        text,
        annotations: [],
      },
    ],
  };
}

export function extractPrompt(body) {
  function pushTextParts(target, value) {
    if (!value) {
      return;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        target.push(trimmed);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        pushTextParts(target, item);
      }
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    if (typeof value.text === "string") {
      pushTextParts(target, value.text);
    }

    if (typeof value.content === "string") {
      pushTextParts(target, value.content);
    }

    if (Array.isArray(value.content)) {
      pushTextParts(target, value.content);
    }
  }

  const input = body?.input;
  if (typeof input === "string") {
    return input;
  }

  if (Array.isArray(input)) {
    const chunks = [];
    for (const item of input) {
      pushTextParts(chunks, item);
    }
    return chunks.join("\n\n").trim();
  }

  return "";
}

function baseResponse(body, model, output) {
  return {
    id: `resp_${crypto.randomUUID().replaceAll("-", "")}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    error: null,
    incomplete_details: null,
    instructions: body?.instructions ?? null,
    max_output_tokens: body?.max_output_tokens ?? null,
    model,
    output,
    parallel_tool_calls: true,
    previous_response_id: body?.previous_response_id ?? null,
    reasoning: {
      effort: body?.reasoning?.effort ?? null,
      summary: null,
    },
    store: body?.store ?? false,
    temperature: body?.temperature ?? 1,
    text: { format: { type: "text" } },
    tool_choice: body?.tool_choice ?? "auto",
    tools: body?.tools ?? [],
    top_p: body?.top_p ?? 1,
    truncation: body?.truncation ?? "disabled",
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
    },
    user: body?.user ?? null,
    metadata: body?.metadata ?? {},
  };
}

export function buildTextResponse(body, text, model) {
  return baseResponse(body, model, [createTextItem(text)]);
}

function writeSseEvent(res, event, data, sequenceNumber) {
  const payload = {
    type: event,
    sequence_number: sequenceNumber,
    ...data,
  };
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function splitTextChunks(text) {
  return text.match(/[\s\S]{1,80}/g) ?? [];
}

export function createTextResponseStream(res, body, model) {
  const itemId = `msg_${crypto.randomUUID().replaceAll("-", "")}`;
  const response = baseResponse(body, model, []);
  let started = false;
  let emittedText = "";
  let ended = false;
  let sequenceNumber = 0;

  function nextSequenceNumber() {
    sequenceNumber += 1;
    return sequenceNumber;
  }

  function ensureStarted() {
    if (started || ended) {
      return;
    }

    res.writeHead(200, {
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
    });

    const pendingResponse = {
      ...response,
      status: "in_progress",
      output: [],
    };

    writeSseEvent(
      res,
      "response.created",
      { response: pendingResponse },
      nextSequenceNumber(),
    );
    writeSseEvent(
      res,
      "response.in_progress",
      { response: pendingResponse },
      nextSequenceNumber(),
    );
    writeSseEvent(res, "response.output_item.added", {
      response_id: response.id,
      output_index: 0,
      item: {
        id: itemId,
        type: "message",
        role: "assistant",
        status: "in_progress",
        content: [],
      },
    }, nextSequenceNumber());
    writeSseEvent(res, "response.content_part.added", {
      response_id: response.id,
      output_index: 0,
      item_id: itemId,
      content_index: 0,
      part: {
        type: "output_text",
        text: "",
        annotations: [],
      },
    }, nextSequenceNumber());

    started = true;
  }

  function append(delta) {
    if (!delta || ended) {
      return;
    }

    ensureStarted();
    emittedText += delta;
    writeSseEvent(res, "response.output_text.delta", {
      response_id: response.id,
      output_index: 0,
      item_id: itemId,
      content_index: 0,
      delta,
      logprobs: [],
    }, nextSequenceNumber());
  }

  function appendMissingText(finalText) {
    if (
      !finalText ||
      finalText === emittedText ||
      !finalText.startsWith(emittedText)
    ) {
      return;
    }

    for (const chunk of splitTextChunks(finalText.slice(emittedText.length))) {
      append(chunk);
    }
  }

  function complete(finalText = emittedText) {
    if (ended) {
      return;
    }

    ensureStarted();
    appendMissingText(finalText);

    if (!finalText.startsWith(emittedText)) {
      emittedText = finalText;
    }

    const item = createTextItem(emittedText, itemId);
    const completedResponse = {
      ...response,
      output: [item],
    };

    writeSseEvent(res, "response.output_text.done", {
      response_id: response.id,
      output_index: 0,
      item_id: itemId,
      content_index: 0,
      text: emittedText,
      logprobs: [],
    }, nextSequenceNumber());
    writeSseEvent(res, "response.content_part.done", {
      response_id: response.id,
      output_index: 0,
      item_id: itemId,
      content_index: 0,
      part: item.content[0],
    }, nextSequenceNumber());
    writeSseEvent(res, "response.output_item.done", {
      response_id: response.id,
      output_index: 0,
      item,
    }, nextSequenceNumber());
    writeSseEvent(
      res,
      "response.completed",
      { response: completedResponse },
      nextSequenceNumber(),
    );
    ended = true;
    res.end();
  }

  function fail(message) {
    if (ended) {
      return;
    }

    ensureStarted();
    const failedResponse = {
      ...response,
      status: "failed",
      error: {
        message,
        type: "api_error",
      },
    };
    writeSseEvent(
      res,
      "response.failed",
      { response: failedResponse },
      nextSequenceNumber(),
    );
    ended = true;
    res.end();
  }

  return {
    append,
    complete,
    fail,
    hasStarted() {
      return started;
    },
    getEmittedText() {
      return emittedText;
    },
  };
}

export async function streamTextResponse(res, body, text, model) {
  const stream = createTextResponseStream(res, body, model);
  stream.complete(text);
}
