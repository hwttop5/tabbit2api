import { createGatewayServer } from "./gateway-app.js";
import { installRealtimeServer } from "./openai-realtime.js";

const PORT = Number(process.env.PORT || 50124);

const server = createGatewayServer();
installRealtimeServer(server);

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Tabbit2API gateway listening on http://127.0.0.1:${PORT}`);
});
