import assert from "node:assert/strict";
import test from "node:test";
import { imageProbe } from "../scripts/docker-image-live.mjs";

function fixture({ transport = "tool-transport", output = "DOCKER_OK", auditId = "image-fixture", status = 200 } = {}) {
  const calls = [];
  const body = { router_anti_truncation: { restored: true }, choices: [{ finish_reason: "stop", message: { content: output } }] };
  const event = { event: "request_complete", requestId: auditId, status: 200, stream: false,
    imageInput: { mode: "all", reason: "encoded", pages: 1, bytes: 100 },
    antiTruncation: { transport: "tool-transport", restored: true, finishReason: "stop" },
    responseIntegrity: { outcome: "complete", hasContent: true }, geminiCompatibility: { promptRetried: false } };
  return { calls, request: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/admin/events")) return Response.json({ events: [event] });
    assert.equal(options.method, "POST");
    const payload = JSON.parse(options.body);
    assert.equal(payload.max_tokens, 512);
    assert.equal(payload.stream, false);
    return Response.json(body, { status, headers: {
      "x-request-id": "image-fixture", "x-image-input": "encoded",
      "x-anti-truncation-transport": transport, "x-gemini-prompt-retried": "false",
    } });
  } };
}

test("image live probe accepts a non-stream image reply and matches its audit", async () => {
  const mock = fixture();
  const result = await imageProbe(mock.request);
  assert.equal(result.passed, true, result.error);
  assert.equal(result.output, "DOCKER_OK");
  assert.equal(mock.calls.filter(call => call.options.method === "POST").length, 1);
});

for (const [name, options] of [
  ["streaming-only transport label", { transport: "tool-transport-buffered-fields" }],
  ["extra reply text", { output: "DOCKER_OK with unwanted explanation" }],
  ["unrelated audit event", { auditId: "another-request" }],
  ["failed response", { status: 502 }],
]) test(`image live probe preserves the body and never retries on ${name}`, async () => {
  const mock = fixture(options);
  const result = await imageProbe(mock.request);
  assert.equal(result.passed, false);
  assert.equal(JSON.parse(result.rawBody).choices[0].message.content, options.output || "DOCKER_OK");
  assert.equal(mock.calls.filter(call => call.options.method === "POST").length, 1);
});
