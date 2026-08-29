# G11 — Real Integration & Release QA · Seal 报告

日期：2026-08-29 · HEAD：`b3d7ad3`（已推送 origin/main）· 工作树干净
基线 gates：**114 passed / 1 skipped**（live 默认禁用）· lint PASS · build PASS · git diff --check PASS

## 一、Commit 清单（本轮）

| SHA | 说明 |
|---|---|
| `4d039f2` | fix: isolate spawned servers from persisted upstream key and runtime store residue（真实 bug：测试进程被本机凭据库真实 key 与项目根运行时 settings 文件污染，导致 4 个测试在装有真实凭据的机器上失败） |
| `b3d7ad3` | fix: re-queue pending generation enrichment after server restart（真实 bug：enrichment 队列为内存态，重启后 pending 记录永不解析；构造时重排队 + 恢复模式快速失败。附 2 条回归测试） |

## 二、live QA 全量结果（真实 OpenRouter，真实 key 来自 Windows Credential Manager）

| 项 | 结果 | 验证来源 |
|---|---|---|
| 目录刷新 | 396 模型，stale=false | 本会话隔离实例 |
| Chat Completions | ✓ content/usage 正确 | 本会话 curl + opencode |
| Chat Streaming | ✓ 增量 chunk + `data: [DONE]` | 本会话（含 tools+stream 200 流式，provider=Io Net） |
| Responses API | ✓ completed | 本会话 + handoff |
| **Responses Streaming §56** | ✓ 事件顺序完整：created → in_progress → output_item.added → content_part.added → delta×8 → output_text.done → content_part.done → output_item.done → completed，`data: [DONE]` 收尾，usage/cost 齐全 | **本会话 curl 实测** |
| Anthropic Messages | ✓ "OK" + Messages streaming ✓ | 本会话 curl + claude 实机 |
| Anthropic remap 防绕过 §59 | claude-* 别名按转发后模型鉴权，双 key 均 403 MODEL_NOT_ALLOWED | handoff 已 seal |
| /v1/models per-key 范围 §33 | ✓ 带 key 返回允许模型列表（1 项），无 key 返回全量 396 | 本会话实测 |
| Hard Filter 实际边界 §24/§25 | mistral-nemo 5→2，实际 provider ∈ 允许集 | handoff 已 seal |
| Client 不能放宽 / Incoming ignore / 零 eligible fail-closed §26/§47/§48 | ✓ 均按预期 403/404 fail-closed（本会话亦复现 allow 无效 tag → 404） | handoff + 本会话 |
| Key Override §39/§40 | ✓ allowlist override → 实际对应 provider | handoff 已 seal |
| Disable/Delete key §35/§36 | ✓ ACCESS_KEY_DISABLED / INVALID_ACCESS_KEY 实时拒绝 | handoff 已 seal |
| Request observability §68-§74 | 全链路 trace + enrichment（actualProvider/tokens/cost/latency 权威元数据） | 本会话：claude/opencode 请求均 success，Io Net / 27545→1 tokens / cost / latency 齐全 |
| 隐私 §76-§78 | request store 无 prompt/response、无 sk-or-/sift_sk_ 明文 | handoff + 既有测试持续覆盖 |
| **Codex 实机 §87-§89** | ✓ /v1/responses 200 | handoff 已 seal |
| **Claude Code 实机 §90-§92** | ✓ `claude -p` 输出 "OK"（mistralai/mistral-nemo，ANTHROPIC_AUTH_TOKEN=本地 key） | **本会话解锁并验证** |
| **OpenCode 实机 §93-§94** | ✓ `opencode run` 输出 "OK"（sift/mistralai/mistral-nemo → 实际发 mistralai/mistral-nemo） | **本会话安装并验证** |
| **持久化重启矩阵 §82** | ✓ desired×2 / keys×3 / settings(merge, ttl=360000, limit=500, interval=120000) / model policy(allowlist) / requests×8 / 上游 key（凭据库继承）/ catalog(396) 全部恢复，key 重启后推理 200 | **本会话完整矩阵** |

## 三、本会话新增发现与修复

1. **测试环境隔离（4d039f2）**：`~/.claude/settings.json` 之外，测试还受两类本机状态污染——Windows Credential Manager 中的真实上游 key（优先级高于 env）与项目根 `openrouter-control-settings.json`（默认 store 路径，live server 运行残留，会覆盖测试设置的 `cfg.policy`）。修复：`NoopSecureStore` 导出供测试注入 + 相关测试显式设置 temp `settings_store_path`（与 upstream-key-management 测试既有规范一致）。这是运行套件绿的前提，也是"真实环境回归"发现的真实问题。
2. **enrichment 重启恢复（b3d7ad3）**：重启后 pending 记录不再卡死；重排队 + 恢复模式（旧 generation 快速失败，不重复 2.7min 轮询）。
3. **Claude Code 卡点根因**：`~/.claude/settings.json`（用户级）残留 `ANTHROPIC_BASE_URL=http://127.0.0.1:15721`（死端口）+ `ANTHROPIC_AUTH_TOKEN=PROXY_MANAGED`，且 claude 的 settings.json env 覆盖进程环境变量 → 请求根本到不了 Sift。另：granite-h-micro 无 tool 端点 → OpenRouter 404。**均为环境/配置问题，Sift 零代码改动**；用项目级 `.claude/settings.json` 覆盖（优先级高于用户级）完成验证。
4. **OpenCode 接入方式**：opencode 1.18 模型 id 格式为 `provider/model`，非 OpenAI 模型须在 `opencode.json` 的 provider.models 中注册（`sift/mistralai/mistral-nemo` → 实际发送 `mistralai/mistral-nemo`）。Sift 侧无改动。
5. **Sidebar P1（上一阶段遗留）**：`OpenRouter Connected` 文案已在 G11.1 落地为 `Metadata OK / Metadata issue / Key configured / API key needed` 四态（含测试），本会话核实无需再改。

## 四、§180 验收清单

- [x] Main navigation unified（G10，5 项侧边栏）
- [x] Page header system unified（PageHeader 组件）
- [x] Status badges unified（Badge 组件 5 变体）
- [x] Tables visually consistent（.num 右对齐、空值 —、统一 header/padding）
- [x] All Models polished（二级 filters + chips + URL state）
- [x] Desired Models operational state clear（Available/Disabled + filters/keys 计数）
- [x] Provider Filters editor easy to understand（左右布局 + live result + excluded 折叠）
- [x] API Keys flow clear（create/secret once/Provider Access）
- [x] Provider Access flow clear（模式解释 + summary + preview）
- [x] Requests routing trace readable（Overview/Routing Decision/Usage/Error 结构化）
- [x] Settings grouped logically（OpenRouter/Metadata/Routing/Observability）
- [x] Empty states actionable（Browse All Models / Create API Key / No requests）
- [x] Loading/error patterns consistent
- [x] Dark mode readable（单一 media query + tokens）
- [x] keyboard/basic accessibility（labels、tabs aria、dialog role、focus-visible）
- [x] no routing/data-plane behavior changed（G10/G11 均未改数据面；本会话仅 observability 队列修复）
- [x] all tests PASS（114 passed / 1 skipped）
- [x] lint / build / diff-check PASS

## 五、Known Issues（真实剩余问题）

1. **Cursor（§95）**：未实测，列 **P1 manual**（本机需人工安装 Cursor 后用同一本地 key 验证）。
2. **1440/1024/768 真实浏览器 QA**：本机未跑 Playwright 截图验收；G10 阶段以 jsdom 交互测试 + production build + CSS 断点审查替代。建议人工用桌面快捷方式服务过一遍三档宽度。
3. **`~/.claude/settings.json` 残留**：`ANTHROPIC_BASE_URL=http://127.0.0.1:15721`（死端口）与 `ANTHROPIC_AUTH_TOKEN=PROXY_MANAGED` 是用户级配置，由其它工具写入且当前端口无监听。Claude Code 用户级生效需自行修正（指向 8788 的 Sift 或删除该 env）；Sift 不代改用户全局配置。
4. **上游环境因素（非 bug）**：Google 系模型本地区域 403；free 模型与 parasail/deepinfra 偶发 429；granite-h-micro 全部端点无 tools（Claude Code 不可用，须选 mistral-nemo 等 tools 端点模型）。
5. **enrichment 恢复模式**：重启恢复的旧记录若 generation 在 OpenRouter 索引中已不可得，会在几次快速重试后标 `failed`（不再无限 pending），属预期行为。

## 六、环境备忘

- 真实 key 在 Windows Credential Manager（服务名 `OpenRouterSift\upstream-openrouter-key`），任何新起 server 自动继承；本报告不包含也不引用明文。
- 用户日常服务：桌面快捷方式（OpenRouter Sift.lnk/.bat，端口 8788，8787 被占用）。
- 便宜实测模型：`mistralai/mistral-nemo`（5 端点、含 2 个 tools 端点，Claude Code/OpenCode 首选）、`ibm-granite/granite-4.0-h-micro`（1 端点无 tools，仅非工具调用）、`inclusionai/ling-3.0-flash-fin:free`。
- 本会话测试产物（.tmp/g11cont、.tmp/opencode、.tmp/claude-smoke）已清理；测试 server（8812）已停止；fake key 无仓库残留。
