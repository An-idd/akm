#!/usr/bin/env bun
// MCP 适配器：GUI 宿主（Codex/Cowork/ZCode）唯一的扩展点。
// 三个工具封住全部读写面，不超过五个——接口保持最小且标准。
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendManifests,
  Entry,
  entryBodyAbsPath,
  entryId,
  loadConfig,
  readManifests,
  rebuildIndex,
  recordAccess,
  search,
  writeEntryBody,
} from "@akm/core";

const config = loadConfig();
if (!config) {
  console.error("akm 未初始化：先在终端跑 `akm init`");
  process.exit(1);
}
const ledger = config.ledger;

const server = new McpServer({ name: "akm", version: "0.1.0" });

server.tool(
  "akm_search",
  "检索历史产出物账本（跨 Agent 共享）。返回条目坐标+摘要，按相关性×新鲜度×可信度排序，已取代的默认过滤。",
  { query: z.string().describe("关键词，中英文均可"), limit: z.number().int().positive().max(50).default(10) },
  async ({ query, limit }) => {
    const hits = search({ query, limit, staleDays: config.stale_days });
    const text = hits.length
      ? hits
          .map(
            (h) =>
              `- [${h.id}] ${h.name}@v${h.version} (${h.type}/${h.status}${h.stale ? "/stale" : ""}, ${h.created.slice(0, 10)}) ${h.summary}`,
          )
          .join("\n") + "\n\n用 akm_get 取全文与溯源。"
      : "（无结果）";
    return { content: [{ type: "text", text }] };
  },
);

server.tool(
  "akm_get",
  "取单个条目的全文、元数据与溯源（会记一次访问，强化该条目）。",
  { id: z.string().describe("条目 id（akm_search 返回的方括号内哈希）") },
  async ({ id }) => {
    const entry = readManifests(ledger).get(id);
    if (!entry) return { content: [{ type: "text", text: `条目不存在: ${id}` }] };
    recordAccess(id);
    let text = JSON.stringify(entry, null, 2);
    const bodyPath = entryBodyAbsPath(ledger, entry);
    if (existsSync(bodyPath)) text += `\n\n## 正文\n${readFileSync(bodyPath, "utf8")}`;
    if (entry.path) {
      text += `\n\n## 文件\n${entry.path}${existsSync(entry.path) ? "（存在）" : "（原路径已不存在）"}`;
    }
    return { content: [{ type: "text", text }] };
  },
);

server.tool(
  "akm_register",
  "把一个交付物或结论登记进账本（无 hook 的宿主用这个显式登记）。同名条目自动升版本。",
  {
    type: z.enum(["file", "conclusion", "decision"]),
    name: z.string().describe("kebab-case 英文坐标名，同主题复用同名"),
    summary: z.string().describe("给机器的检索键：这是什么、结论是什么"),
    path: z.string().optional().describe("file 型：文件绝对路径"),
    body: z.string().optional().describe("conclusion/decision 型：完整结论及理由"),
    host: z.string().default("mcp").describe("来源宿主，如 codex / cowork / zcode"),
  },
  async ({ type, name, summary, path, body, host }) => {
    // 同名旧条目只升版本不判取代——MCP 侧无 LLM，拿不准留空
    let version = 1;
    for (const e of readManifests(ledger).values()) {
      if (e.coords.name === name && e.coords.namespace === "self" && e.status !== "superseded") {
        version = Math.max(version, e.coords.version + 1);
      }
    }
    const base = { coords: { namespace: "self", name, version }, type, summary, path, content_hash: undefined };
    const entry = Entry.parse({
      ...base,
      id: entryId(base),
      status: "final",
      provenance: { host, session: "mcp-register", inputs: [] },
      verified_by: [],
      scope: "user",
      created: new Date().toISOString(),
    });
    const withBody = body ? writeEntryBody(ledger, entry, body) : entry;
    appendManifests(ledger, [withBody]);
    rebuildIndex(ledger);
    return { content: [{ type: "text", text: `已登记 [${entry.id}] self/${name}@v${version}` }] };
  },
);

await server.connect(new StdioServerTransport());
