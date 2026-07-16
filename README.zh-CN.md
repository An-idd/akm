# akm — Agent 产出物管理层

[English](./README.md) | 中文

你的 Agent 每天产出几十个文件和上百个结论，会话一关全部失忆。三周后你让它"接着上次做"，它重新推导一遍——快是快，但两样东西重跑买不回来：

- **一致性**：这次的口径和上次不一样，两份数字打架，你不知道信哪份
- **已验证**：上次的结论你人工核实过、真交付过；重跑出来的是验证位归零的新东西

akm 给 Agent 产出物一个管理层，三件事全自动，**不改变任何使用习惯**：

```
写文件时     → 自动登记   （journal 流水，零 LLM、零打扰）
会话收尾时   → 自动蒸馏   （后台进程 + 防抖，提炼交付物、决策及理由、工作偏好）
新会话开场   → 注入你的工作偏好 + 账本导览
你发第一条消息后 → 按消息内容做本地相关性检索，注入相关历史条目（token 硬预算）
```

## 适不适合你

**为你而做**，如果你符合"一个人 + 高频 Agent 使用 + 产出物就是生计 + 任务是连载不是单集"：

- **内容创作者 / 连载作者**——写第 45 章时，Agent 已经知道人物设定、待收伏笔、上次为什么否掉那个方案，不用再喂前 44 章
- **独立分析师 / 周期性调研**——下个月重跑这份分析，数字和这个月对得上：口径记在账本里，不在某次会话的运气里
- **vibe coder**（会让 AI 写代码、不会用 git）——哪个文件是现役版本、哪条路三周前试过走不通，akm 替你记（注意：它记"哪版是最终版"，不存文件内容，不是备份）
- **多 Agent / 多模型用户**——Claude Code 里的沉淀，Codex/ZCode 经 MCP 开箱可查

**不适合你**，如果你的会话都是一次性任务（价值当场兑现，本来就不需要留下什么）、纯聊天咨询（不写文件就零入账），或者你是重代码工程团队（git + CI 已经是更好的产出物层，那是它们的主场）。

## 和已有工具的分界

| 对比 | 一句话分界 |
|---|---|
| 重跑一遍 | 重跑买不回**口径一致性**和**已验证状态**——模型再快也解决不了两份数字打架 |
| claude-mem 等记忆框架 | 它们记**过程**（会话里发生了什么），akm 记**结果**（留下了什么资产、被哪版取代、验证过没有） |
| CLAUDE.md / 平台记忆 | 平台记"关于你的事实"且锁在自家围栏内；akm 记"你的产出物"且是你能带走的普通文件 |
| git | akm 的地盘精确等于 git 的盲区：决策理由、否掉的方案、不进仓库的产出物（调研、策略、口径） |

## 三个承诺

1. **数据永远是你能 grep 的普通文件**——账本就是一个装满 markdown 和 jsonl 的文件夹。删掉 akm，数据原样还在，损失的只是便利，不是资产
2. **不打扰宿主**——hook 静默失败、写入路径零 LLM 调用；akm 出任何问题，你的会话照常工作
3. **错误的溯源比没有溯源更害人**——新旧条目的取代关系拿不准就留空，绝不瞎猜

## 安装（<5 分钟）

需要 [bun](https://bun.sh) 和已登录的 Claude Code。

```bash
git clone https://github.com/An-idd/akm && cd akm
bun install
bun build --compile packages/cli/src/main.ts --outfile ~/.akm/bin/akm
~/.akm/bin/akm init        # 选账本位置（默认 ~/Documents/akm-ledger）+ 注册 hooks
```

装完照常干活。第一个写过文件的会话结束后跑 `akm status`，应能看到条目入账；下一个新会话，你发出第一条消息后 Agent 会带着相关历史开工。

## 日常使用

多数时候你什么都不用做。需要主动查的时候：

| 命令 | 作用 |
|---|---|
| `akm search <关键词>` | 检索（相关性 × 新鲜度 × 可信度排序，已取代的默认不出现） |
| `akm get <id>` | 条目全文 + 元数据 + 溯源（并强化该条目——用进废退） |
| `akm verify <id>` | 人工背书：你核实过的结论排序上浮、不被时间衰减清零 |
| `akm status` | 账本健康报表：条目分布、stale 提醒、蒸馏失败警告 |
| `akm compact [--dry]` | 压实：合并同主题条目。保守派——拿不准不动，来源转 superseded 不删 |
| `akm export <会话id>` | 把一次会话记录导出成可读 markdown（`--out` 存文件） |
| `akm init --project` | 在项目目录启用作用域：该项目的条目不泄漏进其他项目的会话 |
| `akm rebuild` | 全量重建索引（索引永远是可丢弃的缓存） |
| `akm migrate` | 旧扁平正文迁移到坐标目录（`entries/self/<name>/v<N>-….md`，人可导航） |
| `akm uninstall` | 摘除 hooks。账本文件原样保留，重新启用再跑 `akm init` |

会话中也可以直接让 Agent 帮你查：水合注入的开场提示里带着 `akm search` / `akm get` 的用法，Agent 自己会用。

## 什么会入账，什么不会

- **入账**：会话结束时仍然要紧的交付物（最终文档、代码、数据）+ 结论/决策（含理由和否掉的方案）+ 你表达过的工作偏好。第一条永远是"本会话做了什么、结果如何"的会话总结
- **不入账**：中间产物、草稿、被替换的版本、纯聊天会话（没写文件的会话零开销零入账）——**登记所有，蒸馏少数；遗忘是功能不是缺陷**
- **自动代谢**：新版本取代旧版本（拿不准就并存）；30 天没被检索的条目自动降权并在 status 里提醒；被反复使用的条目排名强化；偏好类条目不衰减

## 数据放哪，长什么样

```
~/Documents/akm-ledger/               # 真相层。init 时自选，放网盘同步文件夹=免费多设备
  journal/
    <会话id>.jsonl                    # 每会话的文件写入流水（append-only）
    <会话id>.transcript.md            # 蒸馏依据归档（宿主清理旧会话后，溯源不断链）
  entries/self/<name>/v<N>-<id8>.md   # 结论/决策正文，目录即坐标，人可导航
  manifests.jsonl                     # 全部元数据，一行一条，git diff 友好
~/.akm/                               # 缓存层：config、索引、访问统计——删了可重建
```

`manifests.jsonl` 里的一条长这样（机器写、机器读、人可审计）：

```json
{"id":"8e54cce1287e0f72","coords":{"namespace":"self","name":"topic-scan","version":2},
 "type":"file","status":"final","summary":"选题扫描增量更新：方向A确认，新增方向C候选",
 "provenance":{"host":"claude-code","session":"…","inputs":["…"]},
 "verified_by":[],"scope":"user","created":"2026-07-16T…","path":"…","content_hash":"sha256:…"}
```

字段就是产品：`coords` 是稳定坐标（同主题迭代同名升版本）、`provenance` 回答"哪次会话基于什么产出的"、`verified_by` 区分"你核实过的"和"AI 说的"、`status` 管生命周期（draft / final / superseded / quarantined）。

## 成本与隐私

- **写入路径零成本**：登记是纯本地追加，不调用任何模型
- **蒸馏成本（如实说）**：蒸馏经 `claude -p` 调 haiku，走你自己的 Claude 登录（无需 API key）。触发规则：回合结束时，若该会话新增写入 ≥5 个文件、或距上次蒸馏超过 15 分钟，后台蒸馏一次；会话结束必蒸一次收尾。没写文件的会话零调用。长的活跃会话一天可能蒸馏几次到十几次，每次为 haiku 一次调用
- **不占你的时间**：hook 本体毫秒级返回，蒸馏在脱离的后台进程里跑——会话收尾零等待
- **全部本地**：账本、索引、归档都在你的磁盘上；唯一的网络调用就是上面那次蒸馏，走你自己的账号
- **归档披露（重要）**：蒸馏时会把会话对话摘录**明文**归档进账本（`journal/<会话>.transcript.md`），用于溯源审计。如果账本放网盘同步文件夹，同步的就包含对话原文。不想归档可在 `~/.akm/config.json` 设 `"archive_transcripts": false`（代价：宿主清理旧会话后溯源断链）
- **随时全身而退**：`akm uninstall` 摘 hooks，剩下一个普通文件夹

## 跨宿主（MCP）

同一本账本，其他 Agent 也能读写。`akm-mcp` 提供三个工具：`akm_search` / `akm_get` / `akm_register`（无 hook 的宿主用 register 显式登记）。

```bash
bun build --compile packages/mcp/src/server.ts --outfile ~/.akm/bin/akm-mcp
```

```toml
# Codex: ~/.codex/config.toml
[mcp_servers.akm]
command = "/绝对路径/.akm/bin/akm-mcp"
```

ZCode 与 Cowork 在各自的 MCP 设置里指向同一个二进制即可。如实说明：自动蒸馏目前只在 Claude Code 侧发生（依赖其 hooks 与 `claude -p`），其他宿主是"开箱可读 + 手动登记"——写入侧解耦在路线图上。

## 架构速览

```
L5 接口   CLI + MCP server（三个工具，永远不超过五个）
L4 装配   水合：scope 过滤 × 排序 × token 硬预算，宁可不注入不可注入垃圾
L3 索引   SQLite FTS5（中英文均可检索），可丢弃可重建
L2 元数据 manifests.jsonl：坐标/溯源/生命周期/验证位
L1 存储   普通文件。产出物永不搬家，账本只记路径+内容哈希
L0 捕获   hooks：PostToolUse 登记 / Stop+SessionEnd 蒸馏 / SessionStart+UserPromptSubmit 水合
```

内核对宿主零假设，全部逻辑在单一可执行 `akm` 里，宿主适配都是薄壳。**有意不做**：守护进程（事件驱动，跑完即退）、向量检索（FTS + 好摘要够用，条目过万再议）、自有账号系统（文件系统和网盘就是同步层）、UI（输出 markdown，报告让 Agent 转述）。

设计推演全文见 [docs/2026-07-15-agent-km-产品调研与设计.md](./docs/2026-07-15-agent-km-产品调研与设计.md)，使用故事见 [docs/我如何用akm.md](./docs/我如何用akm.md)。

## 开发

```bash
bun test                                      # golden 夹具：journal 进、entries 出、mock LLM
bash scripts/e2e.sh                           # 全链路：init→capture→distill→取代→compact→export→uninstall
bun scripts/harvest.ts <会话jsonl> <outdir>   # 真实会话 → golden 夹具素材
bun scripts/eval.ts <会话jsonl…>              # 蒸馏质量评审：真实会话批量蒸馏 → 人工打分表
```

蒸馏质量是这个产品的命门。`eval.ts` 会把你的真实会话跑成一张评审表（增量缓存，只重蒸失败的）。当前版本在 10 个真实会话样本上由项目作者本人评审通过 10/10（n=10、非盲评、无第二评审人——如实交代，欢迎你用自己的会话跑一遍打分）。

## 路线图

- **写入侧解耦**：蒸馏 provider 支持 API key / 其他宿主 CLI，让"换模型不丢积累"两侧对称
- **P2 团队**：`akm sync`（git 底座、对创作者隐藏 git 词汇）、共享 namespace、显式发布
- **P3 公开包**：`.akmpack`（entries + manifests + 签名）、导入即 PR（包内质量/重叠/冲突三检，采纳/背书/拒绝/隔离四态）
- 完整 backlog 见[开发计划](./docs/2026-07-15-akm-开发计划.md)

## License

MIT
