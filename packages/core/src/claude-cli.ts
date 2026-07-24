import {
  CompactResult, ConflictResult, DistillResult, JudgeVerdict,
  parseCompactLenient, parseConflictsLenient, parseDistillLenient, Provider,
} from "./provider";

// LLM 经 `claude -p` 子进程调用：复用宿主登录，零 API key。
// STILLYOU_DISTILLING=1 传给子进程，stillyou 自己的 hooks 见到即退——防 Stop hook 递归。
export class ClaudeCliProvider implements Provider {
  constructor(
    private model = "haiku", // ponytail: 蒸馏用便宜模型，质量不够再升配
    private timeoutMs = Number(process.env.STILLYOU_TIMEOUT_MS ?? 150_000),
  ) {}

  // claude -p 偶发抽风（瞬时故障/输出结构跑偏），整链重试一次就能吃掉这类失败
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch {
      return await fn();
    }
  }

  private async run(prompt: string): Promise<string> {
    // launchd 等极简 PATH 环境下解析绝对路径；找不到再按名字碰运气
    const claude = Bun.which("claude") ?? "claude";
    const proc = Bun.spawn([claude, "-p", "--output-format", "json", "--model", this.model], {
      stdin: new TextEncoder().encode(prompt),
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, STILLYOU_DISTILLING: "1" },
    });
    const killer = setTimeout(() => proc.kill(), this.timeoutMs);
    try {
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      if (proc.exitCode !== 0) throw new Error(`claude -p exit ${proc.exitCode}`);
      const wrapper = JSON.parse(out);
      if (typeof wrapper.result !== "string") throw new Error("no result field");
      return wrapper.result;
    } finally {
      clearTimeout(killer);
    }
  }

  async distill(prompt: string): Promise<DistillResult> {
    // 解析/校验失败与调用失败同等对待：换一次骰子
    return this.withRetry(async () => parseDistillLenient(extractJson(await this.run(prompt))));
  }

  async judge(prompt: string): Promise<JudgeVerdict> {
    return parseVerdict(await this.withRetry(() => this.run(prompt)));
  }

  async compact(prompt: string): Promise<CompactResult> {
    return this.withRetry(async () => parseCompactLenient(extractJson(await this.run(prompt))));
  }

  async conflicts(prompt: string): Promise<ConflictResult> {
    return this.withRetry(async () => parseConflictsLenient(extractJson(await this.run(prompt))));
  }
}

// 裁决解析：歧义必须滑向 unsure（最安全），绝不滑向 supersedes（最危险）
export function parseVerdict(raw: string): JudgeVerdict {
  const text = raw.toLowerCase();
  if (/\bunsure\b/.test(text)) return "unsure";
  if (/\bnot\s+supersedes?\b/.test(text)) return "unsure";
  if (/\bsupersedes\b/.test(text)) return "supersedes";
  if (/\bunrelated\b/.test(text)) return "unrelated";
  return "unsure"; // 拿不准留空
}

// 模型输出可能带 ```json 围栏或前后闲话，取第一个 { 到最后一个 }
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON in response");
  return JSON.parse(text.slice(start, end + 1));
}
