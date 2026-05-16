import http from "node:http";

import {
  createTextResponseStream,
  extractPrompt,
  streamTextResponse,
} from "./openai-responses.js";
import {
  getBridgeHealth,
  getGatewayModelCatalog,
  sendPromptToTabbit,
} from "./tabbit-web-bridge.js";

const PORT = Number(process.env.PORT || 50124);
const API_KEY = process.env.TABBIT_API_KEY || "sk-tabbit-local";

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function writeJsonWithHeaders(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    "content-type": "application/json",
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function writeOpenAiError(res, statusCode, message, type = "api_error") {
  writeJson(res, statusCode, {
    error: {
      message,
      type,
    },
  });
}

function mapTabbitModelsToOpenAi(models) {
  return {
    object: "list",
    data: models.map((model) => ({
      id: model.id,
      object: "model",
      created: 0,
      owned_by: "tabbit",
      tabbit_display_name: model.tabbit_display_name || model.displayName,
      tabbit_selected_model: model.selectedModel || null,
      supports_images: Boolean(model.supports_images),
      supports_tools: Boolean(model.supports_tools),
      support_thinking: Boolean(model.support_thinking),
      model_access_type: model.model_access_type || null,
      priority_group: model.priority_group || null,
      priority_rank: model.priority_rank || null,
      available_in_tabbit_catalog: Boolean(model.available_in_tabbit_catalog),
    })),
  };
}

function statusCodeForResult(result) {
  if (result.error === "login_required") {
    return 401;
  }

  if (result.error === "invalid_request") {
    return 400;
  }

  if (result.error === "timeout") {
    return 504;
  }

  return 502;
}

function openAiErrorTypeForResult(result) {
  if (result.error === "login_required") {
    return "authentication_error";
  }

  if (result.error === "invalid_request") {
    return "invalid_request_error";
  }

  return "api_error";
}

function normalizeRequestMetadata(metadata) {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata;
  }

  return {};
}

function extractBearerToken(req) {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string") {
    return "";
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function isAuthorized(req) {
  return extractBearerToken(req) === API_KEY;
}

function writeAuthenticationError(res) {
  writeJsonWithHeaders(
    res,
    401,
    {
      error: {
        message: "Missing or invalid API key.",
        type: "authentication_error",
      },
    },
    {
      "www-authenticate": 'Bearer realm="tabbit-local-gateway"',
    },
  );
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    writeJson(res, 200, await getBridgeHealth());
    return;
  }

  if (req.method === "GET" && req.url === "/v1/models") {
    if (!isAuthorized(req)) {
      writeAuthenticationError(res);
      return;
    }

    try {
      const models = await getGatewayModelCatalog();
      writeJson(res, 200, mapTabbitModelsToOpenAi(models));
    } catch (error) {
      writeOpenAiError(
        res,
        502,
        error instanceof Error ? error.message : String(error),
      );
    }
    return;
  }

  if (req.method === "POST" && req.url === "/v1/responses") {
    if (!isAuthorized(req)) {
      writeAuthenticationError(res);
      return;
    }

    try {
      const body = await readJson(req);
      const prompt = extractPrompt(body);
      let responseStream = null;
      const ensureResponseStream = (modelOverride, extraMetadata = {}) => {
        if (!responseStream) {
          const responseBody = {
            ...body,
            metadata: {
              ...normalizeRequestMetadata(body.metadata),
              ...extraMetadata,
            },
          };
          responseStream = createTextResponseStream(
            res,
            responseBody,
            modelOverride || body.model || "tabbit/priority",
          );
        }

        return responseStream;
      };

      if (!prompt) {
        writeOpenAiError(
          res,
          400,
          "No prompt text was found in the request body.",
          "invalid_request_error",
        );
        return;
      }

      const result = await sendPromptToTabbit({
        prompt,
        model: body.model,
        onDelta: (delta) => {
          ensureResponseStream(body.model || "tabbit/priority", {
            requested_model_alias: body.model || "tabbit/priority",
          }).append(delta);
        },
      });

      console.log(
        `[tabbit-route] requested=${
          result.requestedModelAlias || body.model || "tabbit/priority"
        } attempts=${(result.attemptedModels || []).join(" -> ") || "(none)"} final=${
          result.ok ? result.gatewayModelId : "failed"
        } fallback=${Boolean(result.fallbackHappened)}`,
      );

      if (!result.ok) {
        if (res.headersSent) {
          const stream = ensureResponseStream(
            result.gatewayModelId || body.model || "tabbit/priority",
            {
              requested_model_alias:
                result.requestedModelAlias || body.model || "tabbit/priority",
              attempted_models: result.attemptedModels || [],
              fallback_happened: Boolean(result.fallbackHappened),
            },
          );
          if (result.partialText) {
            stream.append(result.partialText);
          }
          stream.fail(result.detail || "Tabbit bridge request failed.");
          return;
        }

        writeOpenAiError(
          res,
          statusCodeForResult(result),
          result.detail || "Tabbit bridge request failed.",
          openAiErrorTypeForResult(result),
        );
        return;
      }

      const responseBody = {
        ...body,
        metadata: {
          ...normalizeRequestMetadata(body.metadata),
          requested_model_alias:
            result.requestedModelAlias || body.model || "tabbit/priority",
          attempted_models:
            result.attemptedModels || [result.gatewayModelId || body.model],
          fallback_happened: Boolean(result.fallbackHappened),
        },
      };

      if (res.headersSent) {
        const stream = ensureResponseStream(
          result.gatewayModelId || body.model || "tabbit/priority",
          responseBody.metadata,
        );
        stream.complete(result.text);
        return;
      }

      await streamTextResponse(
        res,
        responseBody,
        result.text,
        result.gatewayModelId || body.model || "tabbit/priority",
      );
    } catch (error) {
      writeOpenAiError(
        res,
        400,
        error instanceof Error ? error.message : String(error),
        "invalid_request_error",
      );
    }
    return;
  }

  writeJson(res, 404, { error: "not_found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Tabbit2API gateway listening on http://127.0.0.1:${PORT}`);
});
