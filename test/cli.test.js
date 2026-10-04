import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { isDirectInvocation } from "../src/cli.js";

test("isDirectInvocation returns false without an argv path", () => {
  assert.equal(isDirectInvocation(undefined), false);
  assert.equal(isDirectInvocation(""), false);
});

test("isDirectInvocation returns true when executed through a symlink (npm bin)", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabbit2api-cli-"));
  const target = path.join(tempDir, "cli.js");
  const link = path.join(tempDir, "tabbit2api");

  fs.writeFileSync(target, "// noop\n", "utf8");
  fs.symlinkSync(target, link);

  try {
    // Simulate `node node_modules/.bin/tabbit2api`: argv[1] is the symlink path,
    // while import.meta.url (moduleUrl) resolves to the real target.
    assert.equal(
      isDirectInvocation(link, pathToFileURL(fs.realpathSync(target)).href),
      true,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("isDirectInvocation returns false when required as a module", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabbit2api-cli-"));
  const modulePath = path.join(tempDir, "cli.js");
  fs.writeFileSync(modulePath, "// noop\n", "utf8");

  try {
    // argv[1] points at some other entry (e.g. the test runner), not this module.
    assert.equal(
      isDirectInvocation(
        path.join(tempDir, "other.js"),
        pathToFileURL(modulePath).href,
      ),
      false,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
