import {
  LAB_PROFILE_DIR,
  TABBIT_CHAT_URL,
  TABBIT_USER_DATA_DIR,
} from "./config.js";
import { prepareLabProfile } from "./profile.js";
import {
  launchTabbitSession,
  openPage,
  saveProbeArtifacts,
} from "./tabbit-session.js";

async function inspectChatPage(page) {
  return page.evaluate(async () => {
    const tabSignin = globalThis.chrome?.tabSignin;
    const tabChatExt = globalThis.chrome?.tabChatExt;

    return {
      url: location.href,
      title: document.title,
      loginState:
        tabSignin && typeof tabSignin.getLoginState === "function"
          ? await tabSignin.getLoginState()
          : null,
      userInfo:
        tabSignin && typeof tabSignin.getUserInfo === "function"
          ? await tabSignin.getUserInfo()
          : null,
      glicStatus:
        tabChatExt && typeof tabChatExt.getGlicStatus === "function"
          ? await tabChatExt.getGlicStatus()
          : null,
      bodyText: document.body.innerText.slice(0, 600),
      customApis: Object.keys(globalThis.chrome || {}).filter((key) =>
        key.startsWith("tab"),
      ),
    };
  });
}

async function main() {
  const forceRefresh = process.argv.includes("--refresh");
  const profile = await prepareLabProfile({
    sourceUserDataDir: TABBIT_USER_DATA_DIR,
    labProfileDir: LAB_PROFILE_DIR,
    forceRefresh,
  });

  const context = await launchTabbitSession(profile.labProfileDir);
  try {
    const page = await openPage(context, TABBIT_CHAT_URL);
    await page.waitForTimeout(3_000);

    const artifacts = await saveProbeArtifacts(page, "tabbit-web-chat");
    const inspection = await inspectChatPage(page);

    console.log(
      JSON.stringify(
        {
          ok: true,
          ...inspection,
          artifacts,
        },
        null,
        2,
      ),
    );
  } finally {
    if (!process.argv.includes("--keep-open")) {
      await context.close();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
