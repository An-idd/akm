import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, appendFileSync, writeFileSync, writeSync } from "node:fs";
import { Config, Entry, JournalLine, ProjectMarker } from "./schema";

// AKM_HOME 可用环境变量覆盖（测试隔离用）
export const AKM_HOME = process.env.AKM_HOME ?? join(homedir(), ".akm");
export const CONFIG_PATH = join(AKM_HOME, "config.json");
export const CACHE_DIR = join(AKM_HOME, "cache");

export function loadConfig(): Config | null {
  try {
    return Config.parse(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
  } catch {
    return null;
  }
}

export function saveConfig(config: Config): void {
  mkdirSync(AKM_HOME, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export function ledgerPaths(ledger: string) {
  return {
    root: ledger,
    journalDir: join(ledger, "journal"),
    entriesDir: join(ledger, "entries"),
    manifests: join(ledger, "manifests.jsonl"),
  };
}

export function journalPath(ledger: string, session: string): string {
  return join(ledgerPaths(ledger).journalDir, `${session}.jsonl`);
}

export function appendJournal(ledger: string, line: JournalLine): void {
  const p = journalPath(ledger, line.session);
  mkdirSync(ledgerPaths(ledger).journalDir, { recursive: true });
  appendFileSync(p, JSON.stringify(line) + "\n");
}

export function readJournal(ledger: string, session: string): JournalLine[] {
  return readJsonl(journalPath(ledger, session), JournalLine);
}

// manifests.jsonl 是 append-only 日志，同 id 后写覆盖先写（last-write-wins）。
// fsync：真相层不能因崩溃丢"被取代"标记（旧条目会诈尸）
export function appendManifests(ledger: string, entries: Entry[]): void {
  if (!entries.length) return;
  const fd = openSync(ledgerPaths(ledger).manifests, "a");
  try {
    writeSync(fd, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function readManifests(ledger: string): Map<string, Entry> {
  const byId = new Map<string, Entry>();
  for (const e of readJsonl(ledgerPaths(ledger).manifests, Entry)) byId.set(e.id, e);
  return byId;
}

function readJsonl<T>(path: string, schema: { parse(v: unknown): T }): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      out.push(schema.parse(JSON.parse(line)));
    } catch {
      // 损坏行跳过：journal 可丢弃重来
    }
  }
  return out;
}

// 正文按坐标落盘（Maven 精神：目录即坐标，人可导航）；文件一旦落盘永不搬家
export function entryBodyRelPath(e: Pick<Entry, "coords" | "id">): string {
  return `entries/${e.coords.namespace}/${e.coords.name}/v${e.coords.version}-${e.id.slice(0, 8)}.md`;
}

export function entryBodyAbsPath(ledger: string, e: Entry): string {
  // 旧账本条目无 body 字段：回退扁平旧位，零迁移可读
  return join(ledger, e.body ?? `entries/${e.id}.md`);
}

export function writeEntryBody(ledger: string, e: Entry, body: string): Entry {
  const rel = entryBodyRelPath(e);
  const abs = join(ledger, rel);
  mkdirSync(dirname(abs), { recursive: true });
  const fd = openSync(abs, "w");
  try {
    writeSync(fd, body + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return { ...e, body: rel };
}

// 向上发现 .akm 标记：cwd → 根。找到则 project scope，否则全局
export function discoverProject(cwd: string): ProjectMarker | null {
  let dir = cwd;
  for (;;) {
    const marker = join(dir, ".akm");
    if (existsSync(marker)) {
      try {
        return ProjectMarker.parse(JSON.parse(readFileSync(marker, "utf8")));
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
