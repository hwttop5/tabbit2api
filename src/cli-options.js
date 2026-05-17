import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_PATH = path.join(CLI_DIR, "..", "package.json");

export const DEFAULT_PORT = 50124;
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_API_KEY = "sk-tabbit-local";

export const HELP_TEXT = `Tabbit2API

Usage:
  tabbit2api [start] [options]
  tabbit2api login [options]
  tabbit2api probe [options]

Commands:
  start        Start the local gateway (default)
  login        Open Tabbit login window and refresh the runtime profile
  probe        Inspect the Tabbit chat runtime and write probe artifacts

Options:
  --port <port>       Gateway port (default: PORT or 50124)
  --host <host>       Gateway host (default: HOST or 127.0.0.1)
  --api-key <key>     Local gateway API key (default: TABBIT_API_KEY or sk-tabbit-local)
  --refresh           Recreate the runtime profile before login/probe/start
  --keep-open         Keep the probe browser open
  --help, -h          Show this help
  --version, -v       Show package version

Environment:
  TABBIT_LAB_ROOT     Override runtime data directory
  TABBIT_EXECUTABLE   Override Tabbit executable path
  TABBIT_USER_DATA_DIR Override source Tabbit user data directory
`;

export function readPackageVersion() {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8"));
  return pkg.version;
}

function takeValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid --port value '${value}'.`);
  }

  return port;
}

export function parseCliArgs(args, env = process.env) {
  const parsed = {
    apiKey: env.TABBIT_API_KEY || DEFAULT_API_KEY,
    command: "start",
    help: false,
    host: env.HOST || DEFAULT_HOST,
    keepOpen: false,
    port: parsePort(env.PORT || String(DEFAULT_PORT)),
    refresh: false,
    version: false,
  };

  const rest = [...args];
  if (rest[0] && !rest[0].startsWith("-")) {
    parsed.command = rest.shift();
  }

  if (!["start", "login", "probe"].includes(parsed.command)) {
    throw new Error(`Unknown command '${parsed.command}'.`);
  }

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      parsed.version = true;
      continue;
    }

    if (arg === "--refresh") {
      parsed.refresh = true;
      continue;
    }

    if (arg === "--keep-open") {
      parsed.keepOpen = true;
      continue;
    }

    if (arg === "--port") {
      parsed.port = parsePort(takeValue(rest, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith("--port=")) {
      parsed.port = parsePort(arg.slice("--port=".length));
      continue;
    }

    if (arg === "--host") {
      parsed.host = takeValue(rest, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--host=")) {
      parsed.host = arg.slice("--host=".length);
      if (!parsed.host) {
        throw new Error("--host requires a value.");
      }
      continue;
    }

    if (arg === "--api-key") {
      parsed.apiKey = takeValue(rest, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--api-key=")) {
      parsed.apiKey = arg.slice("--api-key=".length);
      if (!parsed.apiKey) {
        throw new Error("--api-key requires a value.");
      }
      continue;
    }

    throw new Error(`Unknown option '${arg}'.`);
  }

  return parsed;
}
