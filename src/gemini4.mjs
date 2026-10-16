// Vertex Gemini 4 Argon: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-4-argon
// Keep these rules model-specific; earlier Gemini versions retain their budget semantics.
export const isGemini4Argon = model => /^(?:google\/|publishers\/google\/models\/)?gemini-4-argon(?:@[a-z0-9-]+)?$/i.test(model || "");
const invalid = (code, message) => Object.assign(new Error(message), { status: 400, code });

export function gemini4ThinkingLevel(effort) {
  if (effort == null || effort === "") return undefined;
  const value = String(effort).toLowerCase();
  if (value === "auto") return undefined;
  const level = { none: "LOW", min: "LOW", minimal: "LOW", low: "LOW", medium: "MEDIUM", high: "HIGH", max: "HIGH", xhigh: "HIGH" }[value];
  if (!level) throw invalid("invalid_gemini4_thinking_level", "Gemini 4 Argon supports LOW, MEDIUM or HIGH thinking; thinking cannot be disabled.");
  return level;
}

export function prepareGemini4Request(payload, model) {
  if (!isGemini4Argon(model)) return payload;
  const google = payload.extra_body?.google;
  const thinking = google?.thinking_config;
  if (google?.cached_content != null) throw invalid("unsupported_gemini4_cached_content", "Gemini 4 Argon does not support explicit cached_content; use a shared prompt prefix for implicit caching.");
  if (thinking?.thinking_budget != null || thinking?.thinkingBudget != null) {
    throw invalid("unsupported_gemini4_thinking_budget", "Gemini 4 Argon does not support a numeric thinking budget; use thinking_level LOW, MEDIUM or HIGH.");
  }
  if (thinking != null && (typeof thinking !== "object" || Array.isArray(thinking))) {
    throw invalid("invalid_gemini4_thinking_level", "thinking_config must be an object.");
  }
  // An explicit provider config wins, including an include-thoughts-only config.
  const level = gemini4ThinkingLevel(thinking != null ? thinking.thinking_level ?? thinking.thinkingLevel : payload.reasoning_effort);
  if (thinking == null && level == null) {
    if (payload.reasoning_effort == null) return payload;
    const { reasoning_effort, ...result } = payload;
    return result;
  }
  const config = { ...thinking };
  delete config.thinkingLevel;
  delete config.thinking_level;
  if (level != null) config.thinking_level = level;
  const result = { ...payload, extra_body: { ...payload.extra_body, google: { ...google, thinking_config: config } } };
  delete result.reasoning_effort;
  return result;
}

export function validateGemini4Output(payload, model, stream) {
  if (!isGemini4Argon(model)) return;
  const limit = stream ? 65536 : 32768;
  const requested = payload.max_tokens ?? payload.max_completion_tokens;
  if (requested > limit) throw invalid("gemini4_long_decode_required", `Gemini 4 Argon supports at most ${limit} output tokens per ${stream ? "streaming" : "non-streaming"} upstream request here; continuation-token long decode is not implemented. Lower the limit or use Google's long-decode API.`);
}

// Preserve both the native function-call ID and thought signature inside the
// opaque OpenAI tool-call ID; tool results must echo the native ID on Gemini 4.
export function encodeGemini4ToolId(part) {
  return "vtx4." + Buffer.from(JSON.stringify({ id: part.functionCall.id,
    ...(part.thoughtSignature ? { signature: part.thoughtSignature } : {}) })).toString("base64url");
}

export function gemini4ToolMetadata(id) {
  // The TauriTavern extension loads this module in a WebView, so node:crypto is
  // resolved here, on the gateway-only tool-history path, not imported at the top.
  if (typeof id === "string" && id.startsWith("vtx.")) return {
    id: "call_" + process.getBuiltinModule("node:crypto").createHash("sha256").update(id).digest("hex").slice(0, 24), signature: id.slice(4),
  };
  if (typeof id !== "string" || !id.startsWith("vtx4.")) return { id };
  try {
    const value = JSON.parse(Buffer.from(id.slice(5), "base64url").toString("utf8"));
    if (!value || typeof value.id !== "string" || !value.id || (value.signature != null && typeof value.signature !== "string")) throw new Error();
    return value;
  } catch {
    throw invalid("invalid_tool_history", "Invalid Gemini 4 tool-call ID.");
  }
}
