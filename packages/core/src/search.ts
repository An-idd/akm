import { Database } from "bun:sqlite";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { CACHE_DIR, entryBodyAbsPath, readManifests } from "./ledger";
import { Entry } from "./schema";

export const INDEX_PATH = join(CACHE_DIR, "index.db");

// 索引永远是缓存：删掉 index.db，rebuild 后结果一致。
// stats 表也住这里——热数据分家，丢了只影响遗忘精度，可容忍。
// 进程内单例：MCP 是长驻进程，每查询开新连接会泄漏 fd
let _db: Database | null = null;
export function openDb(): Database {
  if (_db) return _db;
  mkdirSync(CACHE_DIR, { recursive: true });
  _db = new Database(INDEX_PATH);
  _db.exec(`CREATE TABLE IF NOT EXISTS stats (
    id TEXT PRIMARY KEY, last_accessed TEXT, access_count INTEGER DEFAULT 0
  )`);
  return _db;
}

// ponytail: 每次全量重建，个人账本万条以内毫秒级；增量等真实变慢再做
export function rebuildIndex(ledger: string, db = openDb()): number {
  db.exec(`DROP TABLE IF EXISTS entries_fts`);
  // trigram：中英文都可 LIKE/MATCH；2 字中文词走 LIKE 兜底
  // body 也入索引：粒度收紧后细节住正文，不索引就搜不到
  db.exec(`CREATE VIRTUAL TABLE entries_fts USING fts5(
    id UNINDEXED, name, summary, body,
    type UNINDEXED, status UNINDEXED, scope UNINDEXED, project UNINDEXED,
    created UNINDEXED, verified UNINDEXED, path UNINDEXED, version UNINDEXED,
    tokenize='trigram'
  )`);
  const insert = db.prepare(
    `INSERT INTO entries_fts (id,name,summary,body,type,status,scope,project,created,verified,path,version)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const entries = readManifests(ledger);
  // 正文读取尽力而为：单文件不可读（权限/损坏）只丢该文件的正文召回，不废整个索引
  const bodyOf = (e: Entry): string => {
    try {
      const p = entryBodyAbsPath(ledger, e);
      return existsSync(p) ? readFileSync(p, "utf8") : "";
    } catch {
      return "";
    }
  };
  for (const e of entries.values()) {
    insert.run(
      e.id, e.coords.name, e.summary,
      bodyOf(e),
      e.type, e.status, e.scope,
      e.project ?? "", e.created, e.verified_by.length, e.path ?? "", e.coords.version,
    );
  }
  return entries.size;
}

export interface SearchHit {
  id: string;
  name: string;
  summary: string;
  type: string;
  status: string;
  scope: string;
  project: string;
  created: string;
  verified: number;
  path: string;
  version: number;
  score: number;
  stale: boolean;
}

export interface SearchOpts {
  query?: string; // 关键词（空格分词 AND 语义）；空 = 纯新鲜度×可信度排序
  anyTokens?: string[]; // 自然语句检索：token 命中任一即候选（OR 语义），bm25 按命中程度排序
  project?: string; // 当前项目：user 级 + 本项目条目可见，他项目不可见
  includeSuperseded?: boolean;
  limit?: number;
  now?: Date;
  staleDays?: number;
}

// 自然语句 → 检索 token：CJK 拆三元组 + 英文词，供 anyTokens 用（整句短语匹配永远命不中）
export function promptToTokens(prompt: string, max = 24): string[] {
  const tokens = new Set<string>();
  for (const word of prompt.replace(/[\s\p{P}]+/gu, " ").split(" ")) {
    if (!word) continue;
    if (/^[\w-]+$/.test(word)) {
      if (word.length >= 3) tokens.add(word.toLowerCase());
      continue;
    }
    const chars = [...word];
    if (chars.length < 3) {
      if (chars.length === 2) tokens.add(word);
      continue;
    }
    for (let i = 0; i + 3 <= chars.length; i++) tokens.add(chars.slice(i, i + 3).join(""));
  }
  return [...tokens].slice(0, max);
}

export function search(opts: SearchOpts, db = openDb()): SearchHit[] {
  const { query, project, includeSuperseded = false, limit = 10, staleDays = 30 } = opts;
  const now = opts.now ?? new Date();
  let rows: any[]; // FTS5 行是动态列，每处赋值都已 as any[]——收窄到 Record 反而与 scoreEntry 参数对不上

  const tokens = (query ?? "").trim().split(/\s+/).filter(Boolean);
  if (opts.anyTokens?.length) {
    const big = opts.anyTokens.filter((t) => [...t].length >= 3);
    if (big.length) {
      const match = big.map((t) => `"${t.replaceAll('"', '""')}"`).join(" OR ");
      rows = db
        .prepare(`SELECT *, bm25(entries_fts, 0, 3, 2, 1) AS rank FROM entries_fts WHERE entries_fts MATCH ?`)
        .all(match) as any[];
    } else {
      const cond = opts.anyTokens.map(() => `(name LIKE ? OR summary LIKE ? OR body LIKE ?)`).join(" OR ");
      const params = opts.anyTokens.flatMap((t) => [`%${t}%`, `%${t}%`, `%${t}%`]);
      rows = db.prepare(`SELECT *, -1.0 AS rank FROM entries_fts WHERE ${cond}`).all(...params) as any[];
    }
  } else if (tokens.length && tokens.every((t) => [...t].length >= 3)) {
    const match = tokens.map((t) => `"${t.replaceAll('"', '""')}"`).join(" AND ");
    // 权重：name 3 > summary 2 > body 1——检索键优先，正文兜底召回
    rows = db
      .prepare(`SELECT *, bm25(entries_fts, 0, 3, 2, 1) AS rank FROM entries_fts WHERE entries_fts MATCH ? `)
      .all(match) as any[];
  } else if (tokens.length) {
    // 短词（含 2 字中文）trigram MATCH 不了，LIKE 兜底——个人规模下毫秒级
    const cond = tokens.map(() => `(name LIKE ? OR summary LIKE ? OR body LIKE ?)`).join(" AND ");
    const params = tokens.flatMap((t) => [`%${t}%`, `%${t}%`, `%${t}%`]);
    rows = db.prepare(`SELECT *, -1.0 AS rank FROM entries_fts WHERE ${cond}`).all(...params) as any[];
  } else {
    rows = db.prepare(`SELECT *, -1.0 AS rank FROM entries_fts`).all() as any[];
  }

  const stats = new Map(
    (db.prepare(`SELECT id, last_accessed, access_count FROM stats`).all() as any[]).map((s) => [s.id, s]),
  );

  const hits: SearchHit[] = [];
  for (const r of rows) {
    if (!includeSuperseded && (r.status === "superseded" || r.status === "quarantined")) continue;
    if (r.scope === "session") continue;
    if (r.scope === "project" && r.project !== (project ?? "")) continue;
    const stat = stats.get(r.id);
    const lastTouch = stat?.last_accessed ? Date.parse(stat.last_accessed) : Date.parse(r.created);
    const { score, stale } = scoreEntry(
      r, lastTouch, now, staleDays, -r.rank /* bm25 越小越好 */, stat?.access_count ?? 0,
    );
    hits.push({ ...(r as any), score, stale });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

// 打分：相关性 × 新鲜度 × 可信度 × 有用性。
// preference 是规则不是时效资产——豁免衰减与 stale；verified 是买不回的资产——衰减有下限。
// 有用性闭环：access_count 只在 get 时累加（被注入不算，被调出来看了才算），
// 所以它是"这条真被用上了"的证据，不是"被推荐过"。用进废退在此兑现。
export function scoreEntry(
  r: { type: string; status: string; created: string; verified: number },
  lastTouchMs: number,
  now: Date,
  staleDays: number,
  relevance: number,
  accessCount = 0,
): { score: number; stale: boolean } {
  const ageDays = Math.max(0, (now.getTime() - Date.parse(r.created)) / 86_400_000);
  const stale = r.type !== "preference" && (now.getTime() - lastTouchMs) / 86_400_000 > staleDays;
  const decay = r.type === "preference" ? 1 : Math.exp(-ageDays / 60);
  const floor = r.verified > 0 ? 0.3 : 0;
  const freshness = Math.max(decay, floor) * (stale ? 0.3 : 1);
  const trust = (1 + 0.5 * r.verified) * (r.status === "final" ? 1 : 0.6);
  // ponytail: log 而非线性——强化必须有天花板，否则热条目滚雪球把新条目永久压在下面。
  // 只加成不惩罚（没被调用过 = ×1）：没人看过的好条目不该因此被埋。
  const usefulness = 1 + 0.3 * Math.log1p(Math.max(0, accessCount));
  return { score: relevance * freshness * trust * usefulness, stale };
}

export function recordAccess(id: string, db = openDb(), now = new Date()): void {
  db.prepare(
    `INSERT INTO stats (id, last_accessed, access_count) VALUES (?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET last_accessed = excluded.last_accessed, access_count = access_count + 1`,
  ).run(id, now.toISOString());
}
