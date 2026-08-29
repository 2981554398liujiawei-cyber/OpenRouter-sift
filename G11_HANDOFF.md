# G11 交接清单（额度中断时的工作状态）

日期：2026-08-29 · HEAD：`d623ba0`（已推送 origin/main）· 工作树干净
基线 gates：111 passed / 1 skipped（live 默认禁用）· lint / build / diff-check 全 PASS

## 一、G11.1 已完成并 seal（Settings UI 管理 OpenRouter Key）

全部见前一份 G11.1 报告。核心：`src/auth/secureStore.ts`（Windows Credential Manager 本机实测）+ `src/auth/upstreamCredential.ts` + 动态 key 客户端 + `PUT/DELETE /api/settings/openrouter-key` + Settings UI。真实 key 已由用户通过 UI 配置，持久化在 Windows Credential Manager（服务名 `OpenRouterSift\upstream-openrouter-key`），任何新起的 server 实例自动继承。

## 二、本轮 live QA 已验证通过（真实 OpenRouter）

| 项 | 结果 |
|---|---|
| 目录刷新 | 396 模型，stale=false |
| Chat Completions | ✓（free 模型 Novita，content/usage 正确）|
| Chat Streaming | ✓（增量 chunk + `data: [DONE]`）|
| Responses API | ✓（granite，completed）|
| Anthropic Messages | ✓（granite "OK"）+ Messages streaming ✓ |
| Anthropic remap 防绕过 §59 | claude-* 别名按转发后模型鉴权，双 key 均 403 MODEL_NOT_ALLOWED |
| /v1/models per-key 范围 §33 | ✓ 双 key 隔离 |
| Hard Filter 实际边界 §24/§25 | mistral-nemo 5→2（deepinfra/fp8 + parasail/fp8），实际 provider=Parasail ∈ 允许集 |
| Client 不能放宽 §47 | `provider.only ["novita/fp8"]` → NO_ELIGIBLE_PROVIDER |
| Incoming ignore §48 | ignore parasail → 实际 DeepInfra |
| 零 eligible fail-closed §26 | allow 无效 tag → NO_ELIGIBLE_PROVIDER |
| Key Override §39/§40 | override allowlist [parasail/fp8] → 实际 Parasail；override 下 client 放宽被拒 |
| Disable/Delete key §35/§36 | 实时拒绝 ACCESS_KEY_DISABLED / INVALID_ACCESS_KEY，恢复正常 |
| Request observability §68-§74 | Routing Decision 全链路 trace（hardFilter→override→modelPolicy→final）、filter snapshot 时间戳、enrichment 修复后 actualProvider/tokens/cost/latency 全部来自权威元数据 |
| 隐私 §76-§78 | request store 无 prompt/response、无 sk-or-/sift_sk_ 明文，字段全元数据 |
| Codex 实机 §87-§89 | ✓ 通过 /v1/responses（codex 0.143 已弃用 chat wire，Sift 的 Responses 支持正好接上）；主请求 200 |

本阶段新增提交：`fix: poll OpenRouter's eventually-consistent generation index patiently`（enrichment 对 404 耐心轮询 ~2.7min；此前所有 live enrichment 都因 OpenRouter generation 索引最终一致性而 failed。附回归测试）。

## 三、未完成（下一步按序执行）

1. **Claude Code 实机 smoke（§90-§92）—— 进行中卡住**：`claude -p` 报 `Connection refused`，请求似乎没到 Sift（8812 无任何 records）。已试 `ANTHROPIC_BASE_URL`、`ANTHROPIC_API_KEY=sift_sk_…`、`ANTHROPIC_MODEL`、`CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1`、`--debug`（debug 输出未捕获到有用信息）。下一步排查：
   - 用 `claude --debug-to-stderr` 或 strace/netstat 抓实际连接目标（怀疑 2.1.245 对未知模型的 title/count 辅助请求走了别的 base URL 或剥离了端口）；
   - 试 `--model claude-3-5-haiku` 类别名（触发 remap → ANTHROPIC_MODEL=mistralai/mistral-nemo）；
   - 检查是否需要 `ANTHROPIC_AUTH_TOKEN`（而非 API_KEY）或 `ANTHROPIC_CUSTOM_HEADERS`；
   - 只修兼容 bug，不为它放宽权限（§89）。
2. **OpenCode 实机 smoke（§93-§94）**：本机未安装 opencode，需先安装。
3. **Cursor（§95）**：未做，可列 P1 manual。
4. **Responses Streaming 实测（§56）**：codex 的流式请求已打到 Sift（一条 200 一条 502-上游透传），但未单独用 curl 验证 Responses 流式 chunk 顺序。
5. **持久化重启完整矩阵（§82）**：live QA 隔离 server 重启过两次（desired/filter/key/settings 均恢复、key 从凭据库继承），但没有专门跑完整 §82 清单盖章；隔离数据目录 `.tmp/g11live/` 已清理，重测需重建（models/key 可用mistral-nemo + granite + 一个 free 模型复刻）。
6. **G11 Seal 报告（§181 格式）**：所有 live gates 拿到结果后按模板输出正式报告；§180 清单逐项勾选；之后才进 G12。
7. **顺手项**：G11 live 用的假 key 仓库无残留；`.tmp/` 已清理；桌面快捷方式（`OpenRouter Sift.lnk/.bat`，端口 8788）已交付。

## 四、环境备忘

- 用户真实 key：存于 Windows Credential Manager（不要读取/打印/导出）；headless 自动化 smoke 仍走 `OPENROUTER_API_KEY` env（§60）。
- 用户日常服务：桌面快捷方式启动，端口 **8788**（8787 被其它程序占用）。
- 上游注意：Google 系模型在本地区域被拒（403 region），free 模型与 parasail/deepinfra 偶发 429 —— 均为环境因素（§148/§149），不要当作项目 bug。
- 便宜的实测模型：`mistralai/mistral-nemo`（$0.019/M，5 providers，Hard Filter 首选）、`ibm-granite/granite-4.0-h-micro`（$0.017/M）、`inclusionai/ling-3.0-flash-fin:free`。
