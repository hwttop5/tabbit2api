import { pathToFileURL } from "node:url";

import { createGatewayServer } from "./gateway-app.js";
import { installRealtimeServer } from "./openai-realtime.js";
import { runGatewaySession } from "./session-core.js";
import { executeServerToolUse } from "./server-tools.js";
import { sendPromptToTabbit } from "./tabbit-web-bridge.js";

function createDefaultRunGatewaySession() {
  return (normalizedRequest) =>
    runGatewaySession(normalizedRequest, {
      sendPromptToTabbit,
      executeServerToolUse,
    });
}

export function startGateway(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 50124);
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const apiKey = options.apiKey ?? process.env.TABBIT_API_KEY;
  const runSession = options.runGatewaySession || createDefaultRunGatewaySession();

  const server = createGatewayServer({
    apiKey,
    runGatewaySession: runSession,
  });
  installRealtimeServer(server, {
    apiKey,
    runGatewaySession: runSession,
  });

  server.listen(port, host, () => {
    console.log(`Tabbit2API gateway listening on http://${host}:${port}`);
  });

  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startGateway();
}
