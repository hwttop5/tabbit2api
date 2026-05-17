import { pathToFileURL } from "node:url";

import { createGatewayServer } from "./gateway-app.js";
import { installRealtimeServer } from "./openai-realtime.js";

export function startGateway(options = {}) {
  const port = Number(options.port || process.env.PORT || 50124);
  const host = options.host || process.env.HOST || "127.0.0.1";
  const apiKey = options.apiKey || process.env.TABBIT_API_KEY;

  const server = createGatewayServer({ apiKey });
  installRealtimeServer(server, { apiKey });

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
