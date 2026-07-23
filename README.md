# stillyou

English | [中文](./README.zh-CN.md)

**Memory tools remember what your agent did. stillyou remembers what *you* decided — and what actually shipped.**

> Your agent forgets. What remains is *still you*. — distill yourself, one session at a time.

Every session ends in amnesia: the deliverables, the decisions, the rejected alternatives, the methodology you settled on — gone. stillyou captures them automatically and hands them to your next session.

```console
$ claude
> Continue the AI video tool comparison from last time

⏺ Your ledger has relevant history:
  [5802983d] video-tool-pricing-comparison@v1 (file/final, verified)
  Last conclusion: Kling wins on cost-per-second (¥66/mo ≈ 66s of video).
  Building the incremental comparison on that methodology — not re-deriving it...
```

*A fresh session, zero re-explaining. That answer cites a ledger entry distilled from a session three weeks ago — same methodology, human-verified conclusion.*

## Install (30 seconds)

```bash
curl -fsSL https://raw.githubusercontent.com/An-idd/stillyou/main/install.sh | sh
~/.stillyou/bin/stillyou init        # pick a ledger location + register Claude Code hooks — done
```

Works with Claude Code today; Codex / ZCode / Cowork read the same ledger via [MCP](./docs/guide.md#cross-host-mcp). Building from source needs [bun](https://bun.sh): `bun install && bun build --compile packages/cli/src/main.ts --outfile ~/.stillyou/bin/stillyou`.

## The five commands you'll actually use

| | |
|---|---|
| `stillyou search <keywords>` | find past conclusions, files, methodology (superseded versions hidden) |
| `stillyou get <id>` | full entry + provenance: which session, from what inputs, why |
| `stillyou verify <id>` | endorse what you've checked — it ranks up and never decays to zero |
| `stillyou status` | ledger health: entry breakdown, stale warnings, failed-distill alerts |
| `stillyou schedule --at 04:00` | prefer one nightly batch over per-session distillation |

Everything else is automatic: writes are journaled by hooks (zero LLM), sessions distill in a detached background process, and your first message each session pulls in relevant history under a hard token budget.

## How it differs from what you already have

| Versus | The one-line boundary |
|---|---|
| Just re-running | Re-runs can't buy back **consistency** or **verified status** — no model speed fixes two reports that disagree |
| claude-mem & memory frameworks | They record the **process** (what happened); stillyou records the **results** (what remains, what superseded what, what's verified) |
| CLAUDE.md / platform memory | Platforms remember *facts about you*, locked in their fence; stillyou records *your outputs*, in plain files you can walk away with |
| git | stillyou's territory is git's blind spot: decision rationale, rejected alternatives, outputs that never enter a repo |

**Built for**: solo creators, serial writers, analysts, vibe coders — anyone whose work is a series, not one-offs, and whose outputs live outside git. **Not for**: one-off tasks, chat-only use, heavyweight engineering teams (git + CI is their home turf).

Three promises: your data stays in plain markdown + jsonl you can grep (delete stillyou, keep everything); hooks never block or break your sessions; uncertain provenance stays blank — no guessing, ever.

## Learn more

- **[Full guide](./docs/guide.md)** — data format, cost & privacy (read this before cloud-syncing the ledger), scopes, MCP, architecture, roadmap
- [Design rationale](./docs/2026-07-15-agent-km-产品调研与设计.md) (Chinese) · [A usage story](./docs/我如何用stillyou.md) (Chinese)
- [The long game: externalized judgment](./docs/guide.md#the-longer-you-use-it-the-more-it-sounds-like-you) — what the ledger becomes after months of use

MIT © An-idd
