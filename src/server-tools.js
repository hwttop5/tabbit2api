import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const execFile = promisify(execFileCallback);

const SUPPORTED_SERVER_TOOL_TYPES = [
  ["web_search", /^web_search(?:_\d+)?$/],
  ["web_fetch", /^web_fetch(?:_\d+)?$/],
  ["code_execution", /^code_execution(?:_\d+)?$/],
];

const DEFAULT_SEARCH_RESULT_LIMIT = 5;
const MAX_FETCH_CHARS = 24_000;
const MAX_TOOL_OUTPUT_CHARS = 16_000;
const CODE_EXECUTION_TIMEOUT_MS = 20_000;
const CODE_EXECUTION_MAX_BUFFER = 512 * 1024;

export function canonicalizeServerToolType(type) {
  if (typeof type !== "string") {
    return null;
  }

  const trimmed = type.trim();
  for (const [canonical, pattern] of SUPPORTED_SERVER_TOOL_TYPES) {
    if (pattern.test(trimmed)) {
      return canonical;
    }
  }

  return null;
}

export function isRecognizedServerToolType(type) {
  return canonicalizeServerToolType(type) !== null;
}

export function normalizeServerToolDefinition(tool) {
  const canonicalType = canonicalizeServerToolType(tool?.type);
  if (!canonicalType) {
    return null;
  }

  return {
    kind: "server",
    canonicalType,
    type: tool.type,
    name:
      typeof tool.name === "string" && tool.name.trim()
        ? tool.name.trim()
        : canonicalType,
    description:
      typeof tool.description === "string" ? tool.description.trim() : "",
  };
}

function truncate(value, limit = MAX_TOOL_OUTPUT_CHARS) {
  if (typeof value !== "string") {
    return "";
  }

  return value.length > limit ? `${value.slice(0, limit)}\n...[truncated]` : value;
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return normalizeWhitespace(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/(p|div|section|article|li|h[1-6]|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">"),
  );
}

function buildErrorResult(block, type, message) {
  return {
    type,
    tool_use_id: block.id,
    is_error: true,
    content: [
      {
        type: "text",
        text: message,
      },
    ],
  };
}

function buildTextResultBlock(type, toolUseId, text, extra = {}) {
  return {
    type,
    tool_use_id: toolUseId,
    is_error: false,
    content: [
      {
        type: "text",
        text: truncate(text),
      },
    ],
    ...extra,
  };
}

function buildJsonResultBlock(type, toolUseId, payload, extra = {}) {
  return {
    type,
    tool_use_id: toolUseId,
    is_error: false,
    content: payload,
    ...extra,
  };
}

async function runWebSearch(input, deps) {
  const query =
    typeof input?.query === "string"
      ? input.query.trim()
      : typeof input?.search_query === "string"
        ? input.search_query.trim()
        : "";

  if (!query) {
    throw new Error("web_search requires a non-empty query.");
  }

  const maxResults =
    Number.isFinite(Number(input?.max_results)) && Number(input.max_results) > 0
      ? Math.min(Number(input.max_results), 10)
      : DEFAULT_SEARCH_RESULT_LIMIT;

  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const response = await fetchImpl(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: {
        "user-agent": "tabbit2api/0.1 (+https://localhost)",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`web_search upstream request failed with ${response.status}.`);
  }

  const html = await response.text();
  const matches = Array.from(
    html.matchAll(
      /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    ),
  )
    .slice(0, maxResults)
    .map((match) => ({
      type: "web_search_result",
      title: stripHtml(match[2]),
      url: match[1],
    }))
    .filter((entry) => entry.title && entry.url);

  return matches;
}

async function runWebFetch(input, deps) {
  const url = typeof input?.url === "string" ? input.url.trim() : "";
  if (!url) {
    throw new Error("web_fetch requires a non-empty url.");
  }

  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const response = await fetchImpl(url, {
    headers: {
      "user-agent": "tabbit2api/0.1 (+https://localhost)",
    },
  });

  if (!response.ok) {
    throw new Error(`web_fetch upstream request failed with ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  const text = contentType.includes("html") ? stripHtml(raw) : raw.trim();
  return {
    url,
    content: truncate(text, Number(input?.max_chars) || MAX_FETCH_CHARS),
  };
}

function formatProcessOutput(stdout, stderr) {
  return truncate(
    [`stdout:\n${stdout || "(empty)"}`, `stderr:\n${stderr || "(empty)"}`].join(
      "\n\n",
    ),
  );
}

async function runCodeExecution(input, deps) {
  const language =
    typeof input?.language === "string" ? input.language.trim().toLowerCase() : "";
  const code = typeof input?.code === "string" ? input.code : "";
  const command = typeof input?.command === "string" ? input.command : "";
  const tempRoot =
    deps.tempRoot || path.join(os.tmpdir(), "tabbit2api-code-execution");
  const runId = crypto.randomUUID();
  const workDir = path.join(tempRoot, runId);

  await fs.mkdir(workDir, { recursive: true });

  try {
    if (command) {
      const shell = process.platform === "win32" ? "powershell.exe" : "sh";
      const args =
        process.platform === "win32"
          ? ["-NoProfile", "-Command", command]
          : ["-lc", command];
      try {
        const result = await execFile(shell, args, {
          cwd: workDir,
          timeout: CODE_EXECUTION_TIMEOUT_MS,
          maxBuffer: CODE_EXECUTION_MAX_BUFFER,
          env: {
            PATH: process.env.PATH || "",
          },
        });
        return {
          language: process.platform === "win32" ? "powershell" : "shell",
          output: formatProcessOutput(result.stdout, result.stderr),
        };
      } catch (error) {
        return {
          language: process.platform === "win32" ? "powershell" : "shell",
          output: formatProcessOutput(error.stdout || "", error.stderr || String(error)),
        };
      }
    }

    if (!code) {
      throw new Error("code_execution requires either command or code.");
    }

    if (language === "javascript" || language === "js" || language === "node") {
      try {
        const result = await execFile(
          process.execPath,
          ["--input-type=module", "-e", code],
          {
            cwd: workDir,
            timeout: CODE_EXECUTION_TIMEOUT_MS,
            maxBuffer: CODE_EXECUTION_MAX_BUFFER,
            env: {
              PATH: process.env.PATH || "",
            },
          },
        );
        return {
          language: "javascript",
          output: formatProcessOutput(result.stdout, result.stderr),
        };
      } catch (error) {
        return {
          language: "javascript",
          output: formatProcessOutput(error.stdout || "", error.stderr || String(error)),
        };
      }
    }

    if (language === "python" || language === "py") {
      const pythonExecutable = deps.pythonExecutable || "python";
      try {
        const result = await execFile(pythonExecutable, ["-c", code], {
          cwd: workDir,
          timeout: CODE_EXECUTION_TIMEOUT_MS,
          maxBuffer: CODE_EXECUTION_MAX_BUFFER,
          env: {
            PATH: process.env.PATH || "",
          },
        });
        return {
          language: "python",
          output: formatProcessOutput(result.stdout, result.stderr),
        };
      } catch (error) {
        return {
          language: "python",
          output: formatProcessOutput(error.stdout || "", error.stderr || String(error)),
        };
      }
    }

    throw new Error(
      "code_execution currently supports javascript, python, or command input.",
    );
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

export async function executeServerToolUse(block, deps = {}) {
  try {
    if (block.name === "web_search") {
      const results = await runWebSearch(block.input, deps);
      return buildJsonResultBlock("web_search_tool_result", block.id, results);
    }

    if (block.name === "web_fetch") {
      const result = await runWebFetch(block.input, deps);
      return buildTextResultBlock(
        "web_fetch_tool_result",
        block.id,
        result.content,
        {
          url: result.url,
        },
      );
    }

    if (block.name === "code_execution") {
      const result = await runCodeExecution(block.input, deps);
      return buildTextResultBlock(
        "code_execution_tool_result",
        block.id,
        result.output,
        {
          language: result.language,
        },
      );
    }

    return buildErrorResult(
      block,
      `${block.name}_tool_result`,
      `Unsupported server tool '${block.name}'.`,
    );
  } catch (error) {
    return buildErrorResult(
      block,
      `${block.name}_tool_result`,
      error instanceof Error ? error.message : String(error),
    );
  }
}
