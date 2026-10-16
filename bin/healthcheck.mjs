// Liveness only: a fresh console is healthy before any credentials are entered.
// This endpoint never contacts Google or sends an inference request.
import http from "node:http";
const request = http.get({ host: "127.0.0.1", port: Number(process.env.GUI_PORT || 4780), path: "/api/session", timeout: 3000 }, response => {
  response.resume();
  process.exitCode = response.statusCode === 200 ? 0 : 1;
});
request.on("timeout", () => request.destroy());
request.on("error", () => { process.exitCode = 1; });
