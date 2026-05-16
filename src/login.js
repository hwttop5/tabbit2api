import {
  LAB_PROFILE_DIR,
  TABBIT_CHAT_URL,
  TABBIT_USER_DATA_DIR,
} from "./config.js";
import { prepareLabProfile } from "./profile.js";
import { launchTabbitSession, openPage } from "./tabbit-session.js";

async function main() {
  const forceRefresh = process.argv.includes("--refresh");
  const profile = await prepareLabProfile({
    sourceUserDataDir: TABBIT_USER_DATA_DIR,
    labProfileDir: LAB_PROFILE_DIR,
    forceRefresh,
  });

  const context = await launchTabbitSession(profile.labProfileDir, {
    headless: false,
  });

  await openPage(context, TABBIT_CHAT_URL);

  console.log("Tabbit2API login browser window is ready.");
  console.log("Sign in there once, then press Ctrl+C here to close it.");
  console.log(`Runtime profile: ${profile.labProfileDir}`);

  const shutdown = async () => {
    try {
      await context.close();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.resume();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
