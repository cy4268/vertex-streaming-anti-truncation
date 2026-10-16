# Gemini 4 Argon

[中文](GEMINI4.md) | English

Checked on 2026-10-14. The model ID is `gemini-4-argon`; Vertex's OpenAI-compatible API uses `google/gemini-4-argon`. Use `global`; Google also lists `us` and `eu`.

## Updating

The Tavern plugin part ships in SillyTavern integration 0.4.0 (`sillytavern-v0.4.0`); earlier packages do not include it. The gateway part ships in gateway 0.8.0, available as source and Docker images.

- Standalone gateway: stop it, run `git pull --ff-only` and `npm ci --ignore-scripts` in this checkout, then restart. Resolve any local conflicts without overwriting your configuration. Saved models, credentials, token limits and timeouts are preserved.
- Git-installed Tavern integration: update both the UI extension and server plugin to the same `main` commit, run `npm ci --ignore-scripts` in the server plugin, restart Tavern and refresh the page. The [Tavern guide](SILLYTAVERN.md) covers locations and migration.
- One-step package installations: download the `sillytavern-v0.4.0` package and run it again, or run `npm run package:sillytavern` from updated source and use the generated `dist/sillytavern` installer. Do not copy a Git installation over an installer-managed directory.

This development validation generated and checked the package; it did not update the existing Tavern installation.

## Adding the model and choosing credentials

In the model manager, enter `gemini-4-argon`, select the normal, buffered or streaming anti-truncation profiles you want, add them and save. Catalog discovery is optional; discovery failure does not prevent manual entry, and a catalog entry does not prove inference permission. Existing 3.7/3.8 profiles and defaults are retained.

The gateway supports full service-account JSON, Vertex Express API keys and short-lived OAuth access tokens. Express uses `global` and does not require a project ID. An Express key is not an arbitrary AI Studio key; Gemini 4 entitlement and availability still depend on Google and the account. Live Express entitlement for Argon has not been tested here.

You can customize Gemini model IDs and client-facing names. The upstream URL remains Google's Vertex endpoint. Connecting Tavern's custom OpenAI connection to this local gateway does not make the gateway's upstream URL customizable.

## Request compatibility

- `reasoning_effort: low|medium|high` maps to `thinking_level: LOW|MEDIUM|HIGH`. Omitted effort or `auto` keeps the model default, MEDIUM. Legacy `none/min/minimal` maps to LOW and `max/xhigh` to HIGH; thinking cannot be disabled. Explicit `extra_body.google.thinking_config` takes precedence.
- Numeric `thinking_budget` / `thinkingBudget` and explicit `cached_content` fail locally with HTTP 400. Their budget or cache semantics are not silently discarded.
- Sampling controls, penalties and `n` listed for removal by Google's migration checklist are omitted. The optional assistant-to-user prefill conversion now includes Argon; it only converts trailing plain text and preserves tool and thinking history.
- The native Tavern plugin handles Argon thinking levels independently of older Tavern budget helpers. Your Tavern must still let you select or enter the model ID.
- In the TauriTavern adaptation, TauriTavern itself handles Argon's thinking level and sampling parameters and must already list the model; the extension only checks the output limit. See the [TauriTavern section (Chinese)](SILLYTAVERN.md#tauritavern).
- Native function-call IDs and thought signatures round-trip in opaque `vtx4.` tool-call IDs. Clients must preserve these IDs when returning tool results.
- Continuation-token long decode is not implemented. Each upstream unary request is limited to 32,768 output tokens and each upstream stream to 65,536, including thinking. Buffered anti-truncation uses the unary limit even when the client asks for SSE. Larger limits fail locally; the adaptation adds no automatic follow-up calls or token-limit increase. Existing explicitly enabled error retries keep their behavior.
- For complex requests, the existing timeout may need to be raised to 900,000 ms or more. Updating does not change it automatically.

## Local errors

| HTTP 400 code | Action |
| --- | --- |
| `invalid_gemini4_thinking_level` | Use low, medium or high; use `thinking_level` inside an explicit Google config. |
| `unsupported_gemini4_thinking_budget` | Remove the numeric budget and use a thinking level. |
| `unsupported_gemini4_cached_content` | Remove the explicit cache reference. |
| `gemini4_long_decode_required` | Reduce the limit to fit the actual unary or streaming upstream transport. |
| `invalid_tool_history` | Restore the complete tool-call ID returned by the server before resending. |

## Parent router

[LLM Subscription Router](https://github.com/ken050210/llm-subscription-router) adds `gemini-4-argon`, `抗截断-gemini-4-argon` and `实验性-流式抗截断-gemini-4-argon`. The tracked template and existing runtime configuration are separate: pulling source does not replace runtime configuration. Reuse your Vertex account and route when adding these models. The parent's ordinary OpenAI-compatible account type permits custom upstream URLs; this standalone gateway does not.

## Sources and validation

- [Vertex Gemini 4 guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-4-argon)
- [Vertex migration checklist](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/migrate)
- [Gemini API model guide](https://ai.google.dev/gemini-api/docs/latest-model)

[Validation results](VALIDATION.en.md) distinguish local tests, bounded live calls, Express entitlement, installed Tavern interaction and long-form quality.
