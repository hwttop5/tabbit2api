import os from "node:os";
import path from "node:path";

export const TABBIT_EXECUTABLE =
  process.env.TABBIT_EXECUTABLE ||
  path.join(
    os.homedir(),
    "AppData",
    "Local",
    "Tabbit",
    "Application",
    "Tabbit.exe",
  );

export const TABBIT_USER_DATA_DIR =
  process.env.TABBIT_USER_DATA_DIR ||
  path.join(os.homedir(), "AppData", "Local", "Tabbit", "User Data");

export const LAB_ROOT =
  process.env.TABBIT_LAB_ROOT || path.join(process.cwd(), ".lab");

export const LAB_PROFILE_DIR = path.join(LAB_ROOT, "tabbit-user-data");
export const OPENAI_ASSISTANTS_STATE_PATH =
  process.env.TABBIT_ASSISTANTS_STATE_PATH ||
  path.join(LAB_ROOT, "openai-assistants-state.json");
export const OUTPUT_DIR = path.join(process.cwd(), "output", "playwright");
export const TABBIT_CHAT_URL = "https://web.tabbitbrowser.com/chat/new";
export const TABBIT_MODELS_URL =
  "https://web.tabbitbrowser.com/proxy/v1/model_config/models?a=0";

export const MAXAI_EXTENSION_ID = "mhnlakgilnojmhinhkckjpncpbhabphi";
export const CHATGPTBOX_EXTENSION_ID = "eobbhoofkanlmddnplfhnmkfbnlhpbbo";

export const MAXAI_POPUP_URL = `chrome-extension://${MAXAI_EXTENSION_ID}/pages/popup/index.html`;
export const CHATGPTBOX_PANEL_URL = `chrome-extension://${CHATGPTBOX_EXTENSION_ID}/IndependentPanel.html`;
