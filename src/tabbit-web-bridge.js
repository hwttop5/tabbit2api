import {
  LAB_PROFILE_DIR,
  TABBIT_CHAT_URL,
  TABBIT_MODELS_URL,
  TABBIT_USER_DATA_DIR,
} from "./config.js";
import { prepareLabProfile } from "./profile.js";
import { launchTabbitSession, openPage } from "./tabbit-session.js";

const DEFAULT_TIMEOUT_MS = Number(process.env.TABBIT_SEND_TIMEOUT_MS || 180_000);
const MODEL_CACHE_MS = Number(process.env.TABBIT_MODEL_CACHE_MS || 300_000);
const TABBIT_ID_PREFIX = "tabbit/";
const PRIORITY_MODEL_ALIAS = `${TABBIT_ID_PREFIX}priority`;

const PRIORITY_ROUTE = [
  { displayName: "Claude-Opus-4.7", tier: "primary" },
  { displayName: "GPT-5.5", tier: "primary" },
  { displayName: "Claude-Sonnet-4.6", tier: "primary" },
  { displayName: "GPT-5.4", tier: "primary" },
  { displayName: "DeepSeek-V4-Pro", tier: "backup" },
  { displayName: "GLM-5.1", tier: "backup" },
  { displayName: "Gemini-3.1-Pro", tier: "backup" },
].map((route, index) => ({
  ...route,
  gatewayModelId: `${TABBIT_ID_PREFIX}${route.displayName}`,
  order: index + 1,
}));

const PRIORITY_ROUTE_BY_ID = new Map(
  PRIORITY_ROUTE.map((route) => [route.gatewayModelId, route]),
);
const PRIORITY_ROUTE_BY_NAME = new Map(
  PRIORITY_ROUTE.map((route) => [route.displayName.toLowerCase(), route]),
);

const RETRYABLE_TRANSPORT_ERRORS = new Set([
  "timeout",
  "send_failed",
  "send_threw",
  "stopGenerating_without_text",
  "chatFinished_without_text",
  "model_unavailable",
]);

const LOGIN_DETAIL_PATTERNS = [
  /\blogin\b/i,
  /\bsign[\s-]?in\b/i,
  /\bsigned out\b/i,
  /\bsession expired\b/i,
];

const INVALID_REQUEST_PATTERNS = [
  /\binvalid[_\s-]?request\b/i,
  /\bbad request\b/i,
  /\bmalformed\b/i,
  /\bunsupported\b/i,
  /\bmissing required\b/i,
  /\brequired field\b/i,
  /\bprompt is required\b/i,
  /\binput is required\b/i,
  /\bcontext length\b/i,
  /\btoken limit\b/i,
  /\btoo many input tokens\b/i,
];

const RETRYABLE_AVAILABILITY_PATTERNS = [
  /\b429\b/i,
  /\b5\d{2}\b/i,
  /\brate limit\b/i,
  /\bquota\b/i,
  /\binsufficient\b/i,
  /\bcredit\b/i,
  /\bbilling\b/i,
  /\bexhausted\b/i,
  /\boverload(?:ed)?\b/i,
  /\bbusy\b/i,
  /\bcapacity\b/i,
  /\bservice unavailable\b/i,
  /\btemporarily unavailable\b/i,
  /\bserver error\b/i,
  /\bbad gateway\b/i,
  /\bgateway timeout\b/i,
  /\btimeout\b/i,
  /\btimed out\b/i,
  /\bnetwork\b/i,
  /\bconnection\b/i,
  /\bsocket\b/i,
  /\beconn/i,
  /\betimedout\b/i,
  /\benotfound\b/i,
  /\bmodel not found\b/i,
  /\bdoes not exist\b/i,
  /\bnot found\b/i,
  /\bunavailable\b/i,
  /\bupgrade\b/i,
  /\bpremium\b/i,
  /\bsubscription\b/i,
  /\bpermission\b/i,
  /\bforbidden\b/i,
  /\bnot authorized\b/i,
  /\baccess denied\b/i,
];

let bridgePromise = null;
let modelCache = null;
let sendQueue = Promise.resolve();
let streamSequence = 0;

function serializeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function runExclusively(task) {
  const nextTask = sendQueue.catch(() => {}).then(task);
  sendQueue = nextTask.catch(() => {});
  return nextTask;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function decodeLatin1Utf8(value) {
  const text = cleanText(value);
  if (!text) {
    return "";
  }

  try {
    const decoded = Buffer.from(text, "latin1").toString("utf8").trim();
    return decoded && !decoded.includes("\uFFFD") ? decoded : text;
  } catch {
    return text;
  }
}

function preferredRouteForName(value) {
  const route = PRIORITY_ROUTE_BY_NAME.get(cleanText(value).toLowerCase());
  return route || null;
}

function isLikelyDefaultModel(model, index, decodedDisplayName) {
  if (cleanText(decodedDisplayName).toLowerCase() === "default") {
    return true;
  }

  return Boolean(
    index === 0 &&
      model &&
      model.model_access_type === "free_unlimited" &&
      !preferredRouteForName(decodedDisplayName),
  );
}

function normalizeCatalogDisplayName(model, index) {
  const rawDisplayName = cleanText(model?.display_name);
  const decodedDisplayName = decodeLatin1Utf8(rawDisplayName);
  const preferredRoute =
    preferredRouteForName(decodedDisplayName) ||
    preferredRouteForName(rawDisplayName);

  if (preferredRoute) {
    return preferredRoute.displayName;
  }

  if (isLikelyDefaultModel(model, index, decodedDisplayName)) {
    return "Default";
  }

  return decodedDisplayName || rawDisplayName;
}

function normalizeRequestedModelId(requestedModel) {
  const trimmed = cleanText(requestedModel);
  if (!trimmed) {
    return PRIORITY_MODEL_ALIAS;
  }

  const lowered = trimmed.toLowerCase();
  if (lowered === PRIORITY_MODEL_ALIAS || lowered === "priority") {
    return PRIORITY_MODEL_ALIAS;
  }

  if (lowered.startsWith(TABBIT_ID_PREFIX)) {
    const suffix = trimmed.slice(TABBIT_ID_PREFIX.length);
    const preferredRoute = preferredRouteForName(suffix);
    if (preferredRoute) {
      return preferredRoute.gatewayModelId;
    }

    if (suffix.toLowerCase() === "default") {
      return `${TABBIT_ID_PREFIX}Default`;
    }

    return `${TABBIT_ID_PREFIX}${suffix}`;
  }

  const preferredRoute = preferredRouteForName(trimmed);
  if (preferredRoute) {
    return preferredRoute.gatewayModelId;
  }

  if (lowered === "default") {
    return `${TABBIT_ID_PREFIX}Default`;
  }

  return `${TABBIT_ID_PREFIX}${trimmed}`;
}

export function toGatewayModelId(displayName) {
  return `${TABBIT_ID_PREFIX}${displayName}`;
}

function modelDescriptorFromCatalogModel(model, index) {
  const displayName = normalizeCatalogDisplayName(model, index);
  return {
    id: toGatewayModelId(displayName),
    displayName,
    selectedModel: cleanText(model?.display_name) || displayName,
    tabbit_display_name: cleanText(model?.display_name) || displayName,
    supports_images: Boolean(model?.supports_images),
    supports_tools: Boolean(model?.supports_tools),
    support_thinking: Boolean(model?.support_thinking),
    model_access_type: model?.model_access_type || null,
    available_in_tabbit_catalog: true,
    source: "tabbit",
    priority_group: null,
    priority_rank: null,
  };
}

function staticRouteDescriptor(route, catalogMatch) {
  return {
    id: route.gatewayModelId,
    displayName: route.displayName,
    selectedModel: catalogMatch?.selectedModel || route.displayName,
    tabbit_display_name: catalogMatch?.tabbit_display_name || route.displayName,
    supports_images:
      catalogMatch?.supports_images ??
      (route.tier === "primary" || route.displayName === "Gemini-3.1-Pro"),
    supports_tools: catalogMatch?.supports_tools ?? true,
    support_thinking:
      catalogMatch?.support_thinking ??
      route.displayName !== "GPT-5.5",
    model_access_type: catalogMatch?.model_access_type || null,
    available_in_tabbit_catalog: Boolean(catalogMatch),
    source: "priority_route",
    priority_group: route.tier,
    priority_rank: route.order,
  };
}

function virtualPriorityDescriptor() {
  return {
    id: PRIORITY_MODEL_ALIAS,
    displayName: "priority",
    selectedModel: null,
    tabbit_display_name: "priority",
    supports_images: true,
    supports_tools: true,
    support_thinking: true,
    model_access_type: "virtual_priority",
    available_in_tabbit_catalog: true,
    source: "virtual",
    priority_group: "virtual",
    priority_rank: 0,
  };
}

function buildGatewayCatalogBundle(rawModels) {
  const catalogModels = rawModels.map(modelDescriptorFromCatalogModel);
  const catalogById = new Map(catalogModels.map((model) => [model.id, model]));
  const seenIds = new Set();
  const models = [];

  const pushModel = (model) => {
    if (!model || seenIds.has(model.id)) {
      return;
    }

    seenIds.add(model.id);
    models.push(model);
  };

  pushModel(virtualPriorityDescriptor());

  for (const route of PRIORITY_ROUTE) {
    pushModel(staticRouteDescriptor(route, catalogById.get(route.gatewayModelId)));
  }

  for (const model of catalogModels) {
    pushModel(model);
  }

  return {
    models,
    byId: new Map(models.map((model) => [model.id, model])),
    byDisplayName: new Map(
      models.map((model) => [model.displayName.toLowerCase(), model]),
    ),
    bySelectedModel: new Map(
      models
        .filter((model) => model.selectedModel)
        .map((model) => [model.selectedModel.toLowerCase(), model]),
    ),
    catalogAvailable: rawModels.length > 0,
  };
}

function resolveRoutePlan(requestedModel, catalogBundle) {
  const requestedModelAlias = normalizeRequestedModelId(requestedModel);

  if (requestedModelAlias === PRIORITY_MODEL_ALIAS) {
    return {
      ok: true,
      kind: "priority_chain",
      requestedModelAlias,
      attempts: PRIORITY_ROUTE.map((route) => {
        const model =
          catalogBundle.byId.get(route.gatewayModelId) ||
          staticRouteDescriptor(route, null);

        return {
          gatewayModelId: model.id,
          displayName: model.displayName,
          selectedModel: model.selectedModel || route.displayName,
          availableInTabbitCatalog: model.available_in_tabbit_catalog,
          priorityGroup: route.tier,
          priorityRank: route.order,
        };
      }),
    };
  }

  const exactModel =
    catalogBundle.byId.get(requestedModelAlias) ||
    catalogBundle.byDisplayName.get(
      requestedModelAlias.slice(TABBIT_ID_PREFIX.length).toLowerCase(),
    ) ||
    catalogBundle.bySelectedModel.get(
      requestedModelAlias.slice(TABBIT_ID_PREFIX.length).toLowerCase(),
    );

  if (!exactModel) {
    return {
      ok: false,
      result: {
        ok: false,
        error: "invalid_request",
        detail: `Unknown model '${requestedModel}'. Use GET /v1/models to list supported ids.`,
        requestedModelAlias,
        attemptedModels: [],
        fallbackHappened: false,
      },
    };
  }

  return {
    ok: true,
    kind: "direct",
    requestedModelAlias: exactModel.id,
    attempts: [
      {
        gatewayModelId: exactModel.id,
        displayName: exactModel.displayName,
        selectedModel: exactModel.selectedModel || exactModel.displayName,
        availableInTabbitCatalog: exactModel.available_in_tabbit_catalog,
        priorityGroup: exactModel.priority_group,
        priorityRank: exactModel.priority_rank,
      },
    ],
  };
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function classifyAttemptFailure(result) {
  if (result.ok) {
    return { retryable: false, reason: "success" };
  }

  const error = cleanText(result.error);
  const detail = cleanText(result.detail);

  if (error === "login_required") {
    return { retryable: false, reason: "login_required" };
  }

  if (error === "invalid_request") {
    return { retryable: false, reason: "invalid_request" };
  }

  if (RETRYABLE_TRANSPORT_ERRORS.has(error)) {
    return { retryable: true, reason: error };
  }

  if (matchesAny(detail, LOGIN_DETAIL_PATTERNS)) {
    return { retryable: false, reason: "login_required" };
  }

  if (matchesAny(detail, INVALID_REQUEST_PATTERNS)) {
    return { retryable: false, reason: "invalid_request" };
  }

  if (matchesAny(detail, RETRYABLE_AVAILABILITY_PATTERNS)) {
    return { retryable: true, reason: "upstream_unavailable" };
  }

  return { retryable: false, reason: error || "tabbit_error" };
}

async function createBridge() {
  const profile = await prepareLabProfile({
    sourceUserDataDir: TABBIT_USER_DATA_DIR,
    labProfileDir: LAB_PROFILE_DIR,
  });

  const context = await launchTabbitSession(profile.labProfileDir, {
    headless: false,
  });

  const bridge = {
    context,
    page: null,
    profile,
  };

  context.on("close", () => {
    if (bridgePromise) {
      bridgePromise = null;
    }
  });

  return bridge;
}

async function ensureBridge() {
  if (!bridgePromise) {
    bridgePromise = createBridge();
  }

  return bridgePromise;
}

async function ensureChatPage(bridge) {
  let { page } = bridge;
  if (!page || page.isClosed()) {
    page = await openPage(bridge.context, TABBIT_CHAT_URL);
    bridge.page = page;
  }

  await page.waitForFunction(
    () => Array.isArray(globalThis.webpackChunk_N_E),
    null,
    { timeout: 30_000 },
  );
  return page;
}

async function readLoginState(page) {
  return page.evaluate(async () => {
    const tabSignin = globalThis.chrome?.tabSignin;
    const loginState =
      tabSignin && typeof tabSignin.getLoginState === "function"
        ? await tabSignin.getLoginState()
        : null;

    return {
      loginState,
      hasComposer: Boolean(
        document.querySelector(
          "textarea, [contenteditable='true'], input[type='text']",
        ),
      ),
      url: location.href,
      title: document.title,
    };
  });
}

function isLoggedOut(loginState) {
  return Boolean(
    loginState?.loginState &&
      loginState.loginState.isLoggedIn === false &&
      loginState.loginState.hasToken === false,
  );
}

async function sendUsingPageModule(
  page,
  { prompt, selectedModel, timeoutMs, models, onDelta },
) {
  const streamId = `tabbit-stream-${Date.now()}-${++streamSequence}`;
  if (onDelta) {
    await page.exposeFunction(streamId, (payload) => {
      if (payload && typeof payload.delta === "string" && payload.delta) {
        onDelta(payload.delta);
      }
    });
  }

  return page.evaluate(
    async ({ prompt, selectedModel, timeoutMs, models, streamBridgeName }) => {
      function captureWebpackRequire() {
        let runtime = null;
        self.webpackChunk_N_E.push([
          [Symbol("tabbit-gateway-bridge")],
          {},
          (require) => {
            runtime = require;
          },
        ]);

        if (!runtime) {
          throw new Error("Unable to capture Tabbit webpack runtime.");
        }

        return runtime;
      }

      function stringifyDetail(detail) {
        if (typeof detail === "string") {
          return detail;
        }

        try {
          return JSON.stringify(detail);
        } catch {
          return String(detail);
        }
      }

      function summarizeFailure(args) {
        return args.map((value) => stringifyDetail(value)).join(" | ");
      }

      function findLatestAssistant(messages) {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          if (messages[index]?.type === "assistant") {
            return messages[index];
          }
        }

        return null;
      }

      function collectAssistantText(assistant) {
        if (!assistant) {
          return "";
        }

        const parts = [];

        function visit(node) {
          if (!node) {
            return;
          }

          if (Array.isArray(node)) {
            for (const item of node) {
              visit(item);
            }
            return;
          }

          if (typeof node === "string") {
            parts.push(node);
            return;
          }

          if (typeof node !== "object") {
            return;
          }

          if (node.type === "assistant" && typeof node.content === "string") {
            parts.push(node.content);
          }

          if (Array.isArray(node.messages)) {
            visit(node.messages);
          }

          if (Array.isArray(node.content)) {
            visit(node.content);
          }
        }

        visit(assistant.messages || []);
        return parts.join("").trim();
      }

      function getAssistantTextParts(assistant) {
        if (!assistant) {
          return [];
        }

        const parts = [];

        function visit(node) {
          if (!node) {
            return;
          }

          if (Array.isArray(node)) {
            for (const item of node) {
              visit(item);
            }
            return;
          }

          if (typeof node === "string") {
            parts.push(node);
            return;
          }

          if (typeof node !== "object") {
            return;
          }

          if (node.type === "assistant" && typeof node.content === "string") {
            parts.push(node.content);
          }

          if (Array.isArray(node.messages)) {
            visit(node.messages);
          }

          if (Array.isArray(node.content)) {
            visit(node.content);
          }
        }

        visit(assistant.messages || []);
        return parts;
      }

      function assistantErrors(assistant) {
        if (!assistant || !Array.isArray(assistant.messages)) {
          return [];
        }

        return assistant.messages
          .filter((entry) => entry?.type === "error")
          .map((entry) => ({
            code: entry.code || null,
            message:
              entry.content ||
              entry.message ||
              `Error ${entry.code || ""}`.trim(),
          }))
          .filter((entry) => entry.message || entry.code);
      }

      function assistantRequiresLogin(assistant) {
        return assistant?.messages?.some((entry) => entry?.type === "login") || false;
      }

      const runtime = captureWebpackRequire();
      const sendMessage = runtime(51523)._;
      const modes = runtime(96164).R7;

      const state = {
        messages: [],
      };
      let emittedText = "";

      let settled = false;
      let resolveDone;
      const done = new Promise((resolve) => {
        resolveDone = resolve;
      });

      const settle = (payload) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolveDone(payload);
      };

      const finishFromState = (source) => {
        const assistant = findLatestAssistant(state.messages);
        if (!assistant || assistant.generating) {
          emitDeltaFromAssistant(assistant);
          return false;
        }

        emitDeltaFromAssistant(assistant);

        if (assistantRequiresLogin(assistant)) {
          settle({
            ok: false,
            error: "login_required",
            detail: "The local Tabbit runtime profile is not logged in yet.",
            source,
          });
          return true;
        }

        const errors = assistantErrors(assistant);
        if (errors.length > 0) {
          settle({
            ok: false,
            error: "tabbit_error",
            detail: errors
              .map((entry) =>
                entry.code ? `[${entry.code}] ${entry.message}` : entry.message,
              )
              .join("\n"),
            errorCodes: errors
              .map((entry) => entry.code)
              .filter(Boolean),
            partialText: collectAssistantText(assistant),
            source,
          });
          return true;
        }

        const text = collectAssistantText(assistant);
        if (text) {
          settle({
            ok: true,
            text,
            source,
          });
          return true;
        }

        return false;
      };

      const emitDeltaFromAssistant = (assistant) => {
        if (!assistant || typeof self[streamBridgeName] !== "function") {
          return;
        }

        const nextText = getAssistantTextParts(assistant).join("").trim();
        if (!nextText || nextText.length <= emittedText.length) {
          return;
        }

        if (!nextText.startsWith(emittedText)) {
          emittedText = nextText;
          self[streamBridgeName]({ delta: nextText });
          return;
        }

        const delta = nextText.slice(emittedText.length);
        emittedText = nextText;
        if (delta) {
          self[streamBridgeName]({ delta });
        }
      };

      const setMessages = (_sessionId, updater) => {
        state.messages =
          typeof updater === "function" ? updater(state.messages) : updater;
        finishFromState("setMessages");
      };

      const timer = setTimeout(() => {
        const assistant = findLatestAssistant(state.messages);
        settle({
          ok: false,
          error: "timeout",
          detail: `Timed out after ${timeoutMs}ms waiting for Tabbit.`,
          partialText: collectAssistantText(assistant),
        });
      }, timeoutMs);

      const delayFailure = (kind, detail) => {
        setTimeout(() => {
          if (!finishFromState(kind)) {
            settle({
              ok: false,
              error: kind,
              detail,
              partialText: collectAssistantText(findLatestAssistant(state.messages)),
            });
          }
        }, 100);
      };

      try {
        const maybePromise = sendMessage({
          messageId: null,
          message: prompt,
          originHTML: "",
          references: [],
          sessionId: "",
          model: selectedModel,
          selectedModels: [selectedModel],
          mod: modes.ASK,
          url: "",
          source: "singleSession",
          useDirectApi: false,
          models,
          updateSessionId: () => {},
          setMessages,
          setSessionTitle: () => {},
          shouldApplyAutoSessionTitle: () => true,
          onBeforeSend: () => {},
          startGenerating: () => {},
          stopGenerating: () => {
            delayFailure(
              "stopGenerating_without_text",
              "Tabbit stopped without returning text.",
            );
          },
          associateTabWithSession: () => {},
          updateBrowserUseStatus: () => {},
          errorMessages: {},
          onModelChange: () => {},
          refreshModels: () => {},
          onChatFinish: () => {
            delayFailure(
              "chatFinished_without_text",
              "Tabbit finished without returning text.",
            );
          },
          onFailed: (...args) => {
            delayFailure(
              "send_failed",
              summarizeFailure(args) || "Tabbit send failed.",
            );
          },
        });

        Promise.resolve(maybePromise).catch((error) => {
          settle({
            ok: false,
            error: "send_threw",
            detail: stringifyDetail(error),
          });
        });
      } catch (error) {
        settle({
          ok: false,
          error: "send_threw",
          detail: stringifyDetail(error),
        });
      }

      return done;
    },
    {
      prompt,
      selectedModel,
      timeoutMs,
      models,
      streamBridgeName: streamId,
    },
  );
}

export async function getTabbitModels() {
  if (modelCache && modelCache.expiresAt > Date.now()) {
    return modelCache.models;
  }

  const bridge = await ensureBridge();
  const page = await ensureChatPage(bridge);
  const payload = await page.evaluate(async (url) => {
    const response = await fetch(url, {
      credentials: "include",
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Tabbit model list request failed: ${response.status}`);
    }

    return response.json();
  }, TABBIT_MODELS_URL);

  const models = Array.isArray(payload?.models) ? payload.models : [];

  modelCache = {
    expiresAt: Date.now() + MODEL_CACHE_MS,
    models,
  };

  return models;
}

export async function getGatewayModelCatalog() {
  const models = await getTabbitModels();
  return buildGatewayCatalogBundle(models).models;
}

export async function getBridgeHealth() {
  if (!bridgePromise) {
    return {
      status: "ok",
      mode: "tabbit-web-bridge",
      runtimeInitialized: false,
    };
  }

  try {
    const bridge = await bridgePromise;
    const page =
      bridge.page && !bridge.page.isClosed()
        ? bridge.page
        : bridge.context.pages().find((candidate) => !candidate.isClosed()) ||
          null;

    if (!page) {
      return {
        status: "ok",
        mode: "tabbit-web-bridge",
        runtimeInitialized: true,
        pageReady: false,
      };
    }

    return {
      status: "ok",
      mode: "tabbit-web-bridge",
      runtimeInitialized: true,
      pageReady: true,
      ...(await readLoginState(page)),
    };
  } catch (error) {
    return {
      status: "degraded",
      mode: "tabbit-web-bridge",
      runtimeInitialized: true,
      error: serializeError(error),
    };
  }
}

export async function sendPromptToTabbit({
  prompt,
  model,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onDelta,
}) {
  return runExclusively(async () => {
    const requestedModelAlias = normalizeRequestedModelId(model);
    const bridge = await ensureBridge();
    const page = await ensureChatPage(bridge);
    const loginState = await readLoginState(page);
    if (isLoggedOut(loginState)) {
      return {
        ok: false,
        error: "login_required",
        detail:
          "The local Tabbit runtime profile is not logged in. Run `tabbit2api login` and sign in once inside the login browser window.",
        requestedModelAlias,
        attemptedModels: [],
        fallbackHappened: false,
      };
    }

    let rawModels = [];
    let catalogBundle = buildGatewayCatalogBundle(rawModels);

    try {
      rawModels = await getTabbitModels();
      catalogBundle = buildGatewayCatalogBundle(rawModels);
    } catch {
      rawModels = [];
      catalogBundle = buildGatewayCatalogBundle(rawModels);
    }

    const routePlan = resolveRoutePlan(model, catalogBundle);
    if (!routePlan.ok) {
      return routePlan.result;
    }

    const attemptedModels = [];

    for (let index = 0; index < routePlan.attempts.length; index += 1) {
      const attempt = routePlan.attempts[index];
      attemptedModels.push(attempt.gatewayModelId);

      let result;
      if (
        catalogBundle.catalogAvailable &&
        attempt.availableInTabbitCatalog === false
      ) {
        result = {
          ok: false,
          error: "model_unavailable",
          detail: `${attempt.gatewayModelId} is not present in the current Tabbit model catalog.`,
        };
      } else {
        result = await sendUsingPageModule(page, {
          prompt,
          selectedModel: attempt.selectedModel,
          timeoutMs,
          models: rawModels,
          onDelta,
        });
      }

      const decoratedResult = {
        ...result,
        selectedModel: attempt.selectedModel,
        gatewayModelId: attempt.gatewayModelId,
        requestedModelAlias: routePlan.requestedModelAlias,
        attemptedModels: [...attemptedModels],
        fallbackHappened: index > 0,
      };

      if (decoratedResult.ok) {
        return decoratedResult;
      }

      const failure = classifyAttemptFailure(decoratedResult);
      if (
        routePlan.kind !== "priority_chain" ||
        !failure.retryable ||
        index === routePlan.attempts.length - 1
      ) {
        return {
          ...decoratedResult,
          failure_reason: failure.reason,
        };
      }
    }

    return {
      ok: false,
      error: "tabbit_error",
      detail: "No Tabbit route attempts were executed.",
      requestedModelAlias: routePlan.requestedModelAlias,
      attemptedModels,
      fallbackHappened: attemptedModels.length > 1,
    };
  });
}
