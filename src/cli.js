#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import {
  HELP_TEXT,
  parseCliArgs,
  readPackageVersion,
} from "./cli-options.js";
import { LAB_PROFILE_DIR } from "./config.js";
import { runDoctor } from "./doctor.js";
import { startGateway } from "./gateway.js";
import { runLogin } from "./login.js";
import { hasLabProfile } from "./profile.js";
import { runProbe } from "./probe.js";

export async function runStart(options, deps = {}) {
  const labProfileDir = deps.labProfileDir || LAB_PROFILE_DIR;
  const hasRuntimeProfile = deps.hasLabProfile || hasLabProfile;
  const login = deps.runLogin || runLogin;
  const start = deps.startGateway || startGateway;

  if (options.refresh || !(await hasRuntimeProfile(labProfileDir))) {
    console.log(`Tabbit2API did not find a runtime profile at ${labProfileDir}.`);
    console.log("A Tabbit login window will open now, and startup will wait for sign-in.");
    await login({
      refresh: options.refresh,
      waitForLogin: true,
    });
    console.log(`Runtime profile is ready at ${labProfileDir}.`);
    console.log(`After startup, verify with http://${options.host}:${options.port}/health or run \`tabbit2api doctor\`.`);
  }

  start({
    apiKey: options.apiKey,
    host: options.host,
    port: options.port,
  });
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseCliArgs(argv, env);

  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }

  if (options.version) {
    console.log(readPackageVersion());
    return;
  }

  if (options.command === "doctor") {
    await runDoctor(options, env);
    return;
  }

  if (options.command === "login") {
    await runLogin({ refresh: options.refresh });
    return;
  }

  if (options.command === "probe") {
    await runProbe({
      keepOpen: options.keepOpen,
      refresh: options.refresh,
    });
    return;
  }

  await runStart(options);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
