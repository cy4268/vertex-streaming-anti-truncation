import { PLUGIN_ID, PLUGIN_PATH, PLUGIN_VERSION, MIN_SERVER_VERSION, MODES, compareVersions, createFetchInterceptor, latestUserFloor } from "./shared.js";

// TauriTavern has no Node server to host the plugin, so the extension shapes the
// request and restores the reply itself. Rendering text as images needs the server.
const tauri = window.__TAURITAVERN__ ? await import("../../src/tauritavern.mjs") : null;
const direct = tauri && { prepare: tauri.prepareTauriTavernRequest, restore: tauri.restoreTauriTavernResponse };
const context = SillyTavern.getContext();
const events = context.eventTypes ?? context.event_types;
const labels = { off: "关闭（普通请求）", buffered: "非流式抗截断", streaming: "流式抗截断" };
const reasons = { "existing-tools": "已有工具调用", "structured-output": "结构化输出", "multiple-candidates": "多个候选回复",
  "tool-history": "工具历史", "web-search": "联网搜索", "image-generation": "图片生成", "reverse-proxy": "反向代理",
  model: "此模型不适用", "too-large": "请求超过 8 MiB", "additional-parameters": "附加参数需为空或可合并的 JSON（排除项也支持单个键名）",
  "additional-parameters-conflict": "附加参数覆盖或排除了抗截断所需字段", "custom-format": "自定义渠道需选择 OpenAI Chat Completions 协议" };
const errors = { unicode_floor_required: "找不到真实用户楼层，已停止发送。请先输入消息，或关闭 Unicode 转码。",
  unicode_input_too_large: "转码后的请求超过大小限制，已停止发送。请缩短输入或关闭 Unicode 转码。",
  plugin_not_ready: "服务端插件未就绪或版本太旧，本次请求已停止发送。点“检查插件连接”查看原因和更新办法。",
  image_input_requires_supported_request: "图片输入不支持此请求，已停止发送，未改用明文。请去掉不支持的内容或换用支持的模型，或关闭图片输入。",
  image_input_unsupported_characters: "图片输入不支持 emoji、控制字符或字体缺字，已停止发送。请删除这些字符，或改用“图片·当前轮”/关闭图片输入。",
  image_input_too_large: "转成图片后超过大小或页数限制，已停止发送。请缩短对话，或改用“图片·当前轮”。",
  image_renderer_unavailable: "服务端图片渲染组件不可用。请在服务端插件目录运行 npm ci --ignore-scripts 后重启酒馆。",
  image_render_failed: "服务端图片渲染失败，已停止发送，未改用明文。",
  request_too_large: "请求超过 8 MiB，插件已拒绝发送。请减少附件或聊天历史。" };
const updateServer = "用安装包装的，下载新版安装包再运行一次；用 Git 装的，在服务端插件目录运行 git pull --ff-only 和 npm ci --ignore-scripts。之后重启酒馆并重新检查。";
let status, select, backendReady, backendWarning;
function selectedSource() { return direct ? document.getElementById("chat_completion_source")?.value : "vertexai"; }
function settings(source = selectedSource()) {
  const store = SillyTavern.getContext().extensionSettings;
  store[PLUGIN_ID] ??= { mode: "off", unicodeInput: false };
  if (direct && source === "custom") return store[PLUGIN_ID].custom ??= { mode: "off", unicodeInput: false };
  return store[PLUGIN_ID];
}
function mode(source) { return MODES.includes(settings(source).mode) ? settings(source).mode : "off"; }
function showStatus(text = "") {
  if (!status) return;
  // A failed version check stays visible until a later check succeeds.
  if (!text && backendReady === false) text = backendWarning;
  status.textContent = text;
  status.hidden = !text;
}
function updateStatus(result) {
  if (result.error) {
    const code = result.status ? `${result.error}，HTTP ${result.status}` : result.error;
    const cause = result.bypass ? `原因：${reasons[result.bypass] ?? result.bypass}。` : "";
    return showStatus((errors[result.error] || `请求失败（${code}）。请查看酒馆错误提示；未自动重试。`) + cause);
  }
  const unicode = result.unicode ? { encoded: "已对当前用户楼层的匹配文本转码。", "floor-not-found": "未匹配到用户楼层原文，按原文发送。", "no-encodable-text": "当前楼层没有需要转码的字符。" }[result.unicode.reason] || "" : "";
  const noText = result.image?.mode === "current-turn"
    ? "图片·当前轮：最后一条 AI 消息之后没有可转换的文本（如点击“继续”或以 AI 消息结尾的预填充），本次按原文发送。"
    : "图片·全部会话：没有可转换的文本，本次按原文发送。";
  const image = result.image ? { encoded: `已将文本转为图片发送${result.image.pages ? `（${result.image.pages} 页）` : ""}。`,
    "no-text": noText + (result.image.stream && result.mode !== "buffered" ? "图片输入请求仍按非流式交付。" : "") }[result.image.reason] || "" : "";
  const bypass = result.bypass && result.bypass !== "disabled" ? `本次使用普通连接：${reasons[result.bypass] ?? result.bypass}。` : "";
  const continuation = result.continuation ? "本次“继续”已请求仅生成新增续文，由酒馆追加到原消息。" : "";
  showStatus([unicode, image, bypass, continuation].filter(Boolean).join(" "));
}

async function checkBackend(silent = false) {
  if (!silent) showStatus("正在检查服务端插件…");
  let version;
  try {
    const response = await fetch(`${PLUGIN_PATH}/status`, { headers: context.getRequestHeaders(), signal: AbortSignal.timeout(5000) });
    const data = response.ok ? await response.json() : null;
    if (data?.id === PLUGIN_ID && typeof data.version === "string") version = data.version;
  } catch {}
  backendReady = Boolean(version) && compareVersions(version, MIN_SERVER_VERSION) >= 0;
  backendWarning = !version ? "找不到服务端插件。请安装配套服务端插件，确认 config.yaml 中 enableServerPlugins 为 true，重启酒馆后重新检查。"
    : `服务端插件 ${version} 太旧，需要 ${MIN_SERVER_VERSION} 或更新。${updateServer}`;
  const difference = backendReady ? compareVersions(version, PLUGIN_VERSION) : 0;
  showStatus(silent || !backendReady ? "" : difference < 0 ? `服务端插件已就绪（${version}），可以使用；它比扩展 ${PLUGIN_VERSION} 旧，建议更新：${updateServer}`
    : difference > 0 ? `服务端插件已就绪（${version}），可以使用；扩展 ${PLUGIN_VERSION} 比它旧，建议在扩展管理器里更新本扩展。`
    : `服务端插件已就绪（${version}）。`);
  return backendReady;
}

function mount() {
  if (document.getElementById("vertex_anti_truncation_settings")) return;
  const parent = document.getElementById("vertexai_form") ?? (direct && document.getElementById("custom_form"));
  if (!parent) { console.warn("[Vertex 抗截断] 找不到 Vertex 连接面板。兼容目标为 SillyTavern 1.19。"); return; }
  const panel = document.createElement("div");
  panel.id = "vertex_anti_truncation_settings";
  const label = document.createElement("label");
  label.htmlFor = "vertex_anti_truncation_mode";
  label.textContent = "抗截断传输";
  select = document.createElement("select");
  select.id = label.htmlFor;
  select.className = "text_pole";
  for (const value of MODES) select.add(new Option(labels[value], value));
  select.value = mode();
  select.addEventListener("change", () => {
    settings().mode = select.value;
    context.saveSettingsDebounced();
    showStatus();
  });
  status = document.createElement("small");
  status.hidden = true;
  status.className = "vertex-antitruncation-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const check = document.createElement("button");
  check.type = "button";
  check.className = "menu_button";
  check.textContent = "检查插件连接";
  check.title = "只检查酒馆服务端插件，不调用模型";
  check.addEventListener("click", () => checkBackend());
  const inputLabel = document.createElement("label");
  inputLabel.htmlFor = "vertex_input_encoding";
  inputLabel.textContent = "输入转码";
  const input = document.createElement("select");
  input.id = inputLabel.htmlFor;
  input.className = "text_pole";
  for (const [value, text] of [
    ["off", "关闭（保持原文）"],
    ["unicode", "Unicode（最新用户楼层及其副本）"],
    ["current-turn", "图片·当前轮（本轮用户文本）"],
    ["all", "图片·全部会话（用户与 AI 文本）"],
  ]) if (!direct || !["current-turn", "all"].includes(value)) input.add(new Option(text, value));
  const saved = settings();
  input.value = saved.unicodeInput === true ? "unicode"
    : !direct && ["current-turn", "all"].includes(saved.imageInput) ? saved.imageInput : "off";
  input.addEventListener("change", () => {
    const current = settings();
    current.unicodeInput = input.value === "unicode";
    current.imageInput = ["current-turn", "all"].includes(input.value) ? input.value : "off";
    context.saveSettingsDebounced();
    showStatus();
  });
  panel.append(label, select, inputLabel, input, status, direct ? Object.assign(document.createElement("small"),
    { textContent: "TauriTavern：扩展直接处理 Vertex 或自定义 OpenAI Chat Completions；自定义上游需支持工具调用。两种来源的设置分别保存；不支持图片输入。" }) : check);
  parent.append(panel);
  if (direct) {
    const movePanel = () => {
      const target = document.getElementById(selectedSource() === "custom" ? "custom_form" : "vertexai_form");
      if (target) target.append(panel);
      select.value = mode();
      input.value = settings().unicodeInput === true ? "unicode" : "off";
      showStatus();
    };
    movePanel();
    if (events.CHATCOMPLETION_SOURCE_CHANGED) context.eventSource.on(events.CHATCOMPLETION_SOURCE_CHANGED, movePanel);
  }
  // Install once and chain any previously installed fetch wrapper.
  const key = Symbol.for("vertex-anti-truncation.fetch");
  if (!window[key]) {
    window[key] = true;
    window.fetch = createFetchInterceptor(window.fetch.bind(window), { origin: location.origin, getMode: mode,
      getImageInput: () => direct ? "off" : settings().imageInput || "off",
      getUnicodeInput: source => settings(source).unicodeInput === true,
      getUserFloor: () => latestUserFloor(SillyTavern.getContext().chat),
      // Image input and Continue require a matching server plugin.
      ensureBackend: async () => Boolean(direct) || backendReady || checkBackend(true), onStatus: updateStatus, direct });
  }
  if (!direct) void checkBackend(true);
}

context.eventSource.on(events.APP_READY ?? events.APP_INITIALIZED, mount);
