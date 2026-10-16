# TT 自定义 OpenAI 兼容版 0.4.1

目标是 TauriTavern **2.3.0** 的「聊天补全 → 自定义 → OpenAI Chat Completions」，不是旧式 Text Completions，也不是 OpenAI Responses、Claude 或 Gemini 自定义协议。

## 安装与开启

1. 如果已安装 ken050210 的同名扩展，先卸载旧扩展，避免同一个拦截器被两份代码抢先注册。只替换扩展，不删除聊天、角色卡或 API 设置。
2. 在 TT 的「扩展程序 → 安装扩展」粘贴以下地址，分支留空：

   ```text
   https://github.com/cy4268/vertex-streaming-anti-truncation
   ```

3. 安装完成后重启 TT。扩展列表应显示「Vertex AI 抗截断（TT 自定义兼容）」、版本 **0.4.1**。
4. 在聊天补全来源选择「自定义」，协议选择 **OpenAI Chat Completions**。沿用原来的 URL、API 密钥和模型名称。例如 `快速v/gemini-4-argon` 会原样发送，不要求去掉渠道前缀。
5. 在该连接面板中的「Vertex AI 抗截断」选择流式或非流式抗截断。自定义渠道默认关闭；它与 Google Vertex AI 的选项分开保存。

只安装 UI 扩展的**完整仓库**，不需要 Node.js、服务端插件、网关或修改 VPS。不要使用上游 Release 中仅面向 SillyTavern 的精简前端包替代本仓库。

## 本分支的行为

- 使用 TT 原有请求入口和凭据处理，不改变连接 URL、密钥、模型别名、取消信号或请求头。
- 通过 `custom_include_body` 合并 OpenAI `tools`、`tool_choice`、`parallel_tool_calls: false`。回复中的合成工具参数还原为正文，不交给 TT 执行工具。
- 流式模式 + 客户端流式：逐段还原 SSE；客户端非流式，或选择非流式抗截断：请求一次 JSON 回复；客户端仍要 SSE 时将完整结果转为 SSE。真实逐段速度依赖上游是否逐段发送工具参数。
- 「继续」只请求追加内容，不主动重发、续接或重试。保留推理字段、用量及终止原因；长度上限或过滤结束不伪装成正常结束。
- 上游非 2xx 响应保持原响应。成功 HTTP 响应中的 OpenAI JSON/SSE 错误保留错误对象；中断、损坏的回复或非预期真实工具调用产生明确错误，不补造成功的 `[DONE]`。TT 和网关实际呈现哪些字段仍取决于它们自己的错误处理。
- 原 Google Vertex AI 路径保留；非 TT 的 SillyTavern 自定义请求不新增拦截。

## 使用条件与兼容边界

- 上游必须接受 OpenAI 工具调用及指定工具选择。扩展不改变上游额度、限流、超时或内容策略，也不保证任何请求一定完成。
- 额外请求体仅合并空值或 **JSON 对象**。已有工具、结构化输出、多候选、工具历史、覆盖 messages/stream 或排除关键工具字段时，不做抗截断改写，面板显示对应原因。JSON 排除键允许字符串、字符串数组或对象；无法可靠解析的 YAML 原样交回 TT。
- 其他自定义协议保持原请求，不启用本改造。TT 图片输入模式仍不支持；Unicode 转码保留为独立可选项。
- 关闭自定义面板中的抗截断和 Unicode 转码，即恢复该渠道原始请求。需要退回原版时，卸载本扩展，重新安装原仓库并重启 TT；不要同时加载两版。

## 验证与来源

本次使用 Node.js 24.12.0 做离线模拟传输验证，没有调用付费上游，也没有在用户手机上的 TT 实测 UI：

```sh
node --test test/tauritavern.test.mjs
node --test --test-name-pattern="SillyTavern intercept is scoped" test/sillytavern.test.mjs
```

第一条 12 项通过（11 项既有 + 1 项新增集成回归），第二条 1 项通过。新增回归覆盖流式组合、别名/凭据保留、继续、真实增量交付、冲突参数、上游错误、中断、取消，以及现代/旧式非预期工具拦截。未新增测试框架或运行全量测试套件。

来源固定为以下版本，保留原作者与 MIT 许可证：

- 原项目：[ken050210 / vertex-streaming-anti-truncation @ 2a0e0a8](https://github.com/ken050210/vertex-streaming-anti-truncation/tree/2a0e0a8deafd5b09a4828b71a877edc975aa3328)。
- TT 接口核对：[TauriTavern v2.3.0 @ a1855be](https://github.com/Darkatse/TauriTavern/tree/a1855be4a4f8b6ee7cd0374a84dbb3709c3e5375)，包括 `src/index.html`、`src/scripts/openai.js` 与 Rust `chat_completion_service` 请求体及附加参数处理。
- 本仓库扩展版本为 0.4.1；独立网关代码与其 0.8.0 版本未在本次改造。
