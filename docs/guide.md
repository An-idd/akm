# stillyou — the artifact management layer for AI agents

English | [中文](./README.zh-CN.md)

Your agent produces dozens of files and hundreds of conclusions every day — and forgets all of it the moment the session ends. Three weeks later you say "continue where we left off," and it re-derives everything from scratch. Fast, sure. But two things can never be bought back by re-running:

- **Consistency**: this run's methodology differs from last run's. Two reports disagree, and you don't know which one to trust
- **Verified results**: last time's conclusion was human-checked and actually shipped; the re-run produces a fresh claim with its verification bit reset to zero

stillyou gives agent outputs a management layer. Three things happen automatically, **without changing a single habit**:

```
When files are written   → auto-capture   (journal append, zero LLM, zero interference)
When the session ends    → auto-distill   (background process + debounce: deliverables,
                                            decisions with rationale, work preferences)
When a new session opens → inject your work preferences + a ledger overview
After your first message → local relevance search over the ledger, inject matching
                            history (hard token budget)
```

## Is this for you?

**Built for you** if you match "solo + heavy agent use + your outputs are your livelihood + your work is a series, not one-offs":

- **Content creators / serial writers** — when chapter 45 starts, the agent already knows the character sheets, the open foreshadowing, and why that plan was rejected last time. No re-feeding 44 chapters
- **Independent analysts / recurring research** — re-run this month's analysis next month and the numbers reconcile: the methodology lives in the ledger, not in one session's luck
- **Vibe coders** (you ship with AI but don't use git) — which file is the live version, which approach was proven dead three weeks ago: stillyou remembers (note: it records *which version is final*, it does not store file contents — it is not a backup)
- **Multi-agent / multi-model users** — what Claude Code accumulates, Codex/ZCode can query out of the box via MCP

**Not for you** if your sessions are one-off tasks (value delivered on the spot, nothing worth keeping — that's fine), chat-only consultations (no files written, nothing recorded), or a heavyweight engineering team (git + CI is already the better artifact layer; that's their home turf).

## How it differs from what you already have

| Versus | The one-line boundary |
|---|---|
| Just re-running | Re-runs can't buy back **consistency** or **verified status** — no model speed fixes two reports that disagree |
| claude-mem & memory frameworks | They record the **process** (what happened in a session); stillyou records the **results** (what assets remain, what superseded what, what's been verified) |
| CLAUDE.md / platform memory | Platforms remember *facts about you*, locked inside their own fence; stillyou records *your outputs*, in plain files you can walk away with |
| git | stillyou's territory is exactly git's blind spot: decision rationale, rejected alternatives, and outputs that never enter a repo (research, strategy, methodology) |

## Three promises

1. **Your data stays in plain files you can grep** — the ledger is a folder of markdown and jsonl. Delete stillyou and everything is still there; you lose convenience, not assets
2. **Never interfere with the host** — hooks fail silently, the write path makes zero LLM calls. If stillyou breaks, your sessions keep working
3. **Wrong provenance is worse than no provenance** — when the supersede relationship between entries is uncertain, it stays blank. No guessing, ever

## Install (< 5 minutes)

Requires [bun](https://bun.sh) and a logged-in Claude Code.

```bash
git clone https://github.com/An-idd/stillyou && cd stillyou
bun install
bun build --compile packages/cli/src/main.ts --outfile ~/.stillyou/bin/stillyou
~/.stillyou/bin/stillyou init        # pick a ledger location (default ~/Documents/stillyou-ledger) + register hooks
```

Then just work as usual. After your first file-writing session ends, run `stillyou status` — entries should appear. In your next session, the agent starts working with the relevant history already in context after your first message.

## Daily use

Most of the time you do nothing. When you want to look things up:

| Command | What it does |
|---|---|
| `stillyou search <keywords>` | Search (relevance × freshness × trust; superseded/quarantined hidden by default) |
| `stillyou get <id>` | Full entry + metadata + provenance (and reinforces the entry — use it or lose it) |
| `stillyou verify <id>` | Human endorsement: verified conclusions rank higher and never decay to zero |
| `stillyou status` | Ledger health report: entry breakdown, stale warnings, failed-distill alerts |
| `stillyou compact [--dry]` | Consolidate same-topic entries. Conservative — uncertain clusters are left alone; sources become superseded, never deleted |
| `stillyou export <session-id>` | Export a session transcript as readable markdown (`--out` to save) |
| `stillyou schedule --at 04:00` | Switch to daily batch distillation: nothing runs at session end; one scheduled batch per day (`--off` to restore realtime) |
| `stillyou distill-all` | Batch-distill every session with new writes, right now |
| `stillyou init --project` | Enable project scope in a directory: its entries won't leak into other projects' sessions |
| `stillyou rebuild` | Rebuild the index from scratch (the index is always a disposable cache) |
| `stillyou migrate` | Migrate legacy flat entry bodies into coordinate directories (`entries/self/<name>/v<N>-….md`) |
| `stillyou uninstall` | Remove the hooks. Ledger files stay untouched; run `stillyou init` to re-enable |

You can also just ask your agent — the injected context includes `stillyou search` / `stillyou get` usage, and agents use them on their own.

## What gets recorded, what doesn't

- **Recorded**: deliverables that still matter when the session ends (final docs, code, data) + conclusions/decisions (with rationale and rejected alternatives) + work preferences you've expressed. A session that leaves at least one of those leads with a session-summary entry (what happened, what came out of it); a session that leaves none — pure lookups, mechanical edits, no-decision maintenance — records nothing at all, not even a summary
- **Not recorded**: intermediate artifacts, drafts, replaced versions, chat-only sessions (sessions that write no files cost nothing and record nothing) — **capture everything, distill little; forgetting is a feature, not a bug**
- **Automatic metabolism**: new versions supersede old ones (uncertain cases coexist; entries you've verified are never auto-superseded); entries unretrieved for 30 days get demoted and flagged in `status` (staleness is computed at query time — ledger files are never rewritten); frequently used entries rank up; preference entries never decay. Files over 4MB are recorded by path without a content hash

## The longer you use it, the more it sounds like you

Short-term, stillyou lets you "pick up where you left off." Long-term, the ledger accumulates four things: your **decision patterns** (decision entries capture not just conclusions but how you repeatedly choose and what you habitually reject), your **working rules** (preferences: "just fix it, don't ask", "measure it this way"), your **verified conclusions** (separating *what you signed off on* from *what the AI said*), and your **definitions** (how you name and measure things). Together, that's a searchable, externalized copy of your judgment.

Three self-reinforcing loops drive it: preferences injected at every session start make the agent work by your rules, and its output gets distilled back (a style loop); `verify` and access-based reinforcement float the knowledge you actually use and decay what you don't — **the ledger's shape is carved by your behavior**; `compact` then crystallizes scattered judgments into stable position cards. The longer you use it, the more each new session feels like working with a colleague who knows you, not a stranger meeting you for the first time.

Honest boundary: it only sees the part of your work done with an agent, distillation is a lossy probabilistic paraphrase (which is exactly why `verify` requires your own signature), and forgetting is deliberate. It's not a digital twin — it can't answer "who are you," but it can answer "**when this kind of thing came up, how did you judge it, what did you verify, what burned you**." Which happens to be the most useful part of you for the next session.

## Where the data lives, and what it looks like

```
~/Documents/stillyou-ledger/               # truth layer; picked at init — put it in a synced folder for free multi-device
  journal/
    <session-id>.jsonl                # per-session write log (append-only)
    <session-id>.transcript.md        # distillation evidence archive (provenance survives host cleanup)
  entries/self/<name>/v<N>-<id8>.md   # conclusion/decision bodies — directories are coordinates, human-browsable
  manifests.jsonl                     # all metadata, one line per entry, git-diff friendly
~/.stillyou/                               # cache layer: config, index, access stats — rebuildable
```

One line of `manifests.jsonl` (machine-written, machine-read, human-auditable):

```json
{"id":"8e54cce1287e0f72","coords":{"namespace":"self","name":"topic-scan","version":2},
 "type":"file","status":"final","summary":"Topic scan update: direction A confirmed, C added as candidate",
 "provenance":{"host":"claude-code","session":"…","inputs":["…"]},
 "verified_by":[],"scope":"user","created":"2026-07-16T…","path":"…","content_hash":"sha256:…"}
```

The fields are the product: `coords` is a stable address (same topic iterates under the same name, version bumps), `provenance` answers "which session produced this, from what inputs," `verified_by` separates *what you checked* from *what the AI said*, `status` drives the lifecycle (draft / final / superseded / quarantined).

## Cost & privacy

- **The write path is free**: capture is a local append; no model is called
- **Distillation cost, honestly**: distillation calls haiku via `claude -p`, on your own Claude login (no API key). Trigger rule: at turn end, if the session added ≥5 file writes or 15+ minutes passed since the last distill, one background distill runs; session end always distills once. Sessions that write nothing cost nothing. A long, busy session may distill several to a dozen times a day — one haiku call each
- **Zero waiting**: hooks return in milliseconds; distillation runs in a detached background process
- **Prefer once a day?** `stillyou schedule --at 04:00` switches to daily batch mode: zero calls at session end; launchd fires once nightly and distills every session with new writes (run-and-exit, not a daemon). Trade-off: today's distillate becomes injectable tomorrow
- **Everything local**: ledger, index, and archives live on your disk; the only network call is the distillation above, on your own account
- **Archive disclosure (important)**: distillation archives a **plaintext** excerpt of the conversation into the ledger (`journal/<session>.transcript.md`) for provenance audits. If your ledger sits in a cloud-synced folder, that sync includes conversation text. Disable with `"archive_transcripts": false` in `~/.stillyou/config.json` (trade-off: provenance breaks once the host cleans up old sessions)
- **Prompt-injection status, honestly**: third-party content your agent processes (web pages, external files) flows into distillation input. Three hard defenses exist (file-path allowlist, verification bits force-cleared by the pipeline, human-verified entries never auto-superseded), but injected content is not yet fully sanitized — the threat model is limited while you're single-user on your own data, and full hardening lands before external content-pack imports ship. Don't blindly trust a distill run right after your agent processed untrusted content
- **Walk away anytime**: `stillyou uninstall` removes the hooks and leaves you a plain folder

## Cross-host (MCP)

The same ledger is readable and writable by other agents. `stillyou-mcp` exposes three tools: `stillyou_search` / `stillyou_get` / `stillyou_register` (hosts without hooks register explicitly).

```bash
bun build --compile packages/mcp/src/server.ts --outfile ~/.stillyou/bin/stillyou-mcp
```

```toml
# Codex: ~/.codex/config.toml
[mcp_servers.stillyou]
command = "/absolute/path/.stillyou/bin/stillyou-mcp"
```

Point ZCode / Cowork at the same binary in their MCP settings. Honest note: automatic distillation currently happens on the Claude Code side only (it depends on its hooks and `claude -p`); other hosts get read-everything + manual register. Decoupling the write side is on the roadmap.

## Architecture at a glance

```
L5 interface  CLI + MCP server (three tools, never more than five)
L4 assembly   hydration: scope filter × ranking × hard token budget — inject nothing rather than noise
L3 index      SQLite FTS5 (works for CJK and English), disposable & rebuildable
L2 metadata   manifests.jsonl: coordinates / provenance / lifecycle / verification
L1 storage    plain files. Artifacts never move; the ledger records path + content hash
L0 capture    hooks: PostToolUse capture / Stop+SessionEnd distill / SessionStart+UserPromptSubmit hydrate
```

The kernel makes zero assumptions about the host; all logic lives in a single `stillyou` executable and host adapters are thin shells. **Deliberately not built**: daemons (event-driven, run-and-exit), vector search (FTS + good summaries suffice until ~10k entries), accounts/sync services (the filesystem and your cloud drive are the sync layer), UI (markdown out; let the agent narrate).

Full design rationale (Chinese): [docs/2026-07-15-agent-km-产品调研与设计.md](./docs/2026-07-15-agent-km-产品调研与设计.md). A usage story (Chinese): [docs/我如何用stillyou.md](./docs/我如何用stillyou.md).

## Development

```bash
bun test                                          # golden fixtures: journal in, entries out, mocked LLM
bash scripts/e2e.sh                               # full chain: init→capture→distill→supersede→compact→export→uninstall
bun scripts/harvest.ts <session.jsonl> <outdir>   # real session → golden fixture material
bun scripts/eval.ts <session.jsonl…>              # distillation quality review: batch-distill real sessions → grading sheet
```

Distillation quality is this product's lifeline. `eval.ts` turns your real sessions into a review sheet (incrementally cached; only failures re-run). The current version passed 10/10 on ten real-session samples, reviewed by the project author (n=10, not blinded, single reviewer — stated as is; run it on your own sessions and grade it yourself).

## Roadmap

- **Write-side decoupling**: distillation provider via API key / other host CLIs, so "switch models without losing your accumulation" holds on both sides
- **P2 teams**: `stillyou sync` (git under the hood, git vocabulary hidden from creators), shared namespaces, explicit publishing
- **P3 public packs**: `.akmpack` (entries + manifests + signature), import-as-PR (quality / overlap / conflict checks; adopt / endorse / reject / quarantine)
- Full backlog (Chinese): [docs/2026-07-15-stillyou-开发计划.md](./docs/2026-07-15-stillyou-开发计划.md)

## License

MIT
