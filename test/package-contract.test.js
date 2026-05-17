import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("package metadata exposes the npm CLI and publish whitelist", async () => {
  const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));

  assert.equal(pkg.name, "tabbit2api");
  assert.equal(pkg.bin.tabbit2api, "./src/cli.js");
  assert.equal(
    (await fs.readFile("src/cli.js", "utf8")).startsWith("#!/usr/bin/env node"),
    true,
  );
  assert.deepEqual(pkg.files, [
    "src/",
    "README.md",
    "LICENSE",
    "CONTRIBUTING.md",
    "examples/",
  ]);
  assert.equal("prepare" in pkg.scripts, false);
  assert.equal(pkg.scripts["hooks:install"], "husky");

  const exampleFiles = [
    "examples/README.md",
    "examples/codex/config.toml.example",
    "examples/claude-code/env.powershell.example",
    "examples/claude-code/env.sh.example",
    "examples/openclaw/env.powershell.example",
    "examples/openclaw/env.sh.example",
    "examples/hermes/config.yaml.example",
  ];

  for (const file of exampleFiles) {
    await fs.access(file);
  }
});
