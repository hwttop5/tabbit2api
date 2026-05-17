const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const ALLOWED_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  "txt",
  "md",
  "json",
  "js",
  "ts",
  "tsx",
  "jsx",
  "css",
  "html",
  "xml",
  "csv",
  "pdf",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "epub",
]);

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const MAX_GIF_BYTES = 2 * 1024 * 1024;

const MIME_EXTENSION_MAP = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["text/plain", "txt"],
  ["text/markdown", "md"],
  ["application/json", "json"],
  ["text/json", "json"],
  ["text/javascript", "js"],
  ["application/javascript", "js"],
  ["application/x-javascript", "js"],
  ["text/typescript", "ts"],
  ["application/typescript", "ts"],
  ["text/css", "css"],
  ["text/html", "html"],
  ["application/xhtml+xml", "html"],
  ["application/xml", "xml"],
  ["text/xml", "xml"],
  ["text/csv", "csv"],
  ["application/pdf", "pdf"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "docx",
  ],
  ["application/vnd.ms-powerpoint", "ppt"],
  [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "pptx",
  ],
  ["application/vnd.ms-excel", "xls"],
  [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xlsx",
  ],
  ["application/epub+zip", "epub"],
]);

const EXTENSION_MIME_MAP = new Map(
  [...MIME_EXTENSION_MAP.entries()].map(([mimeType, extension]) => [
    extension,
    mimeType,
  ]),
);

export class AttachmentValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AttachmentValidationError";
    this.code = "invalid_request_error";
    this.statusCode = 400;
  }
}

export function isAttachmentValidationError(error) {
  return (
    error instanceof AttachmentValidationError ||
    error?.name === "AttachmentValidationError"
  );
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMimeType(value) {
  const text = cleanText(value).toLowerCase();
  return text ? text.split(";")[0].trim() : "";
}

function extensionFromMimeType(mimeType) {
  return MIME_EXTENSION_MAP.get(normalizeMimeType(mimeType)) || "";
}

function mimeTypeFromExtension(extension) {
  return EXTENSION_MIME_MAP.get(cleanText(extension).toLowerCase()) || "";
}

function basenameFromUrl(value) {
  try {
    const parsed = new URL(value);
    const name = parsed.pathname.split("/").filter(Boolean).at(-1) || "";
    return decodeURIComponent(name).trim();
  } catch {
    return "";
  }
}

function extensionFromFilename(filename) {
  const match = cleanText(filename).match(/\.([^.\\/]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function safeFilename(value, fallback) {
  const name = cleanText(value).replace(/[\\/:"*?<>|]+/g, "_");
  return name || fallback;
}

function ensureFilenameExtension(filename, extension) {
  const name = cleanText(filename);
  if (!name) {
    return `attachment.${extension}`;
  }

  return extensionFromFilename(name) ? name : `${name}.${extension}`;
}

function ensureAllowedExtension(extension, filename) {
  if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
    throw new AttachmentValidationError(
      `Unsupported attachment type '${
        extension || "unknown"
      }' for '${filename || "attachment"}'.`,
    );
  }
}

function isLocalPath(value) {
  const text = cleanText(value);
  return Boolean(
    /^file:/i.test(text) ||
      /^[a-zA-Z]:[\\/]/.test(text) ||
      /^\\\\/.test(text) ||
      /^\/(?!\/)/.test(text),
  );
}

function parseDataUrl(value) {
  const text = cleanText(value);
  const match = text.match(/^data:([^,]*),(.*)$/s);
  if (!match) {
    throw new AttachmentValidationError("Attachment data URL is malformed.");
  }

  const meta = match[1] || "";
  const parts = meta.split(";").filter(Boolean);
  const isBase64 = parts.some((part) => part.toLowerCase() === "base64");
  const mimeType = normalizeMimeType(parts.find((part) => part.includes("/")) || "");
  const data = match[2] || "";
  let buffer;

  if (isBase64) {
    const compact = data.replace(/\s/g, "");
    if (!compact || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
      throw new AttachmentValidationError("Attachment data URL has no content.");
    }
    buffer = Buffer.from(compact, "base64");
  } else {
    buffer = Buffer.from(decodeURIComponent(data), "utf8");
  }

  if (buffer.byteLength === 0) {
    throw new AttachmentValidationError("Attachment data URL has no content.");
  }

  return {
    mimeType,
    bytes: buffer.toString("base64"),
    sizeBytes: buffer.byteLength,
  };
}

function validateAttachmentSize(attachment) {
  if (!Number.isFinite(attachment.sizeBytes)) {
    return;
  }

  if (attachment.sizeBytes > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentValidationError(
      `Attachment '${attachment.filename}' exceeds the 20 MiB per-file limit.`,
    );
  }

  if (extensionFromFilename(attachment.filename) === "gif") {
    if (attachment.sizeBytes > MAX_GIF_BYTES) {
      throw new AttachmentValidationError(
        `GIF attachment '${attachment.filename}' exceeds the 2 MiB GIF limit.`,
      );
    }
  }
}

function attachmentKind(preferredKind, extension, mimeType) {
  if (preferredKind === "image") {
    return "image";
  }

  if (IMAGE_EXTENSIONS.has(extension) || normalizeMimeType(mimeType).startsWith("image/")) {
    return "image";
  }

  return "document";
}

function ensureCompatibleKind(preferredKind, extension, filename) {
  if (preferredKind !== "image") {
    return;
  }

  if (!IMAGE_EXTENSIONS.has(extension)) {
    throw new AttachmentValidationError(
      `Image attachment '${filename || "attachment"}' must use png, jpg, jpeg, webp, or gif.`,
    );
  }
}

function normalizeSourceUrl(value) {
  const text = cleanText(value);
  if (!text) {
    throw new AttachmentValidationError("Attachment URL is empty.");
  }

  if (isLocalPath(text)) {
    throw new AttachmentValidationError(
      "Local file paths are not supported for attachments; use data:, http:, or https: URLs.",
    );
  }

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new AttachmentValidationError(
      "Attachment source must be a data:, http:, or https: URL.",
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AttachmentValidationError(
      "Attachment source must be a data:, http:, or https: URL.",
    );
  }

  return parsed.toString();
}

function rejectFileId(value) {
  if (value && typeof value === "object" && cleanText(value.file_id)) {
    throw new AttachmentValidationError(
      "OpenAI file_id attachments are not supported by this local gateway; send file_data or file_url instead.",
    );
  }
}

export function normalizeAttachmentCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  rejectFileId(candidate);

  const preferredKind = candidate.kind === "image" ? "image" : "document";
  const filenameHint = cleanText(candidate.filename || candidate.name || candidate.title);
  let mimeType = normalizeMimeType(candidate.mimeType || candidate.media_type);
  let extension = extensionFromFilename(filenameHint) || extensionFromMimeType(mimeType);
  let filename = filenameHint;

  if (candidate.source === "data") {
    const parsed = parseDataUrl(candidate.data);
    mimeType = normalizeMimeType(mimeType || parsed.mimeType);
    extension = extensionFromFilename(filename) || extensionFromMimeType(mimeType);
    ensureAllowedExtension(extension, filename);
    ensureCompatibleKind(preferredKind, extension, filename);
    filename = ensureFilenameExtension(
      safeFilename(filename, preferredKind === "image" ? "image" : "attachment"),
      extension,
    );

    const attachment = {
      kind: attachmentKind(preferredKind, extension, mimeType),
      filename,
      mimeType: mimeType || mimeTypeFromExtension(extension),
      source: "data",
      bytes: parsed.bytes,
      sizeBytes: parsed.sizeBytes,
    };
    validateAttachmentSize(attachment);
    return attachment;
  }

  if (candidate.source === "url") {
    const url = normalizeSourceUrl(candidate.url);
    const urlFilename = basenameFromUrl(url);
    filename = safeFilename(filename, urlFilename);
    extension =
      extensionFromFilename(filename) ||
      extensionFromFilename(urlFilename) ||
      extensionFromMimeType(mimeType);
    ensureAllowedExtension(extension, filename);
    ensureCompatibleKind(preferredKind, extension, filename);
    filename = ensureFilenameExtension(filename, extension);

    return {
      kind: attachmentKind(preferredKind, extension, mimeType),
      filename,
      mimeType: mimeType || mimeTypeFromExtension(extension),
      source: "url",
      url,
      sourceUrl: url,
    };
  }

  return null;
}

function stringCandidate(value, options) {
  const text = cleanText(value);
  if (!text) {
    return null;
  }

  if (text.startsWith("data:")) {
    return normalizeAttachmentCandidate({
      ...options,
      source: "data",
      data: text,
    });
  }

  return normalizeAttachmentCandidate({
    ...options,
    source: "url",
    url: text,
  });
}

function urlFromImageUrl(value) {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    rejectFileId(value);
    return value.url || value.href || "";
  }

  return "";
}

function valueFromFileBlock(block) {
  rejectFileId(block);

  const nested = block.file || block.document || block.input_file || null;
  rejectFileId(nested);

  const carrier = nested && typeof nested === "object" ? { ...block, ...nested } : block;
  if (carrier.source && typeof carrier.source === "object") {
    rejectFileId(carrier.source);
    if (carrier.source.type === "base64" && cleanText(carrier.source.data)) {
      const mediaType =
        carrier.source.media_type ||
        carrier.media_type ||
        carrier.mimeType ||
        "application/octet-stream";
      return {
        source: "data",
        value: `data:${mediaType};base64,${carrier.source.data}`,
        filename: carrier.filename || carrier.name || carrier.title,
        mimeType: mediaType,
      };
    }

    if (carrier.source.type === "url" && cleanText(carrier.source.url)) {
      return {
        source: "url",
        value: carrier.source.url,
        filename: carrier.filename || carrier.name || carrier.title,
        mimeType: carrier.source.media_type || carrier.media_type || carrier.mimeType,
      };
    }
  }

  const fileData = cleanText(carrier.file_data || carrier.data || carrier.content);
  if (fileData) {
    return {
      source: "data",
      value: fileData,
      filename: carrier.filename || carrier.name || carrier.title,
      mimeType: carrier.mimeType || carrier.mime_type || carrier.media_type,
    };
  }

  const fileUrl =
    typeof carrier.file_url === "object"
      ? carrier.file_url.url || carrier.file_url.href
      : carrier.file_url || carrier.url || carrier.href;
  if (cleanText(fileUrl)) {
    return {
      source: "url",
      value: fileUrl,
      filename: carrier.filename || carrier.name || carrier.title,
      mimeType: carrier.mimeType || carrier.mime_type || carrier.media_type,
    };
  }

  return null;
}

export function normalizeOpenAiAttachmentPart(part) {
  if (!part || typeof part !== "object" || Array.isArray(part)) {
    return null;
  }

  if (part.type === "input_image" || part.type === "image_url") {
    const imageUrl = urlFromImageUrl(part.image_url || part.url || part.source);
    if (!imageUrl) {
      throw new AttachmentValidationError("Image attachment has no image_url.");
    }

    return stringCandidate(imageUrl, {
      kind: "image",
      filename: part.filename || part.name || part.title,
      mimeType: part.mimeType || part.mime_type || part.media_type,
    });
  }

  if (
    part.type === "input_file" ||
    part.type === "file" ||
    part.type === "document"
  ) {
    const value = valueFromFileBlock(part);
    if (!value) {
      throw new AttachmentValidationError(
        "File attachment requires file_data or file_url.",
      );
    }

    return normalizeAttachmentCandidate({
      kind: "document",
      filename: value.filename,
      mimeType: value.mimeType,
      source: value.source,
      data: value.source === "data" ? value.value : undefined,
      url: value.source === "url" ? value.value : undefined,
    });
  }

  return null;
}

export function isOpenAiAttachmentPart(part) {
  return Boolean(
    part &&
      typeof part === "object" &&
      !Array.isArray(part) &&
      (part.type === "input_image" ||
        part.type === "image_url" ||
        part.type === "input_file" ||
        part.type === "file" ||
        part.type === "document"),
  );
}

export function normalizeChatAttachmentPart(part) {
  return normalizeOpenAiAttachmentPart(part);
}

export function normalizeAnthropicAttachmentBlock(block) {
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    return null;
  }

  if (block.type !== "image" && block.type !== "document") {
    return null;
  }

  const source = block.source;
  if (!source || typeof source !== "object") {
    throw new AttachmentValidationError(
      `${block.type} attachment requires a source object.`,
    );
  }

  rejectFileId(source);

  if (source.type === "base64") {
    return normalizeAttachmentCandidate({
      kind: block.type === "image" ? "image" : "document",
      filename: block.filename || block.name || block.title,
      mimeType: source.media_type || block.media_type || block.mimeType,
      source: "data",
      data: `data:${source.media_type || block.media_type || "application/octet-stream"};base64,${source.data || ""}`,
    });
  }

  if (source.type === "url") {
    return normalizeAttachmentCandidate({
      kind: block.type === "image" ? "image" : "document",
      filename: block.filename || block.name || block.title,
      mimeType: source.media_type || block.media_type || block.mimeType,
      source: "url",
      url: source.url,
    });
  }

  throw new AttachmentValidationError(
    `${block.type} attachment source must be base64 or URL.`,
  );
}

function collect(value, normalizer) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collect(entry, normalizer));
  }

  if (typeof value !== "object") {
    return [];
  }

  const attachment = normalizer(value);
  if (attachment) {
    return [attachment];
  }

  const attachments = [];
  if (Array.isArray(value.content)) {
    attachments.push(...collect(value.content, normalizer));
  }

  if (Array.isArray(value.messages)) {
    attachments.push(...collect(value.messages, normalizer));
  }

  return attachments;
}

export function collectOpenAiAttachments(value) {
  return validateAttachmentSet(collect(value, normalizeOpenAiAttachmentPart));
}

export function collectChatAttachments(messages) {
  const attachments = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    attachments.push(...collect(message?.content, normalizeChatAttachmentPart));
  }
  return validateAttachmentSet(attachments);
}

export function collectAnthropicAttachments(messages) {
  const attachments = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    attachments.push(...collect(message?.content, normalizeAnthropicAttachmentBlock));
  }
  return validateAttachmentSet(attachments);
}

export function isAnthropicAttachmentBlock(block) {
  return Boolean(
    block &&
      typeof block === "object" &&
      !Array.isArray(block) &&
      (block.type === "image" || block.type === "document"),
  );
}

export function validateAttachmentSet(attachments) {
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new AttachmentValidationError(
      `Too many attachments: maximum ${MAX_ATTACHMENTS} files are supported.`,
    );
  }

  let totalBytes = 0;
  for (const attachment of attachments) {
    validateAttachmentSize(attachment);
    if (Number.isFinite(attachment.sizeBytes)) {
      totalBytes += attachment.sizeBytes;
    }
  }

  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new AttachmentValidationError(
      "Attachments exceed the 100 MiB total size limit.",
    );
  }

  return attachments;
}

function inferFilenameFromResponse(attachment, response) {
  const disposition = response.headers.get("content-disposition") || "";
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    return safeFilename(decodeURIComponent(utf8Match[1]), attachment.filename);
  }

  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  if (plainMatch) {
    return safeFilename(plainMatch[1], attachment.filename);
  }

  return attachment.filename;
}

async function readResponseBufferWithLimit(response, filename) {
  if (!response.body || typeof response.body.getReader !== "function") {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new AttachmentValidationError(
        `Attachment '${filename}' exceeds the 20 MiB per-file limit.`,
      );
    }
    if (buffer.byteLength === 0) {
      throw new AttachmentValidationError(
        `Attachment '${filename}' could not be downloaded: empty response body.`,
      );
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    const chunk = Buffer.from(value);
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_ATTACHMENT_BYTES) {
      await reader.cancel();
      throw new AttachmentValidationError(
        `Attachment '${filename}' exceeds the 20 MiB per-file limit.`,
      );
    }
    chunks.push(chunk);
  }

  if (totalBytes === 0) {
    throw new AttachmentValidationError(
      `Attachment '${filename}' could not be downloaded: empty response body.`,
    );
  }

  return Buffer.concat(chunks, totalBytes);
}

export async function materializeAttachmentsForUpload(
  attachments,
  { fetchImpl = globalThis.fetch } = {},
) {
  const materialized = [];
  for (const attachment of attachments || []) {
    if (attachment.source === "data") {
      materialized.push(attachment);
      continue;
    }

    if (attachment.source !== "url") {
      throw new AttachmentValidationError(
        `Unsupported attachment source '${attachment.source}'.`,
      );
    }

    if (typeof fetchImpl !== "function") {
      throw new AttachmentValidationError("HTTP attachment download is unavailable.");
    }

    const response = await fetchImpl(attachment.url);
    if (!response?.ok) {
      throw new AttachmentValidationError(
        `Attachment '${attachment.filename}' could not be downloaded: HTTP ${
          response?.status || "error"
        }.`,
      );
    }

    const contentLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_ATTACHMENT_BYTES) {
      throw new AttachmentValidationError(
        `Attachment '${attachment.filename}' exceeds the 20 MiB per-file limit.`,
      );
    }

    const buffer = await readResponseBufferWithLimit(response, attachment.filename);
    const mimeType =
      normalizeMimeType(response.headers?.get?.("content-type")) ||
      attachment.mimeType ||
      mimeTypeFromExtension(extensionFromFilename(attachment.filename));
    const inferredFilename = inferFilenameFromResponse(attachment, response);
    const inferredExtension =
      extensionFromFilename(inferredFilename) ||
      extensionFromMimeType(mimeType) ||
      extensionFromFilename(attachment.filename);
    const filename = inferredExtension
      ? ensureFilenameExtension(inferredFilename, inferredExtension)
      : inferredFilename;
    const extension = extensionFromFilename(filename) || extensionFromMimeType(mimeType);
    ensureAllowedExtension(extension, filename);
    ensureCompatibleKind(attachment.kind, extension, filename);

    const next = {
      ...attachment,
      kind: attachmentKind(attachment.kind, extension, mimeType),
      filename,
      mimeType,
      source: "data",
      originalSource: "url",
      sourceUrl: attachment.url,
      bytes: buffer.toString("base64"),
      sizeBytes: buffer.byteLength,
    };
    validateAttachmentSize(next);
    materialized.push(next);
  }

  return validateAttachmentSet(materialized);
}

export function summarizeAttachmentsForPrompt(attachments) {
  return (attachments || []).map((attachment, index) => ({
    index: index + 1,
    kind: attachment.kind,
    filename: attachment.filename,
    mime_type: attachment.mimeType || null,
    source: attachment.source === "url" ? "url" : attachment.originalSource || "data",
    size_bytes: Number.isFinite(attachment.sizeBytes)
      ? attachment.sizeBytes
      : null,
  }));
}
