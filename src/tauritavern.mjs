import { prepareAntiTruncation, restoreAntiTruncationCompletion, wrapAntiTruncationStream } from "./anti-truncation.mjs";
import { nativeRequestBody } from "./vertex-native.mjs";
import { wrapNativeTextStream } from "./vertex-text-stream.mjs";
import { guardCompletionStream, inspectCompletion } from "./completion-integrity.mjs";
import { aliasStream, completionStream } from "./completion-stream.mjs";
import { validateGemini4Output } from "./gemini4.mjs";
import { completedSillyTavernResponse, toSillyTavernStream } from "./sillytavern.mjs";
import { createSseParser, isObject, protocolError, sseData, transformSse } from "./wire.mjs";
import { BODY_LIMIT, bypassReason } from "../integrations/sillytavern/shared.js";

// TauriTavern replaces SillyTavern's Node server with a Rust backend, so no
// server plugin can run there. The UI extension does the whole job in the
// WebView instead: TauriTavern still converts the prompt, keeps the credentials
// and calls Vertex, while its final body overrides (custom_include_body) carry
// the native tool fields. Its streaming route forwards Google's events
// unchanged, finish codes included, so both transport modes read that route.
// Custom OpenAI Chat Completions keeps TT's compatible transport instead and
// restores OpenAI tool calls directly, without the native Vertex conversion.

// TauriTavern sends the user's own Additional Parameters as YAML/JSON text. Only
// an empty value or a JSON object can be merged here without a YAML parser.
function includedBody(value) {
  if (isObject(value)) return value;
  if (value == null || (typeof value === "string" && !value.trim())) return {};
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : null;
  } catch { return null; }
}

function excludedKeys(value) {
  if (value == null || value === "") return [];
  if (typeof value === "string") {
    if (!value.trim()) return [];
    try { value = JSON.parse(value); }
    catch { return /^[\w.-]+$/.test(value.trim()) ? [value.trim()] : null; }
  }
  if (value == null) return [];
  if (typeof value === "string") return [value.trim()];
  if (isObject(value)) return Object.keys(value).map(key => key.trim());
  return Array.isArray(value) && value.every(key => typeof key === "string") ? value.map(key => key.trim()) : null;
}

function prepareCustomRequest(body, mode, included) {
  const excluded = excludedKeys(body.custom_exclude_body);
  if (!excluded) return { bypass: "additional-parameters" };
  // TT applies include/exclude overrides last. Do not replace the user's prompt,
  // existing tools or transport choices, or inject tools that would be removed.
  if (["messages", "stream"].some(key => Object.hasOwn(included, key)) ||
    excluded.some(key => ["messages", "tools", "tool_choice", "parallel_tool_calls", "stream"].includes(key))) {
    return { bypass: "additional-parameters-conflict" };
  }
  const bypass = bypassReason({ ...body, ...included }, mode, true);
  if (bypass) return { bypass };
  const continuation = body.type === "continue";
  const upstreamStream = mode === "streaming" && body.stream === true;
  const prepared = prepareAntiTruncation({ messages: body.messages }, true, false, { continuation });
  const { tools, tool_choice, parallel_tool_calls } = prepared.payload;
  return {
    body: { ...body, messages: prepared.payload.messages, stream: upstreamStream,
      custom_include_body: JSON.stringify({ ...included, tools, tool_choice, parallel_tool_calls }) },
    custom: true, toolName: prepared.toolName, model: included.model ?? body.model,
    stream: body.stream === true, upstreamStream, continuation,
  };
}

export function prepareTauriTavernRequest(body, mode) {
  const included = includedBody(body.custom_include_body);
  if (!included) return { bypass: "additional-parameters" };
  if (body.chat_completion_source === "custom") return prepareCustomRequest(body, mode, included);
  // The upstream request is always streamGenerateContent here.
  validateGemini4Output(body, body.model, true);
  const continuation = body.type === "continue";
  const upstreamStream = mode === "streaming" && body.stream === true;
  const prepared = prepareAntiTruncation({ messages: body.messages }, true, false, { continuation });
  const native = nativeRequestBody({ ...prepared.payload, messages: [] });
  if (upstreamStream) native.toolConfig.functionCallingConfig.streamFunctionCallArguments = true;
  return {
    body: { ...body, messages: prepared.payload.messages, stream: true,
      custom_include_body: JSON.stringify({ ...included, tools: native.tools, toolConfig: native.toolConfig }) },
    toolName: prepared.toolName, model: body.model, stream: body.stream === true, upstreamStream, continuation,
  };
}

// TauriTavern reports a failed request as assistant text in exactly this chunk:
// {candidates:[{index, content:{parts:[{text}]}}]}, with none of Google's role,
// ids, usage or finishReason. Give it an ending so its text arrives as written
// instead of as an interrupted reply.
const only = (value, ...allowed) => isObject(value) && Object.keys(value).every(key => allowed.includes(key));
function endHostError(response) {
  return transformSse(response, ({ raw, data }, emit) => {
    let parsed;
    try { parsed = JSON.parse(data); } catch { return emit(raw + "\n\n"); }
    const candidate = only(parsed, "candidates") && parsed.candidates?.length === 1 ? parsed.candidates[0] : null;
    const part = only(candidate, "index", "content") && only(candidate.content, "parts") && candidate.content.parts?.length === 1 ? candidate.content.parts[0] : null;
    if (!only(part, "text") || typeof part.text !== "string") return emit(raw + "\n\n");
    emit(sseData({ candidates: [{ ...candidate, finishReason: "STOP" }] }));
  });
}

// TT's custom transport uses a single content-only chunk for host failures.
// Wait for the next data event: only an immediate DONE confirms this shape.
// Never add an ending to this shape after the model has already emitted data.
function endCustomHostError(response) {
  let seen = false, pending = null;
  return transformSse(response, ({ raw, data, event }, emit) => {
    if (!data) return emit(raw + "\n\n");
    const messageEvent = !event || event === "message";
    if (pending) {
      emit(messageEvent && data.trim() === "[DONE]" ? sseData({ choices: [{ ...pending.choice, finish_reason: "stop" }] }) : pending.raw + "\n\n");
      pending = null;
    }
    if (!seen) {
      seen = true;
      let parsed;
      try { parsed = JSON.parse(data); } catch { /* Leave malformed events to the integrity guard. */ }
      const choice = only(parsed, "choices") && Array.isArray(parsed.choices) && parsed.choices.length === 1 ? parsed.choices[0] : null;
      if (messageEvent && only(choice, "index", "delta") && only(choice.delta, "content") && typeof choice.delta.content === "string") {
        pending = { raw, choice };
        return;
      }
    }
    emit(raw + "\n\n");
  }, emit => { if (pending) emit(pending.raw + "\n\n"); });
}

// Reads the restored chunks to their end. The integrity guard in front of this
// has already rejected an incomplete or malformed reply.
async function collectCompletion(response, model) {
  const message = { role: "assistant", content: "" };
  const choice = { index: 0, message, finish_reason: null };
  const completion = { object: "chat.completion", model, choices: [choice] };
  const parser = createSseParser(({ data }) => {
    if (!data || data.trim() === "[DONE]") return;
    const chunk = JSON.parse(data);
    completion.id ??= chunk.id;
    completion.created ??= chunk.created;
    for (const { delta, finish_reason, native_finish_reason } of chunk.choices ?? []) {
      if (delta?.content) message.content += delta.content;
      if (delta?.reasoning_content) message.reasoning_content = (message.reasoning_content ?? "") + delta.reasoning_content;
      if (finish_reason != null) Object.assign(choice, { finish_reason, native_finish_reason });
    }
    if (chunk.usage) completion.usage = chunk.usage;
    if (chunk.router_anti_truncation) completion.router_anti_truncation = chunk.router_anti_truncation;
  });
  // Older WebKit cannot iterate a ReadableStream with for await.
  const reader = response.body.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) parser.push(read.value);
  parser.finish();
  return completion;
}

const failure = code => ({ error: { code, message: `Vertex 抗截断请求失败。 (${code})` } });

// A reply that fails restoration ends with the error event ST's stream reader
// reports, as the server plugin does. A cancelled request just stops.
function reportStreamFailure(body, signal, preserveUpstream = false) {
  const reader = body.getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        if (signal?.aborted) return controller.error(error);
        const detail = preserveUpstream && error.upstreamBody?.error ? error.upstreamBody : failure(error.code ?? "restoration_failed");
        controller.enqueue(new TextEncoder().encode(sseData(detail)));
        controller.close();
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

async function restoreCustomResponse(response, prepared, signal) {
  const headers = prepared.continuation ? { "x-vertex-continuation": "suffix" } : {};
  if (prepared.upstreamStream) {
    const restored = guardCompletionStream(wrapAntiTruncationStream(aliasStream(endCustomHostError(response), prepared.model), prepared.toolName), integrity => {
      // Reject both tool_calls and legacy function_call before any chunk reaches TT.
      if (integrity.hasToolCalls) throw protocolError("unexpected_restored_tool");
    }, null, BODY_LIMIT);
    return new Response(reportStreamFailure(restored.body, signal, true),
      { headers: { ...headers, "content-type": "text/event-stream; charset=utf-8" } });
  }
  try {
    signal?.throwIfAborted();
    const raw = await response.json();
    signal?.throwIfAborted();
    if (raw?.error) throw Object.assign(protocolError("upstream_error"), { upstreamBody: raw });
    const original = inspectCompletion(raw);
    if (!original.valid) throw protocolError(original.reason);
    const completion = restoreAntiTruncationCompletion(raw, prepared.toolName);
    const checked = inspectCompletion(completion);
    if (!checked.valid) throw protocolError(checked.reason);
    if (checked.integrity.hasToolCalls) throw protocolError("unexpected_restored_tool");
    const delivered = prepared.stream ? completionStream(completion, true)
      : new Response(JSON.stringify(completion), { headers: { "content-type": "application/json" } });
    return new Response(delivered.body, { headers: { ...headers, "content-type": delivered.headers.get("content-type") } });
  } catch (error) {
    signal?.throwIfAborted();
    const detail = error.upstreamBody?.error ? error.upstreamBody : failure(error.code ?? "restoration_failed");
    const code = Number(detail.error.code);
    return new Response(JSON.stringify(detail), { status: Number.isInteger(code) && code >= 400 && code <= 599 ? code : 502,
      headers: { "content-type": "application/json" } });
  }
}

export async function restoreTauriTavernResponse(response, prepared, signal) {
  // A failed quiet request is TauriTavern's own JSON error; leave it as it is.
  if (!response.ok || !response.body) return response;
  if (prepared.custom) return restoreCustomResponse(response, prepared, signal);
  let usageMetadata;
  const restored = guardCompletionStream(wrapAntiTruncationStream(wrapNativeTextStream(endHostError(response), prepared.toolName,
    prepared.model, usage => { usageMetadata = usage; }), prepared.toolName), () => {}, null, BODY_LIMIT);
  const headers = prepared.continuation ? { "x-vertex-continuation": "suffix" } : {};
  if (prepared.upstreamStream) {
    return new Response(reportStreamFailure(toSillyTavernStream(restored, () => usageMetadata).body, signal),
      { headers: { ...headers, "content-type": "text/event-stream; charset=utf-8" } });
  }
  let delivered;
  try {
    delivered = completedSillyTavernResponse(await collectCompletion(restored, prepared.model), prepared, usageMetadata);
  } catch (error) {
    signal?.throwIfAborted();
    return new Response(JSON.stringify(failure(error.code ?? "restoration_failed")), { status: 502, headers: { "content-type": "application/json" } });
  }
  return new Response(delivered.body, { headers: { ...headers, "content-type": delivered.headers.get("content-type") } });
}
