# 安全与隐私

中文 | [English](SECURITY.md)

直接运行时网关和控制台默认只监听 `127.0.0.1`。Docker 在容器内显式设置 `LISTEN_HOST=0.0.0.0`，Compose 默认仅向宿主机本地发布端口。模型和管理接口需要网关密钥，上游地址固定为 Google Vertex AI。凭据应放在仓库之外；环境文件、凭据和日志不属于发布内容，也不进入 Docker 构建上下文。若用 `NODE_USE_ENV_PROXY` 让访问 Google 的请求经过代理，该代理也在信任边界内。

控制台远程访问需显式指定 `GUI_ORIGIN`，仍保留 Host/Origin 和 CSRF 校验，不通过转发请求头放行主机；HTTPS 来源的会话 Cookie 带 Secure。远程管理应使用 HTTPS 或 SSH 隧道。Docker 数据卷含明文凭据，需要像本机设置目录一样保护和备份。详见 [Docker 部署](docs/DOCKER.md)。

控制台校验 Host / Origin，拒绝跨站请求，使用限时 HttpOnly / SameSite 会话和 CSRF Token，并限制登录失败次数。首次启动在终端显示设置链接；第一次保存网关密钥后该链接失效，其他通过该链接登录的会话也会退出。之后更换网关密钥会让其他控制台会话退出，其他保存不影响登录。配置接口只回传凭据是否存在，不回传值。浏览器存储中不保存密钥。测试回复仅显示在已登录页面，不写入日志。

GUI 配置（含凭据）以明文保存在 `~/.vertex-streaming-anti-truncation/settings.json`，或 `GATEWAY_STATE_DIR` 指定的目录。请选择私人目录。POSIX 文件/目录请求 0600/0700 权限；Windows 继承目录 ACL。保存前校验，使用进程锁和版本检查，再同步并原子替换文件。旧版本保存或替换端口被占用时保留原服务。首次保存前，控制台从 `.env` 和进程环境变量读取初始值，包括 `GOOGLE_APPLICATION_CREDENTIALS` 这类系统级变量。首次保存只写入所选鉴权方式的凭据；之后保存时勾选删除选项，会从文件中删除其他鉴权方式已保存的凭据。能读取当前用户文件的本机软件仍在信任边界内。

请求日志不包含提示词、回复、工具参数或凭据。网关从不回传上游的原始错误正文。上游 HTTP 错误，以及输出开始前到达的上游错误事件，返回固定错误码和状态，并附带 `upstreamError`：Google 的状态码和原因码，以及去除标记、邮箱、密钥类字符串、长令牌和本次请求所用凭据后的错误说明，最多 240 个字符。控制台连接测试在已登录页面显示同样的字段。日志和事件列表只保留状态码与原因码。进程内最多保留 200 条事件。流式解析对事件和 JSON 状态设有大小限制，不为记录日志而累积整段回复。非流式 JSON 回复上限为 8 MiB。

每条请求发起一次模型生成；开启提示词提交失败重试（默认关闭）时，输出开始前命中规则的拒绝最多再提交一次，并附带自定义文本，输出开始后不重试。客户端取消时，网关会中止上游请求。若正文已经发给客户端，随后出现协议错误，连接会关闭，日志会记录失败。

`npm run verify` 只使用本地模拟数据。`npm run smoke -- --live` 会发送两条收费客户端请求，每条最多 512 个输出 token；开启重试时最多 4 次上游提交。独立网关无法读取其他 router 的额度限制或冷却状态。

SillyTavern 服务端插件在酒馆进程内运行，权限与酒馆相同。每次请求读取当前登录用户已保存的 Vertex 凭据，沿用酒馆的登录和 CSRF 检查，不把凭据返回浏览器，只请求固定的 Google 地址。详见 [docs/SILLYTAVERN.md](docs/SILLYTAVERN.md)。

## 报告安全漏洞

请通过仓库 Security 页签下的 [Report a vulnerability](https://github.com/ken050210/vertex-streaming-anti-truncation/security/advisories/new) 页面私下报告安全问题。凭据、认证或数据泄露类问题的细节不要写进公开 Issue，也不要附上真实密钥或令牌。私密表单不可用时，可以开一个只请求私下联系方式、不含任何问题细节的公开 Issue。

报告其他问题时，可以附上版本、状态码、`requestId` 和 `antiTruncation` 元数据。请勿附上 `.env`、服务账号文件、bearer token 或私人对话。
