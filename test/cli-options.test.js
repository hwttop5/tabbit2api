import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_API_KEY,
  DEFAULT_HOST,
  DEFAULT_PORT,
  parseCliArgs,
  readPackageVersion,
} from "../src/cli-options.js";
import {
  defaultAppDataRoot,
  defaultTabbitExecutable,
  defaultTabbitUserDataDir,
} from "../src/config.js";
import { runStart } from "../src/cli.js";

test("CLI defaults to start command and documented gateway options", () => {
  assert.deepEqual(parseCliArgs([], {}), {
    apiKey: DEFAULT_API_KEY,
    command: "start",
    help: false,
    host: DEFAULT_HOST,
    keepOpen: false,
    port: DEFAULT_PORT,
    refresh: false,
    version: false,
  });
});

test("CLI supports explicit start command and option values", () => {
  const parsed = parseCliArgs(
    [
      "start",
      "--port",
      "51234",
      "--host=0.0.0.0",
      "--api-key",
      "local-test-key",
      "--refresh",
    ],
    {},
  );

  assert.equal(parsed.command, "start");
  assert.equal(parsed.port, 51234);
  assert.equal(parsed.host, "0.0.0.0");
  assert.equal(parsed.apiKey, "local-test-key");
  assert.equal(parsed.refresh, true);
});

test("CLI supports login and probe subcommands", () => {
  const login = parseCliArgs(["login", "--refresh"], {});
  assert.equal(login.command, "login");
  assert.equal(login.refresh, true);

  const probe = parseCliArgs(["probe", "--keep-open"], {});
  assert.equal(probe.command, "probe");
  assert.equal(probe.keepOpen, true);
});

test("CLI environment values are defaults and flags override them", () => {
  const parsed = parseCliArgs(["--port=50125", "--api-key=flag-key"], {
    HOST: "0.0.0.0",
    PORT: "50124",
    TABBIT_API_KEY: "env-key",
  });

  assert.equal(parsed.host, "0.0.0.0");
  assert.equal(parsed.port, 50125);
  assert.equal(parsed.apiKey, "flag-key");
});

test("CLI detects help and version", () => {
  assert.equal(parseCliArgs(["--help"], {}).help, true);
  assert.equal(parseCliArgs(["--version"], {}).version, true);
  assert.match(readPackageVersion(), /^\d+\.\d+\.\d+/);
});

test("CLI rejects unknown commands, unknown options, and invalid ports", () => {
  assert.throws(() => parseCliArgs(["serve"], {}), /Unknown command/);
  assert.throws(() => parseCliArgs(["--bogus"], {}), /Unknown option/);
  assert.throws(() => parseCliArgs(["--port", "0"], {}), /Invalid --port/);
  assert.throws(() => parseCliArgs(["--host"], {}), /requires a value/);
});

test("platform defaults resolve Windows Tabbit and runtime paths", () => {
  const homeDir = "C:\\Users\\tester";
  const env = { LOCALAPPDATA: "D:\\LocalAppData" };

  assert.equal(
    defaultTabbitExecutable({ platform: "win32", homeDir }),
    "C:\\Users\\tester\\AppData\\Local\\Tabbit\\Application\\Tabbit.exe",
  );
  assert.equal(
    defaultTabbitUserDataDir({ platform: "win32", homeDir, env }),
    "C:\\Users\\tester\\AppData\\Local\\Tabbit\\User Data",
  );
  assert.equal(
    defaultAppDataRoot({ platform: "win32", homeDir, env }),
    "D:\\LocalAppData\\tabbit2api",
  );
});

test("platform defaults resolve macOS Tabbit and runtime paths", () => {
  const homeDir = "/Users/tester";

  assert.equal(
    defaultTabbitExecutable({ platform: "darwin", homeDir }),
    "/Applications/Tabbit.app/Contents/MacOS/Tabbit",
  );
  assert.equal(
    defaultTabbitUserDataDir({ platform: "darwin", homeDir }),
    "/Users/tester/Library/Application Support/Tabbit/User Data",
  );
  assert.equal(
    defaultAppDataRoot({ platform: "darwin", homeDir }),
    "/Users/tester/Library/Application Support/tabbit2api",
  );
});

test("platform defaults keep Linux as manual fallback", () => {
  const homeDir = "/home/tester";

  assert.equal(defaultTabbitExecutable({ platform: "linux", homeDir }), "tabbit");
  assert.equal(
    defaultTabbitUserDataDir({
      platform: "linux",
      homeDir,
      env: { XDG_CONFIG_HOME: "/tmp/xdg-config" },
    }),
    "/tmp/xdg-config/Tabbit/User Data",
  );
  assert.equal(
    defaultAppDataRoot({
      platform: "linux",
      homeDir,
      env: { XDG_DATA_HOME: "/tmp/xdg-data" },
    }),
    "/tmp/xdg-data/tabbit2api",
  );
});

test("start waits for login before launching when runtime profile is missing", async () => {
  const calls = [];
  const originalLog = console.log;
  console.log = () => {};

  try {
    await runStart(
      {
        apiKey: "test-key",
        host: "127.0.0.1",
        port: 50124,
        refresh: false,
      },
      {
        hasLabProfile: async (labProfileDir) => {
          calls.push(["hasLabProfile", labProfileDir]);
          return false;
        },
        labProfileDir: "/tmp/tabbit-profile",
        runLogin: async (options) => {
          calls.push(["runLogin", options]);
        },
        startGateway: (options) => {
          calls.push(["startGateway", options]);
        },
      },
    );
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(calls, [
    ["hasLabProfile", "/tmp/tabbit-profile"],
    ["runLogin", { refresh: false, waitForLogin: true }],
    ["startGateway", { apiKey: "test-key", host: "127.0.0.1", port: 50124 }],
  ]);
});

test("start launches directly when runtime profile already exists", async () => {
  const calls = [];

  await runStart(
    {
      apiKey: "test-key",
      host: "127.0.0.1",
      port: 50124,
      refresh: false,
    },
    {
      hasLabProfile: async () => true,
      runLogin: async () => {
        calls.push(["runLogin"]);
      },
      startGateway: (options) => {
        calls.push(["startGateway", options]);
      },
    },
  );

  assert.deepEqual(calls, [
    ["startGateway", { apiKey: "test-key", host: "127.0.0.1", port: 50124 }],
  ]);
});
