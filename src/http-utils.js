export function readJson(req) {
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

export function writeJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

export function extractBearerToken(req) {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string") {
    return "";
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export function extractAnthropicApiKey(req) {
  const header = req.headers["x-api-key"];
  return typeof header === "string" ? header.trim() : "";
}

export function isAnthropicRequest(req) {
  const path = normalizedPathname(req);
  return Boolean(
    req.headers["anthropic-version"] ||
      req.headers["x-api-key"] ||
      path === "/v1/messages" ||
      path === "/v1/messages/count_tokens" ||
      path.startsWith("/v1/models/"),
  );
}

export function normalizedPathname(req) {
  const rawPath = new URL(req.url || "/", "http://127.0.0.1").pathname;
  return rawPath.startsWith("/v1/v1/")
    ? rawPath.replace(/^\/v1\/v1\//, "/v1/")
    : rawPath;
}

export function isAuthorized(req, apiKey) {
  const bearer = extractBearerToken(req);
  const anthropic = extractAnthropicApiKey(req);
  return bearer === apiKey || anthropic === apiKey;
}

export function writeOpenAiError(
  res,
  statusCode,
  message,
  type = "api_error",
  headers = {},
) {
  writeJson(
    res,
    statusCode,
    {
      error: {
        message,
        type,
      },
    },
    headers,
  );
}

export function writeAnthropicError(
  res,
  statusCode,
  message,
  type = "invalid_request_error",
  headers = {},
) {
  writeJson(
    res,
    statusCode,
    {
      type: "error",
      error: {
        type,
        message,
      },
    },
    headers,
  );
}

export function writeAuthenticationError(res, protocol) {
  if (protocol === "anthropic") {
    writeAnthropicError(
      res,
      401,
      "Missing or invalid API key.",
      "authentication_error",
    );
    return;
  }

  writeOpenAiError(
    res,
    401,
    "Missing or invalid API key.",
    "authentication_error",
    {
      "www-authenticate": 'Bearer realm="tabbit-local-gateway"',
    },
  );
}
