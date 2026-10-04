import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { defaultTabbitUserDataDir } from "../src/config.js";

const home = "/Users/tester";
const appSupport = path.posix.join(
  home,
  "Library",
  "Application Support",
  "Tabbit",
);

test("defaultTabbitUserDataDir detects the macOS profile stored directly under the app-support folder", () => {
  const result = defaultTabbitUserDataDir({
    platform: "darwin",
    homeDir: home,
    existsSync: (candidate) =>
      candidate === path.posix.join(appSupport, "Default"),
  });

  assert.equal(result, appSupport);
});

test("defaultTabbitUserDataDir falls back to the legacy macOS User Data layout", () => {
  const result = defaultTabbitUserDataDir({
    platform: "darwin",
    homeDir: home,
    existsSync: () => false,
  });

  assert.equal(result, path.posix.join(appSupport, "User Data"));
});

test("defaultTabbitUserDataDir keeps the Windows path unchanged", () => {
  const result = defaultTabbitUserDataDir({
    platform: "win32",
    homeDir: "C:\\Users\\tester",
  });

  assert.equal(
    result,
    path.win32.join("C:\\Users\\tester", "AppData", "Local", "Tabbit", "User Data"),
  );
});
