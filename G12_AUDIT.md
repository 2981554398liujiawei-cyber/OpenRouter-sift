# G12_AUDIT.md — Security / Release Audit（审计先行）

日期：2026-08-29 · 基线 HEAD `9c14b6c` · 审计对象：src/（server/cli/config/auth/storage/observability/openrouter/util）+ ui/ + package 配置
方法：源码人工审计 + 静态扫描 + `npm audit` + `npm pack --dry-run` + git 历史秘密扫描。**只列有证据的问题。**

严重级定义：P0 = secret 泄露 / 权限绕过 / Provider 边界绕过 / 远程控制；P1 = 高概率安全或发布问题，V1.0 前必修；P2 = 应修但不阻塞核心安全；P3 = polish/maintenance。

---

## P0（必须修）

### AUD-01 Host 头 / DNS rebinding 防护缺失
- **证据**：`src/server.ts` 请求处理未校验 `Host`；`http.createServer` 直接按 pathname 路由。`cfg.host` 默认 `127.0.0.1`（config.ts:114）。
- **攻击场景**：恶意网页用 DNS rebinding（`attacker.example` → `127.0.0.1:8787`）向本机控制面发 `POST /api/*`；浏览器放行（Host 为 attacker.example，服务端不校验），控制面被远程操作。
- **修复**：loopback 绑定时对 `Host` 做白名单（`localhost` / `127.0.0.1` / `[::1]` / 配置的 loopback host）；非法 Host → 403。非 loopback 绑定（需控制密钥）不套 Host 白名单，但保留 Origin 校验。

### AUD-02 Origin / CSRF / CORS 审计不足
- **证据**：`server.ts:286-299` 对非 `/api` 的 OPTIONS 返回 `Access-Control-Allow-Origin: *`（含 `/v1/*`）；任何路径都没有 Origin 校验；有副作用方法（POST/PUT/DELETE）未检查浏览器 Origin。
- **攻击场景**：与 AUD-01 叠加构成 CSRF/DNS-rebinding 全链路；`*` 意味着浏览器跨站预检直接放行（虽需凭据，但配合 rebinding 可触达控制面）。
- **修复**：① 所有 OPTIONS（/api 与 /v1）仅对 loopback Origin 返回 ACAO（回显 origin + `Vary: Origin`），任意位置不再出现 `*`；② 对 `/api/*` 的 POST/PUT/PATCH/DELETE，若带 `Origin` 头则必须为 loopback origin，否则 403；无 Origin（curl/CLI）放行。

---

## P1（V1.0 前必须修）

### AUD-03 控制密钥可能被透传至上游
- **证据**：`server.ts:76-99` `getUpstreamAuth` 在 passthrough 模式下，若 inbound Bearer 不是 `sk-ant-`/`sk-or-` 则原样转发。`SHIM_LOCAL_API_KEY`（控制密钥）在非 managed 数据面请求上会被当作上游认证发往 OpenRouter。
- **修复**：inbound auth 等于 `cfg.local_api_key` 时替换为活跃上游密钥。

### AUD-04 /api 大体积与坏 JSON 返回 500 而非 413/400
- **证据**：`readJsonBody`（http.ts:10-25）抛 `ERR_BODY_TOO_LARGE` / `Error("Invalid JSON body")`（无 code）；`server.ts` /api 外层 catch（694-697）统一映射为 500 `ERR_MANAGEMENT_INTERNAL`。
- **修复**：/api 外层 catch 映射 `ERR_BODY_TOO_LARGE → 413`、`ERR_INVALID_JSON → 400`；`readJsonBody` 为坏 JSON 附 `code = "ERR_INVALID_JSON"`。

### AUD-05 SHIM_LOCAL_API_KEY 下 /ui 浏览器打不开（§12 已知问题）
- **证据**：`server.ts:309-315` 控制面 auth 覆盖 `!isDataPlane`（即 /ui 与 /api 都要求 Bearer）。
- **修复**：auth 仅作用于 `/api/*`；`/ui` 静态资源免鉴权加载（bundle 无 secret，数据来自受保护 /api）；UI 首次 401 显示 `Unlock Control Plane`（密钥仅存 React 内存态，不进 URL/localStorage/cookie）；UI fetch 包装自动附加 `Authorization: Bearer`。

### AUD-06 非 loopback 绑定静默暴露控制面（§11）
- **证据**：`--host 0.0.0.0` / LAN IP 无任何启动拦截，无 warning 之外提示。
- **修复**：启动时若非 loopback 绑定且未配置 `local_api_key`（`--local-api-key` / `SHIM_LOCAL_API_KEY`）→ 拒绝启动并给出明确错误。

### AUD-07 /config 泄露绝对路径与内部字段（§67/§68）
- **证据**：`server.ts:279-283` `/config` 返回 `cfg` 去掉两个 key 后的全量，含 `*_store_path`（本机绝对路径，如 `C:\Users\...`）、`_runtime`（soft_enforce_only/debug 开关）、`attribution` 等。
- **修复**：/config 只返回安全投影（host/port/upstream/feature flags/merge mode/log 配置），不含任何路径与运行时内部字段。

### AUD-08 控制面响应缺安全头（§18/§19）
- **证据**：`writeJson/writeError`（http.ts:28-44）与 `serveControlUi`（controlUi.ts:76-84）均未输出 `X-Content-Type-Options` / `Referrer-Policy` / `X-Frame-Options` / CSP。
- **修复**：集中加 `nosniff`、`no-referrer`、`X-Frame-Options: DENY`；/ui HTML 加 CSP（`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'`），不封死 React。

### AUD-09 npm pack 混入运行时数据与 QA 截图（§83/§84，发布级）
- **证据**：`npm pack --dry-run` 列出 `openrouter-control-metadata.json`（1.9MB）、`openrouter-control-requests.json`（832KB，含真实请求元数据）、`openrouter-control-*.json`、`tmp/g11-qa/*.png`、源码、vite 配置。
- **修复**：package.json 加 `files: ["dist"]` 白名单；清理 `tmp/`；`git rm --cached openrouter-control-requests.json`（历史误入版本库的运行时文件）。

---

## P2（应修，不阻塞核心安全）

### AUD-10 存储文件权限（§26）
- **证据**：所有 store `persist()` 用默认 umask 写文件（Unix 下 0644），目录 0755。
- **修复**：共享 `atomicWriteJson` 帮助函数，文件 0600、目录 0700（Windows 依赖用户 ACL，chmod 为 no-op）；全部 6 个 store 接入。

### AUD-11 /api 解析失败回显原始输入（§69）
- **证据**：`writeError(res, 400, err?.message ?? ..., ...)`（如 policy/override 解析）可能回显 zod 消息中的输入内容。
- **修复**：控制面解析失败统一返回固定文案 + 保留错误码，不回显输入。

### AUD-12 `/version` 名称与产品化（§87/§92）
- **证据**：`/version` 返回 `name: "openrouter-provider-shim"`；package name/description 仍为 shim 旧文案。
- **修复**：/version name → `openrouter-sift`；package metadata 产品化（description/keywords/repository）；新增 bin alias `openrouter-sift`（保留旧 alias）。

---

## P3（polish / maintenance）

- AUD-13 README 快速开始仍以 env 为主，需改为 UI 主路径（§93-§97），补 CHANGELOG（§103）。
- AUD-14 CLI `--upstream-key` 保留但文档标注 advanced/less private（§32）。
- AUD-15 上游 429 / 区域 403 / free 模型限流属环境因素（§127），不修。
- AUD-16 Cursor 未实机（§98）与浏览器三档截图（§99/§100）列 manual。

---

## 已验证（无修改项）

| 项 | 结论 | 证据 |
|---|---|---|
| Managed key 不能控制 /api（§16） | ✅ 已有 | server.ts:303-305 + upstream-key-management.test.ts |
| /ui 路径穿越（§22） | ✅ 已有 | controlUi.ts 双 realpath 检查 + control-ui.test.ts |
| 本地密钥 hash-only + timingSafeEqual（§41/§42） | ✅ | access/crypto.ts |
| 本地密钥 CSPRNG（§40） | ✅ | `randomBytes(32)` |
| 凭据存储失败不回退明文（§28） | ✅ | secureStore.ts（Linux 无 secret-tool 抛错 / NoopStore） |
| 原子写 temp+rename（§25） | ✅ 全部 6 store | storage/* + access/* |
| 请求日志上限裁剪（§57） | ✅ | requestStore.prune() + setLimit |
| enrichment 队列有界（§58） | ✅ | BoundedQueue(100, 2) |
| 重试有界且 4xx 不重试（§54-§56） | ✅ | server.ts:926-963 仅 429 + /v1/messages，8 次封顶，abort 取消 |
| SSRF（§60） | ✅ | 上游 host 固定常量；model id 走 author/slug 分段 encodeURIComponent |
| 错误脱敏（§39） | ✅ | safeObservationError / safeError 替换 sk-or-/sk-ant-/bearer |
| 日志无 secret（§34/§35） | ✅ | 只记 authLength/authScheme |
| XSS（§20/§21） | ✅ | 生产代码无 dangerouslySetInnerHTML/eval/innerHTML |
| runtime 依赖审计（§71） | ✅ | `npm audit --omit=dev` = 0 漏洞 |
| git 历史秘密扫描（§81） | ✅ | 无真实 sk-or-/sift_sk_（仅 test fixture 与报告叙述） |

## 依赖结论（§71/§72）
- runtime（commander/react/react-dom/zod）：**0 漏洞**。
- dev-only：vite≤6.4.2（esbuild 开发服务器 advisory）、vitest、rollup ≤4.58 共 14 项（4 moderate/9 high/1 critical，全在 dev 工具链，不进发布包）。按 §72 策略**不盲升大版本**，列入 Known Issues；tarball 仅含 dist（runtime 依赖），不受影响。
