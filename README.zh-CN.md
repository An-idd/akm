# stillyou

[English](./README.md) | 中文

**记忆工具帮 Agent 记住它做过什么；stillyou 记住你决定了什么、交付了什么。**

> 蒸馏千百个会话，剩下的，依然是你。（still = 蒸馏器；still you = 依然是你）

每个会话都以失忆收场：交付物、决策、否掉的方案、定好的口径——全没了。stillyou 自动把它们留下来，交给你的下一个会话。

```console
$ claude
> 继续上次的 AI 视频工具选型

⏺ 你的账本里有相关历史：
  [5802983d] video-tool-pricing-comparison@v1 (file/final, verified)
  上次结论：按每秒成本算可灵最划算（¥66/月 ≈ 66 秒）。
  基于该口径做增量对比，不重新推导……
```

*全新会话、零重新解释。这个回答引用的是三周前会话蒸馏出的账本条目——同一套口径，人工验证过的结论。*

## 安装（30 秒）

```bash
curl -fsSL https://raw.githubusercontent.com/An-idd/stillyou/main/install.sh | sh
~/.stillyou/bin/stillyou init        # 选账本位置 + 注册 Claude Code hooks，完成
```

Claude Code 开箱即用；Codex / ZCode / Cowork 经 [MCP](./docs/指南.md#跨宿主mcp) 读同一本账本。从源码构建需要 [bun](https://bun.sh)：`bun install && bun build --compile packages/cli/src/main.ts --outfile ~/.stillyou/bin/stillyou`。

## 你真正会用到的五个命令

| | |
|---|---|
| `stillyou search <关键词>` | 找历史结论、文件、口径（已取代的版本默认不出现） |
| `stillyou get <id>` | 条目全文 + 溯源：哪次会话、基于什么输入、为什么 |
| `stillyou verify <id>` | 背书你核实过的结论——排序上浮、永不衰减清零 |
| `stillyou status` | 账本健康：条目分布、过期提醒、蒸馏失败警告 |
| `stillyou schedule --at 04:00` | 不想每会话蒸馏？切成每天凌晨一次批处理 |

其余全自动：hook 零成本登记每次文件写入，会话在后台进程里蒸馏，每个新会话的第一条消息会按内容拉取相关历史（token 硬预算）。

## 和已有工具的分界

| 对比 | 一句话分界 |
|---|---|
| 重跑一遍 | 重跑买不回**口径一致性**和**已验证状态**——模型再快也解决不了两份数字打架 |
| claude-mem 等记忆框架 | 它们记**过程**（发生了什么），stillyou 记**结果**（留下了什么、被哪版取代、验证过没有） |
| CLAUDE.md / 平台记忆 | 平台记"关于你的事实"且锁在自家围栏内；stillyou 记"你的产出物"且是你能带走的普通文件 |
| git | stillyou 的地盘是 git 的盲区：决策理由、否掉的方案、不进仓库的产出物 |

**为这些人而做**：独立创作者、连载作者、分析师、vibe coder——工作是连载不是单集、产出物不在 git 里的人。**不适合**：一次性任务、纯聊天、重代码工程团队（git + CI 是他们的主场）。

三个承诺：数据永远是你能 grep 的 markdown + jsonl（删掉 stillyou，一切还在）；hook 永不阻塞或搞坏你的会话；溯源拿不准就留空，绝不瞎猜。

## 深入了解

- **[完整指南](./docs/指南.md)**——数据格式、成本与隐私（账本放网盘前必读）、作用域、MCP、架构、路线图
- [设计推演全文](./docs/2026-07-15-agent-km-产品调研与设计.md) · [使用故事](./docs/我如何用stillyou.md)
- [长期这件事：判断力外置](./docs/指南.md#用得越久越像你)——用上几个月后，账本会变成什么

MIT © An-idd
