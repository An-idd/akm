import { existsSync, readFileSync } from "node:fs";

// 完整导出：会话 jsonl → 可读 markdown。对话全文 + 文件写入标记，工具噪音丢弃。
export function renderTranscript(path: string): string {
  if (!existsSync(path)) return "";
  const out: string[] = [];
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    let line: any;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    if (line.type !== "user" && line.type !== "assistant") continue;
    const content = line.message?.content;
    const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
    for (const b of blocks) {
      if (b?.type === "text" && typeof b.text === "string") {
        const t = b.text.trim();
        if (!t || t.startsWith("<system-reminder>") || t.startsWith("<command-")) continue;
        out.push(`## ${line.type === "user" ? "🧑 用户" : "🤖 Agent"}\n\n${t}\n`);
      } else if (b?.type === "tool_use" && ["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(b.name)) {
        const p = b.input?.file_path ?? b.input?.notebook_path;
        if (p) out.push(`> ✏️ ${b.name} \`${p}\`\n`);
      }
    }
  }
  return out.join("\n");
}

// 会话 jsonl → 蒸馏用的裁剪文本。只取人和 Agent 的对话文本，丢工具噪音。
// 超预算时：用户消息是会话骨架，全保；assistant 文本从尾部往前保
// （结论在会话末尾，但"会话主要做什么"藏在用户消息里，不能裁丢）。
export function condenseTranscript(path: string, maxChars = 40_000): string {
  if (!existsSync(path)) return "";
  const parts: Array<{ role: string; text: string }> = [];
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    let line: any;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    if (line.type !== "user" && line.type !== "assistant") continue;
    const content = line.message?.content;
    const texts: string[] =
      typeof content === "string"
        ? [content]
        : Array.isArray(content)
          ? content.filter((b: any) => b?.type === "text" && typeof b.text === "string").map((b: any) => b.text)
          : [];
    for (const t of texts) {
      const trimmed = t.trim();
      // 系统注入的提醒/命令输出不算对话
      if (!trimmed || trimmed.startsWith("<system-reminder>") || trimmed.startsWith("<command-")) continue;
      parts.push({
        role: line.type,
        text: trimmed.slice(0, line.type === "user" ? 1000 : 2000),
      });
    }
  }
  const render = (ps: typeof parts) => ps.map((p) => `[${p.role}] ${p.text}`).join("\n");
  if (render(parts).length <= maxChars) return render(parts);

  // 超预算：先保全部用户消息，剩余预算给 assistant，从尾部往前填
  const keep = new Set<number>();
  let used = 0;
  parts.forEach((p, i) => {
    if (p.role === "user") {
      keep.add(i);
      used += p.text.length + 10;
    }
  });
  for (let i = parts.length - 1; i >= 0 && used < maxChars; i--) {
    if (keep.has(i)) continue;
    const cost = parts[i]!.text.length + 15;
    if (used + cost > maxChars) continue;
    keep.add(i);
    used += cost;
  }
  return render(parts.filter((_, i) => keep.has(i)));
}
