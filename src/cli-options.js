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
  tabbit2api doctor [options]
  tabbit2api login [options]
  tabbit2api probe [options]

Commands:
  start        Start the local gateway (default)
  doctor       Check local runtime paths and gateway health
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

Examples:
  npx tabbit2api
  tabbit2api doctor
  tabbit2api start --port 50125

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
  const hostFromEnv = env.HOST || DEFAULT_HOST;
  const portFromEnv = env.PORT || String(DEFAULT_PORT);
  const apiKeyFromEnv = env.TABBIT_API_KEY || DEFAULT_API_KEY;

  const parsed = {
    apiKey: apiKeyFromEnv,
    command: "start",
    help: false,
    host: hostFromEnv,
    keepOpen: false,
    optionSources: {
      apiKey:
        env.TABBIT_API_KEY ? "env:TABBIT_API_KEY" : `default:${DEFAULT_API_KEY}`,
      host: env.HOST ? "env:HOST" : `default:${DEFAULT_HOST}`,
      port: env.PORT ? "env:PORT" : `default:${DEFAULT_PORT}`,
    },
    port: parsePort(portFromEnv),
    refresh: false,
    version: false,
  };

  const rest = [...args];
  if (rest[0] && !rest[0].startsWith("-")) {
    parsed.command = rest.shift();
  }

  if (!["start", "doctor", "login", "probe"].includes(parsed.command)) {
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
      parsed.optionSources.port = "flag:--port";
      index += 1;
      continue;
    }

    if (arg.startsWith("--port=")) {
      parsed.port = parsePort(arg.slice("--port=".length));
      parsed.optionSources.port = "flag:--port";
      continue;
    }

    if (arg === "--host") {
      parsed.host = takeValue(rest, index, arg);
      parsed.optionSources.host = "flag:--host";
      index += 1;
      continue;
    }

    if (arg.startsWith("--host=")) {
      parsed.host = arg.slice("--host=".length);
      if (!parsed.host) {
        throw new Error("--host requires a value.");
      }
      parsed.optionSources.host = "flag:--host";
      continue;
    }

    if (arg === "--api-key") {
      parsed.apiKey = takeValue(rest, index, arg);
      parsed.optionSources.apiKey = "flag:--api-key";
      index += 1;
      continue;
    }

    if (arg.startsWith("--api-key=")) {
      parsed.apiKey = arg.slice("--api-key=".length);
      if (!parsed.apiKey) {
        throw new Error("--api-key requires a value.");
      }
      parsed.optionSources.apiKey = "flag:--api-key";
      continue;
    }

    throw new Error(`Unknown option '${arg}'.`);
  }

  return parsed;
}
