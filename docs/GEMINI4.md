# Gemini 4 Argon

中文 | [English](GEMINI4.en.md)

核对日期：2026-10-14。正式模型 ID 为 `gemini-4-argon`，Vertex OpenAI 兼容接口使用 `google/gemini-4-argon`。推荐使用 `global`；Google 也列出 `us`、`eu`。

## 升级方式

酒馆插件部分随 SillyTavern 集成 0.4.0（`sillytavern-v0.4.0`）发布，更早的安装包不含此适配。独立网关部分随网关 0.8.0 发布，支持源码和 Docker 部署。

- 独立网关：停止网关后，在本仓库执行 `git pull --ff-only`、`npm ci --ignore-scripts`，再启动。若本地有冲突，先处理自己的修改，不要覆盖配置；保存的模型、凭据、输出额度和超时不自动改变。
- 酒馆 Git 安装：同步更新 UI 扩展和服务端插件至同一个 `main` 提交，服务端运行 `npm ci --ignore-scripts`，再重启酒馆、刷新页面。具体目录和迁移方式见[酒馆更新说明](SILLYTAVERN.md#更新与已有手动安装)。
- 一键安装包用户：下载 `sillytavern-v0.4.0` 的安装包再运行一次；或从更新后的源码运行 `npm run package:sillytavern`，使用新生成的 `dist/sillytavern` 安装包。不要把 Git 副本直接覆盖到安装包管理的目录上。

本次开发验收只生成并检查了安装包，没有更新现有酒馆安装。

## 添加模型

在独立网关的“模型与版本”页面手动输入 `gemini-4-argon`，勾选所需的正常、非流式抗截断和流式抗截断版本，添加后保存。也可以先拉取目录。已有 3.7/3.8 配置与默认入口不自动替换。

连接配置支持完整服务账号 JSON、Express 快速模式 API Key、短期 OAuth token。Express 使用 `global`，项目 ID 可留空。快速 key 是 Vertex Express key，不等于任意 AI Studio key；账户能否调用 Gemini 4 仍取决于 Google 的权限与当前可用性。目录拉取失败时可以手动填写 ID，目录也不证明模型调用权限。

可以自定义上游 **Gemini 模型 ID** 与客户端显示名称。独立网关的 **Base URL 固定为官方 Vertex**，目前没有任意第三方中转 URL 配置。酒馆的“自定义 OpenAI 连接”可以连接本地网关，这与自定义网关上游 URL 是两回事。

## 请求兼容

- `reasoning_effort: low|medium|high` 转成 `thinking_level: LOW|MEDIUM|HIGH`。未指定时保留模型默认 MEDIUM；`auto` 也保留默认。旧客户端的 `none/min/minimal` 对应 LOW，`max/xhigh` 对应 HIGH，不能彻底关闭思考。显式 `extra_body.google.thinking_config` 优先。
- 数字 `thinking_budget` / `thinkingBudget` 和显式 `cached_content` 返回本地 400，并给出固定错误码；不静默丢弃用户的预算或缓存语义。
- 去掉 Google 迁移清单要求移除的采样参数、惩罚参数与 `n`。原有预填充转 USER 开关扩展到 Argon；仅转换末尾纯文本，保留工具与思考历史。
- 原生酒馆插件独立处理 Argon 思考等级，不依赖旧酒馆版本只认识 Gemini 2.5/3 的预算函数。需要用户所在酒馆能够选择或输入该模型。
- TauriTavern 适配版中，Argon 的思考等级与采样参数由 TauriTavern 自己处理，需要其版本已收录该模型；扩展只检查输出上限。见 [TauriTavern 说明](SILLYTAVERN.md#tauritavern)。
- 原生工具调用 ID 与思考签名通过不透明的 `vtx4.` 工具 ID 一起往返。客户端回传工具结果时必须完整保留服务返回的 ID。
- 每次上游请求仍只调用一次模型（已有显式开启的错误重试除外）。未实现 continuation-token 长解码：上游非流式最多 32,768 token，流式最多 65,536 token；非流式抗截断即使向客户端输出 SSE，也按 32,768 上限检查。超限返回 `gemini4_long_decode_required`，不自动增加输出额度或追加付费请求。thinking 和正文共享该额度，短额度可能先被思考用完。
- 复杂请求可能需更长等待，可按需把已有超时设置调至 900,000 ms 或更高；升级不会改写旧超时。

## 常见本地错误

| 错误码（HTTP 400） | 处理方式 |
| --- | --- |
| `invalid_gemini4_thinking_level` | 使用 `low`、`medium` 或 `high`，显式 Google 配置使用 `thinking_level`。 |
| `unsupported_gemini4_thinking_budget` | 删除数字预算，改用思考等级。 |
| `unsupported_gemini4_cached_content` | 删除显式缓存引用；此处不提供该功能。 |
| `gemini4_long_decode_required` | 降低输出额度；按实际上游是否流式选择 32,768 或 65,536 上限。 |
| `invalid_tool_history` | 保留服务返回的完整 `tool_call.id`；损坏的历史需要修正后再发送。 |

## 母仓库

[LLM Subscription Router](https://github.com/ken050210/llm-subscription-router) 同步加入 `gemini-4-argon`、`抗截断-gemini-4-argon` 和 `实验性-流式抗截断-gemini-4-argon`。模板与已有运行配置是两份数据，拉取源码不会替换已有运行配置；添加时复用自己的 Vertex 账号与路由。母仓库的普通 OpenAI-compatible 账号支持自定义上游 URL；该能力没有加入本独立网关。

## 官方依据

- [Vertex Gemini 4 开发指南](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-4-argon)
- [Vertex 模型迁移清单](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/migrate)
- [Gemini API 新模型说明](https://ai.google.dev/gemini-api/docs/latest-model)

代码测试、真实短请求、Express 账户权限、酒馆安装后的浏览器验证和长篇生成质量是不同验收项；本次具体结果见[验收说明](VALIDATION.md)。
