import test from "node:test";
import assert from "node:assert/strict";
import { loadNetworkConfig, consoleRequestAccess } from "../src/network-config.mjs";

test("deployment config keeps native installs local and rejects ambiguous public URLs", () => {
  assert.deepEqual(loadNetworkConfig({}), { listenHost: "127.0.0.1", guiOrigin: null, gatewayPublicUrl: null });
  assert.deepEqual(loadNetworkConfig({ LISTEN_HOST: "0.0.0.0", GUI_ORIGIN: "https://console.example/", GATEWAY_PUBLIC_URL: "https://api.example/v1/" }),
    { listenHost: "0.0.0.0", guiOrigin: "https://console.example", gatewayPublicUrl: "https://api.example/v1" });
  for (const host of ["localhost", "::", "example.com", "192.0.2.1"]) assert.throws(() => loadNetworkConfig({ LISTEN_HOST: host }), /LISTEN_HOST/);
  for (const origin of ["null", "*", "http://*.example", "http://0.0.0.0:4780", "ftp://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?q=1", "https://example.com/#x"]) {
    assert.throws(() => loadNetworkConfig({ GUI_ORIGIN: origin }), /GUI_ORIGIN/);
  }
  assert.throws(() => loadNetworkConfig({ GATEWAY_PUBLIC_URL: "javascript:alert(1)" }), /GATEWAY_PUBLIC_URL/);
});

test("console accepts only exact local or configured origins, ignoring forwarded headers", () => {
  const access = (headers, port = 4780, origin = "https://console.example") => consoleRequestAccess(headers, port, origin);
  assert.equal(access({}, 4780, null).allowed, false);
  assert.equal(access({ host: "localhost:4780", origin: "http://localhost:4780" }).allowed, true);
  assert.equal(access({ host: "localhost", origin: "http://localhost" }, 80).allowed, true);
  assert.equal(access({ host: "localhost:80", origin: "http://localhost" }, 80).allowed, true);
  assert.deepEqual(access({ host: "console.example", origin: "https://console.example" }), { allowed: true, secure: true });
  assert.equal(access({ host: "localhost:8080", origin: "http://localhost:8080" }, 4780, "http://localhost:8080").allowed, true);
  for (const headers of [
    { host: "evil.example", "x-forwarded-host": "console.example" },
    { host: "console.example.evil.test" },
    { host: "console.example", origin: "http://console.example" },
    { host: "console.example", origin: "null" },
    { host: "localhost:4780", origin: "https://console.example" },
    { host: "console.example", origin: "https://console.example", "sec-fetch-site": "cross-site" },
    { host: "localhost:8080" },
  ]) assert.equal(access(headers).allowed, false, JSON.stringify(headers));
});
