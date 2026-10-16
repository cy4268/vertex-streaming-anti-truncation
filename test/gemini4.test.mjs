import test from "node:test";
import assert from "node:assert/strict";
import { isGemini4Argon, prepareGemini4Request, validateGemini4Output, encodeGemini4ToolId, gemini4ToolMetadata } from "../src/gemini4.mjs";
import { convertGeminiPrefill } from "../src/gemini-compat.mjs";

const model = "google/gemini-4-argon";
test("Gemini 4 thinking uses levels, preserves explicit config and caller data", () => {
  for (const [effort, level] of [["low", "LOW"], ["medium", "MEDIUM"], ["high", "HIGH"], ["minimal", "LOW"], ["none", "LOW"], ["max", "HIGH"]]) {
    const input = { reasoning_effort: effort, max_tokens: 123, messages: [{ role: "user", content: "fixture" }] };
    const original = structuredClone(input);
    const result = prepareGemini4Request(input, model);
    assert.deepEqual(result.extra_body.google.thinking_config, { thinking_level: level });
    assert.equal(result.reasoning_effort, undefined);
    assert.equal(result.max_tokens, 123);
    assert.deepEqual(input, original);
  }
  const explicit = { reasoning_effort: "high", extra_body: { google: { thinking_config: { thinkingLevel: "low", include_thoughts: true } } } };
  assert.deepEqual(prepareGemini4Request(explicit, model).extra_body.google.thinking_config, { thinking_level: "LOW", include_thoughts: true });
  const defaultRequest = { messages: [] };
  assert.strictEqual(prepareGemini4Request(defaultRequest, model), defaultRequest);
  assert.deepEqual(prepareGemini4Request({ reasoning_effort: "auto" }, model), {});
  assert.strictEqual(prepareGemini4Request(explicit, "gemini-3.8-flash"), explicit);
  assert.ok(isGemini4Argon("google/gemini-4-argon@001"));
  assert.equal(isGemini4Argon("gemini-4-argon-invented"), false);
});

test("Gemini 4 rejects numeric budgets, explicit cache and unsupported long decode locally", () => {
  for (const field of ["thinking_budget", "thinkingBudget"]) {
    assert.throws(() => prepareGemini4Request({ extra_body: { google: { thinking_config: { [field]: 1024 } } } }, model), { status: 400, code: "unsupported_gemini4_thinking_budget" });
  }
  assert.throws(() => prepareGemini4Request({ extra_body: { google: { cached_content: "fixture-cache" } } }, model), { status: 400, code: "unsupported_gemini4_cached_content" });
  assert.throws(() => prepareGemini4Request({ reasoning_effort: "invalid" }, model), { status: 400, code: "invalid_gemini4_thinking_level" });
  for (const stream of [false, true]) {
    const limit = stream ? 65536 : 32768;
    assert.doesNotThrow(() => validateGemini4Output({ max_tokens: limit }, model, stream));
    assert.throws(() => validateGemini4Output({ max_completion_tokens: limit + 1 }, model, stream), { status: 400, code: "gemini4_long_decode_required" });
  }
});

test("Gemini 4 text prefills follow the opt-in conversion and preserve tool history", () => {
  const payload = { messages: [{ role: "user", content: "Continue" }, { role: "assistant", content: "Prefix" }] };
  assert.equal(convertGeminiPrefill(payload, model, true).payload.messages.at(-1).role, "user");
  assert.strictEqual(convertGeminiPrefill(payload, model, false).payload, payload);
  const tools = { messages: [{ role: "assistant", content: "", tool_calls: [{ id: "fixture" }] }] };
  assert.strictEqual(convertGeminiPrefill(tools, model, true).payload, tools);
});

test("Gemini 4 opaque tool IDs retain call identity and signature", () => {
  const id = encodeGemini4ToolId({ functionCall: { id: "function-42" }, thoughtSignature: "fixture-signature" });
  assert.deepEqual(gemini4ToolMetadata(id), { id: "function-42", signature: "fixture-signature" });
  assert.equal(gemini4ToolMetadata("vtx.old-signature").id, gemini4ToolMetadata("vtx.old-signature").id);
  assert.throws(() => gemini4ToolMetadata("vtx4.invalid"), { code: "invalid_tool_history" });
});
