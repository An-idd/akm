import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { STILLYOU_HOME, CACHE_DIR, CONFIG_PATH, ledgerPaths } from "./ledger";
import { Config } from "./schema";

export const DEFAULT_LEDGER = join(homedir(), "Documents", "stillyou-ledger");

export function initLedger(ledger: string): Config {
  const p = ledgerPaths(ledger);
  mkdirSync(p.journalDir, { recursive: true });
  mkdirSync(p.entriesDir, { recursive: true });
  if (!existsSync(p.manifests)) writeFileSync(p.manifests, "");
  mkdirSync(CACHE_DIR, { recursive: true });
  // 重复 init 不清洗已有配置（预算、蒸馏模式等自定义保留）
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch {}
  const config = Config.parse({ ...existing, ledger });
  mkdirSync(STILLYOU_HOME, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  return config;
}

// 宿主适配薄壳：把 hooks 合并进 Claude Code settings.json，幂等。
// akmCmd 形如 "stillyou" 或 "bun /abs/main.ts"（开发期）。
// includeDistill=false（每日批处理模式）：不注册 Stop/SessionEnd，且摘掉已有的 distill hooks
export function installClaudeHooks(settingsPath: string, akmCmd: string, includeDistill = true): void {
  // 改宿主配置前先备份——站在别人客厅里要懂规矩
  if (existsSync(settingsPath)) copyFileSync(settingsPath, settingsPath + ".stillyou-bak");
  const settings = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, "utf8"))
    : {};
  settings.hooks ??= {};
  // distill 用 --detach：hook 秒退，LLM 蒸馏在脱离的后台进程里跑，不卡宿主回合收尾
  const want: Array<[event: string, matcher: string | undefined, cmd: string, sub: string, timeout: number]> = [
    ["PostToolUse", "Write|Edit|MultiEdit|NotebookEdit", `${akmCmd} capture`, "capture", 15],
    ...(includeDistill
      ? ([
          ["Stop", undefined, `${akmCmd} distill --detach --debounce`, "distill", 15], // 回合级触发要防抖
          ["SessionEnd", undefined, `${akmCmd} distill --detach`, "distill", 15], // 最后机会，必蒸
        ] as Array<[string, string | undefined, string, string, number]>)
      : []),
    ["SessionStart", undefined, `${akmCmd} hydrate`, "hydrate", 15],
    ["UserPromptSubmit", undefined, `${akmCmd} hydrate`, "hydrate", 15], // 首条消息的相关性注入，纯本地毫秒级
  ];
  if (!includeDistill) {
    for (const event of ["Stop", "SessionEnd"]) {
      const groups: any[] = settings.hooks[event] ?? [];
      for (const g of groups) {
        g.hooks = (g.hooks ?? []).filter(
          (h: any) => !(typeof h.command === "string" && /(stillyou|akm)/.test(h.command) &&
            h.command.split(/\s+/).includes("distill")),
        );
      }
      settings.hooks[event] = groups.filter((g) => (g.hooks ?? []).length > 0);
      if (!settings.hooks[event].length) delete settings.hooks[event];
    }
  }
  for (const [event, matcher, command, sub, timeout] of want) {
    const groups: any[] = (settings.hooks[event] ??= []);
    // 幂等：已有 stillyou 同子命令的 hook 则更新命令，否则追加
    let hook = groups
      .flatMap((g) => g.hooks ?? [])
      .find((h) => typeof h.command === "string" && /(stillyou|akm)/.test(h.command) && h.command.split(/\s+/).includes(sub));
    if (hook) {
      hook.command = command;
      hook.timeout = timeout;
    } else {
      groups.push({
        ...(matcher ? { matcher } : {}),
        hooks: [{ type: "command", command, timeout }],
      });
    }
  }
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

// 卸载 = 从 settings.json 摘掉 stillyou hooks。账本文件原样保留——删掉工具剩下可 grep 的普通文件。
export function uninstallClaudeHooks(settingsPath: string): void {
  if (!existsSync(settingsPath)) return;
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  for (const event of ["PostToolUse", "Stop", "SessionEnd", "SessionStart", "UserPromptSubmit"]) {
    const groups: any[] = settings.hooks?.[event];
    if (!groups) continue;
    for (const g of groups) {
      g.hooks = (g.hooks ?? []).filter(
        (h: any) => !(typeof h.command === "string" && /(stillyou|akm)/.test(h.command) &&
          h.command.split(/\s+/).some((t: string) => ["capture", "distill", "hydrate"].includes(t))),
      );
    }
    settings.hooks[event] = groups.filter((g) => (g.hooks ?? []).length > 0);
    if (!settings.hooks[event].length) delete settings.hooks[event];
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

export function writeProjectMarker(dir: string, project: string): string {
  const path = join(dir, ".stillyou");
  writeFileSync(path, JSON.stringify({ project }, null, 2) + "\n");
  return path;
}
