import {
  LAB_PROFILE_DIR,
  TABBIT_CHAT_URL,
  TABBIT_MODELS_URL,
  TABBIT_USER_DATA_DIR,
} from "./config.js";
import { materializeAttachmentsForUpload } from "./attachments.js";
import { prepareLabProfile } from "./profile.js";
import { launchTabbitSession, openPage } from "./tabbit-session.js";
import {
  buildGatewayCatalogBundle,
  classifyAttemptFailure,
  normalizeRequestedModelId,
  resolveRoutePlan,
  toGatewayModelId,
} from "./tabbit-bridge-core.js";

export { classifyAttemptFailure, toGatewayModelId } from "./tabbit-bridge-core.js";

const DEFAULT_TIMEOUT_MS = Number(process.env.TABBIT_SEND_TIMEOUT_MS || 180_000);
const MODEL_CACHE_MS = Number(process.env.TABBIT_MODEL_CACHE_MS || 300_000);

let bridgePromise = null;
let modelCache = null;
let sendQueue = Promise.resolve();
let activeSendCount = 0;
let lastBridgeError = null;
let streamSequence = 0;

function serializeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function rememberBridgeError(error, source) {
  lastBridgeError = {
    source,
    message: serializeError(error),
    at: new Date().toISOString(),
  };
}

function summarizePath(value) {
  const parts = cleanText(value).split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 2) {
    return parts.join("/");
  }

  return `.../${parts.slice(-2).join("/")}`;
}

function bridgeDiagnostics(profile = null) {
  return {
    modelCache: {
      cached: Boolean(modelCache),
      modelCount: modelCache?.models?.length || 0,
      expiresAt: modelCache?.expiresAt || null,
      ttlMs: modelCache ? Math.max(0, modelCache.expiresAt - Date.now()) : 0,
    },
    queue: {
      active: activeSendCount,
      busy: activeSendCount > 0,
    },
    runtimeProfile: {
      labProfileDir: summarizePath(profile?.labProfileDir || LAB_PROFILE_DIR),
      defaultProfileDir: summarizePath(profile?.defaultProfileDir || ""),
    },
    lastBridgeError,
  };
}

function runExclusively(task) {
  const nextTask = sendQueue.catch(() => {}).then(async () => {
    activeSendCount += 1;
    try {
      return await task();
    } finally {
      activeSendCount -= 1;
    }
  });
  sendQueue = nextTask.catch(() => {});
  return nextTask;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function randomReferenceId() {
  return `${Date.now() + Math.floor(Math.random() * 1_000_000)}`;
}

export function attachmentUploadResultToReference(attachment, uploadResult) {
  const fileId = cleanText(
    uploadResult?.fileId ||
      uploadResult?.file_id ||
      uploadResult?.id ||
      uploadResult?.path,
  );
  if (!fileId) {
    throw new Error(
      `Tabbit upload did not return a file id for '${attachment?.filename || "attachment"}'.`,
    );
  }

  const title = cleanText(
    uploadResult?.fileName ||
      uploadResult?.filename ||
      uploadResult?.name ||
      attachment?.filename,
  );
  const url = cleanText(uploadResult?.url || uploadResult?.fileUrl || "");

  if (attachment?.kind === "image") {
    return {
      id: randomReferenceId(),
      type: "image",
      title,
      content: url,
      favicon: "",
      path: fileId,
      ...(attachment.sourceUrl ? { sourceUrl: attachment.sourceUrl } : {}),
    };
  }

  return {
    id: randomReferenceId(),
    type: "document",
    title,
    content: "",
    path: fileId,
  };
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
  { prompt, selectedModel, timeoutMs, models, onDelta, attachments = [] },
) {
  const streamId = `tabbit-stream-${Date.now()}-${++streamSequence}`;
  if (onDelta) {
    await page.exposeFunction(streamId, (payload) => {
      if (payload && typeof payload.delta === "string" && payload.delta) {
        onDelta(payload.delta);
      }
    });
  }

  try {
    return await page.evaluate(
      async ({
      prompt,
      selectedModel,
      timeoutMs,
      models,
      streamBridgeName,
      attachments,
      }) => {
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

      function cleanText(value) {
        return typeof value === "string" ? value.trim() : "";
      }

      function bytesFromBase64(base64) {
        const binary = atob(base64 || "");
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
      }

      function withTimeout(promise, timeout, label) {
        let timer;
        const timeoutPromise = new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeout}ms.`));
          }, timeout);
        });

        return Promise.race([promise, timeoutPromise]).finally(() => {
          clearTimeout(timer);
        });
      }

      function uploadResultToReference(attachment, uploadResult, referenceHelpers) {
        const fileId = cleanText(
          uploadResult?.fileId ||
            uploadResult?.file_id ||
            uploadResult?.id ||
            uploadResult?.path,
        );
        if (!fileId) {
          throw new Error(
            `Tabbit upload did not return a file id for '${
              attachment?.filename || "attachment"
            }'.`,
          );
        }

        const title = cleanText(
          uploadResult?.fileName ||
            uploadResult?.filename ||
            uploadResult?.name ||
            attachment?.filename,
        );
        const url = cleanText(uploadResult?.url || uploadResult?.fileUrl || "");

        if (
          attachment?.kind === "image" &&
          typeof referenceHelpers?.rf === "function"
        ) {
          const reference = referenceHelpers.rf(title, url, fileId);
          return attachment.sourceUrl
            ? { ...reference, sourceUrl: attachment.sourceUrl }
            : reference;
        }

        if (
          attachment?.kind !== "image" &&
          typeof referenceHelpers?.vT === "function"
        ) {
          return referenceHelpers.vT(title, fileId);
        }

        if (attachment?.kind === "image") {
          return {
            id: `${Date.now() + Math.floor(Math.random() * 1_000_000)}`,
            type: "image",
            title,
            content: url,
            favicon: "",
            path: fileId,
            ...(attachment.sourceUrl ? { sourceUrl: attachment.sourceUrl } : {}),
          };
        }

        return {
          id: `${Date.now() + Math.floor(Math.random() * 1_000_000)}`,
          type: "document",
          title,
          content: "",
          path: fileId,
        };
      }

      async function uploadAttachments(runtime, attachmentList, uploadTimeoutMs) {
        if (!Array.isArray(attachmentList) || attachmentList.length === 0) {
          return [];
        }

        let uploadFile;
        try {
          uploadFile = runtime(68886).w;
        } catch {
          uploadFile = null;
        }

        if (typeof uploadFile !== "function") {
          throw new Error("Unable to find Tabbit attachment upload function.");
        }

        let referenceHelpers;
        try {
          referenceHelpers = runtime(45677);
        } catch {
          referenceHelpers = null;
        }

        const references = [];
        for (const attachment of attachmentList) {
          if (!attachment?.bytes) {
            throw new Error(
              `Attachment '${attachment?.filename || "attachment"}' has no upload bytes.`,
            );
          }

          const file = new File([bytesFromBase64(attachment.bytes)], attachment.filename, {
            type: attachment.mimeType || "application/octet-stream",
          });
          const uploadResult = await withTimeout(
            uploadFile(file, {
              fileCategory: attachment.kind === "image" ? "image" : "document",
            }),
            uploadTimeoutMs,
            `Uploading attachment '${attachment.filename}'`,
          );

          if (!uploadResult || uploadResult.success === false) {
            throw new Error(
              uploadResult?.error ||
                uploadResult?.message ||
                `Tabbit upload failed for '${attachment.filename}'.`,
            );
          }

          references.push(
            uploadResultToReference(attachment, uploadResult, referenceHelpers),
          );
        }

        return references;
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

      function summarizeStateMessages(messages, references) {
        return JSON.stringify({
          reference_count: references.length,
          messages: (messages || []).slice(-3).map((message) => ({
            type: message?.type || null,
            status: message?.status || null,
            generating: Boolean(message?.generating),
            content_type: typeof message?.content,
            content_preview:
              typeof message?.content === "string"
                ? message.content.slice(0, 160)
                : "",
            nested_types: Array.isArray(message?.messages)
              ? message.messages.slice(-5).map((entry) => ({
                  type: entry?.type || null,
                  status: entry?.status || null,
                  code: entry?.code || null,
                  content_type: typeof entry?.content,
                  content_preview:
                    typeof entry?.content === "string"
                      ? entry.content.slice(0, 160)
                      : "",
                }))
              : [],
          })),
        });
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

      let references = [];
      const delayFailure = (kind, detail) => {
        setTimeout(() => {
          if (!finishFromState(kind)) {
            settle({
              ok: false,
              error: kind,
              detail: `${detail}\nState: ${summarizeStateMessages(
                state.messages,
                references,
              )}`,
              partialText: collectAssistantText(findLatestAssistant(state.messages)),
            });
          }
        }, 100);
      };

      try {
        const uploadTimeoutMs = Math.min(
          Math.max(15_000, Math.floor(timeoutMs / 3)),
          60_000,
        );
        references = await uploadAttachments(runtime, attachments, uploadTimeoutMs);
      } catch (error) {
        settle({
          ok: false,
          error: "invalid_request",
          detail:
            error instanceof Error
              ? error.message
              : `Attachment upload failed: ${stringifyDetail(error)}`,
        });
        return done;
      }

      try {
        const maybePromise = sendMessage({
          messageId: null,
          message: prompt,
          originHTML: "",
          references,
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
        attachments,
      },
    );
  } catch (error) {
    return {
      ok: false,
      error: "send_threw",
      detail: serializeError(error),
    };
  }
}

export async function getTabbitModels() {
  if (modelCache && modelCache.expiresAt > Date.now()) {
    return modelCache.models;
  }

  const bridge = await ensureBridge();
  const page = await ensureChatPage(bridge);
  let payload;
  try {
    payload = await page.evaluate(async (url) => {
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
  } catch (error) {
    rememberBridgeError(error, "getTabbitModels");
    throw error;
  }

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
      ...bridgeDiagnostics(),
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
        ...bridgeDiagnostics(bridge.profile),
      };
    }

    return {
      status: "ok",
      mode: "tabbit-web-bridge",
      runtimeInitialized: true,
      pageReady: true,
      ...bridgeDiagnostics(bridge.profile),
      ...(await readLoginState(page)),
    };
  } catch (error) {
    rememberBridgeError(error, "getBridgeHealth");
    return {
      status: "degraded",
      mode: "tabbit-web-bridge",
      runtimeInitialized: true,
      ...bridgeDiagnostics(),
      error: serializeError(error),
    };
  }
}

export async function sendPromptToTabbit({
  prompt,
  model,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onDelta,
  attachments = [],
}) {
  return runExclusively(async () => {
    const requestedModelAlias = normalizeRequestedModelId(model);
    let bridge;
    let page;
    try {
      bridge = await ensureBridge();
      page = await ensureChatPage(bridge);
    } catch (error) {
      rememberBridgeError(error, "sendPromptToTabbit.ensureBridge");
      throw error;
    }
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

    let materializedAttachments;
    try {
      materializedAttachments = await materializeAttachmentsForUpload(attachments);
    } catch (error) {
      return {
        ok: false,
        error: "invalid_request",
        detail: error instanceof Error ? error.message : String(error),
        requestedModelAlias: routePlan.requestedModelAlias,
        attemptedModels: [],
        fallbackHappened: false,
      };
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
          attachments: materializedAttachments,
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
