# Security and privacy

[中文](SECURITY.zh-CN.md) | English

Native installs bind to `127.0.0.1` by default. Docker explicitly uses `LISTEN_HOST=0.0.0.0` inside the container; Compose publishes ports only on host loopback by default. Model and admin endpoints require a gateway key, and upstream URLs are fixed to Google Vertex AI. Keep credentials outside this repository. Environment files, credentials and logs are excluded from releases and the Docker build context. If you send Google traffic through a proxy with `NODE_USE_ENV_PROXY`, that proxy is inside the trust boundary.

Remote console access requires an explicit `GUI_ORIGIN`; Host/Origin and CSRF checks remain enabled, and forwarded headers cannot authorize a host. HTTPS origins use Secure session cookies. Use HTTPS or an SSH tunnel for remote administration. The Docker data volume stores plaintext credentials; protect and back it up like the native settings directory. See [Docker deployment](docs/DOCKER.en.md).

The console checks Host and Origin, denies cross-site requests, uses expiring HttpOnly/SameSite sessions and CSRF tokens, and limits failed sign-in attempts. On first launch the terminal displays a bootstrap link. The first save that sets a gateway key retires the link and signs out every other session opened with it. After that, changing the gateway key signs out other console sessions; other saves keep them. Configuration responses expose only credential-presence booleans. No keys enter browser storage. Test replies are shown only in the signed-in page and are not saved in logs.

GUI settings (including credentials) are stored as plaintext in `~/.vertex-streaming-anti-truncation/settings.json`, or `GATEWAY_STATE_DIR`. Use a private directory. Files/directories request mode 0600/0700 on POSIX; Windows uses the directory's inherited ACLs. Saves validate before replacing the file, use a process lock, check the revision and rename a flushed temporary file. A stale revision or unavailable replacement port leaves the existing service intact. Before the first save, the console reads its initial values from `.env` and the process environment, including system-wide variables such as `GOOGLE_APPLICATION_CREDENTIALS`. The first save stores only the selected mode's credential, and a later save with the delete option ticked removes the other modes' stored credentials from the file. Other local software with access to this user's files remains within the trust boundary.

Request logs do not contain prompts, replies, tool arguments or credentials. The provider's raw error body is never returned. Provider HTTP errors, and provider error events that arrive before any output, return a fixed error code and status plus `upstreamError`: Google's status and reason codes and its error message with markup, email addresses, key-like strings, long tokens and the request's credential removed, capped at 240 characters. The console's connection test shows the same fields in the signed-in page. Logs and the event list keep only the status and reason codes. The event list holds at most 200 records in memory. The streaming parser bounds its event and JSON state; it does not collect complete replies for logging. Non-streaming JSON completions have an 8 MiB limit.

Each request makes one generation attempt. If prompt-submission retry is enabled (off by default), a matching rejection before any output can add one resubmission that includes your custom text; the gateway never retries after output starts. Client cancellation aborts the upstream request. If a protocol error occurs after text has reached the client, the connection closes and the log records the failure.

`npm run verify` uses local fixtures. `npm run smoke -- --live` sends two billable client requests, each capped at 512 output tokens; with prompt retry enabled this can be up to four upstream submissions. This standalone gateway has no access to quota limits or cooldown state in another router.

The SillyTavern server plugin runs inside the Tavern process with SillyTavern's privileges. For each request it reads the signed-in user's saved Vertex secret, keeps Tavern's login and CSRF checks, never returns credentials to the browser and only calls fixed Google endpoints. See [docs/SILLYTAVERN.md](docs/SILLYTAVERN.md).

## Reporting a vulnerability

Report security problems privately through the [Report a vulnerability](https://github.com/ken050210/vertex-streaming-anti-truncation/security/advisories/new) page under the repository's Security tab. Never put credential, authentication or data-exposure details in a public issue, and never attach real keys or tokens. If the private form is unavailable, open a public issue that only asks for a private contact and contains no details of the problem.

For other bug reports, include the version, status code, `requestId` and `antiTruncation` metadata. Omit `.env`, service-account files, bearer tokens and private conversation text.
