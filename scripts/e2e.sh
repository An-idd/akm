#!/usr/bin/env bash
# akm e2e：隔离环境跑通 init → capture → distill(mock) → search → 取代 → rebuild 一致 → stale → hydrate
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
export AKM_HOME="$SCRATCH/.akm" CLAUDE_SETTINGS="$SCRATCH/.claude/settings.json"
export AKM_PROVIDER=mock AKM_MOCK_JSON="$SCRATCH/mock.json"
export AKM_LAUNCH_DIR="$SCRATCH/launch" AKM_NO_LAUNCHCTL=1
akm() { bun "$ROOT/packages/cli/src/main.ts" "$@"; }
fail() { echo "❌ $1"; exit 1; }

mkdir -p "$SCRATCH/project"

# init
akm init --yes --ledger "$SCRATCH/ledger" >/dev/null
grep -q '"PostToolUse"' "$CLAUDE_SETTINGS" || fail "hooks 未注册"
akm init --yes --ledger "$SCRATCH/ledger" >/dev/null
[ "$(python3 -c "import json;print(len(json.load(open('$CLAUDE_SETTINGS'))['hooks']['PostToolUse']))")" = 1 ] || fail "init 不幂等"

# capture
echo "调研正文" > "$SCRATCH/project/topic-scan.md"
echo "{\"session_id\":\"s1\",\"cwd\":\"$SCRATCH/project\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$SCRATCH/project/topic-scan.md\"}}" | akm capture
grep -q topic-scan.md "$SCRATCH/ledger/journal/s1.jsonl" || fail "capture 未落 journal"
echo garbage | akm capture || fail "capture 坏输入未静默"

# distill
printf '{"type":"user","message":{"role":"user","content":"帮我做选题扫描"}}\n' > "$SCRATCH/transcript.jsonl"
cat > "$SCRATCH/mock.json" <<EOF
{"distill":{"items":[
  {"type":"file","name":"topic-scan","summary":"选题扫描调研：方向A数据支撑最强","status":"final","path":"$SCRATCH/project/topic-scan.md"},
  {"type":"decision","name":"topic-direction","summary":"决定押方向A放弃方向B","status":"final","body":"方向A数据强。"}
]}}
EOF
echo "{\"session_id\":\"s1\",\"transcript_path\":\"$SCRATCH/transcript.jsonl\",\"cwd\":\"$SCRATCH/project\"}" | akm distill
[ "$(wc -l < "$SCRATCH/ledger/manifests.jsonl")" -eq 2 ] || fail "distill 未入账 2 条"
find "$SCRATCH/ledger/entries" -name '*.md' | grep -q . || fail "decision 正文未落盘"

# search：2 字中文 LIKE 与 3+ 字 MATCH 都要命中
(cd "$SCRATCH/project" && akm search 选题 | grep -q topic-scan) || fail "短词检索未命中"
(cd "$SCRATCH/project" && akm search 方向A数据 | grep -q topic-scan) || fail "MATCH 检索未命中"

# 取代（Reviewer v0）
echo "更新的调研" > "$SCRATCH/project/topic-scan2.md"
echo "{\"session_id\":\"s2\",\"cwd\":\"$SCRATCH/project\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$SCRATCH/project/topic-scan2.md\"}}" | akm capture
cat > "$SCRATCH/mock.json" <<EOF
{"distill":{"items":[{"type":"file","name":"topic-scan","summary":"选题扫描增量更新：新增方向C","status":"final","path":"$SCRATCH/project/topic-scan2.md"}]},"judge":"supersedes"}
EOF
echo "{\"session_id\":\"s2\",\"transcript_path\":\"$SCRATCH/transcript.jsonl\",\"cwd\":\"$SCRATCH/project\"}" | akm distill
akm search 选题 | grep -q 'topic-scan@v2' || fail "新版本未产出"
akm search 选题 | grep -q 'topic-scan@v1' && fail "superseded 未被默认过滤"
akm search 选题 --all | grep -q 'superseded' || fail "--all 未显示 superseded"

# 同会话重蒸 = 整批替换：journal 没长跳过；长了则旧产出 superseded、活跃条目不堆积
echo "{\"session_id\":\"s2\",\"transcript_path\":\"$SCRATCH/transcript.jsonl\",\"cwd\":\"$SCRATCH/project\"}" | akm distill
N1=$(grep -c . "$SCRATCH/ledger/manifests.jsonl")
echo "{\"session_id\":\"s2\",\"cwd\":\"$SCRATCH/project\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$SCRATCH/project/topic-scan2.md\"}}" | akm capture
cat > "$SCRATCH/mock.json" <<EOF
{"distill":{"items":[{"type":"file","name":"topic-scan","summary":"选题扫描再度更新：方向C确认","status":"final","path":"$SCRATCH/project/topic-scan2.md"}]}}
EOF
[ "$(grep -c . "$SCRATCH/ledger/manifests.jsonl")" -eq "$N1" ] || fail "journal 未变仍重蒸了"
echo "{\"session_id\":\"s2\",\"transcript_path\":\"$SCRATCH/transcript.jsonl\",\"cwd\":\"$SCRATCH/project\"}" | akm distill
ACTIVE=$(akm search 选题 | grep -c 'topic-scan@' || true)
[ "$ACTIVE" -eq 1 ] || fail "同会话重蒸后活跃条目堆积（$ACTIVE 条）"
akm search 选题 | grep -q '方向C确认' || fail "重蒸新产出未生效"

# rebuild 一致性（索引永远是缓存）
akm search 选题 > "$SCRATCH/before.txt"
rm "$AKM_HOME/cache/index.db"
akm rebuild >/dev/null
akm search 选题 > "$SCRATCH/after.txt"
diff -q "$SCRATCH/before.txt" "$SCRATCH/after.txt" >/dev/null || fail "重建后结果不一致"

# stale 降权与提示
python3 -c "
import json
e={'id':'stale00000000001','coords':{'namespace':'self','name':'old-scan','version':1},'type':'file','status':'final','summary':'选题旧调研','provenance':{'host':'claude-code','session':'s0','inputs':[]},'verified_by':[],'scope':'user','created':'2026-03-01T00:00:00.000Z','path':'/nowhere/old.md'}
open('$SCRATCH/ledger/manifests.jsonl','a').write(json.dumps(e,ensure_ascii=False)+'\n')"
akm rebuild >/dev/null
akm search 选题 | grep -q '/stale' || fail "stale 未标记"
akm search 选题 | head -1 | grep -q 'topic-scan@' || fail "stale 未降权"
akm status | grep -q '未被检索' || fail "status 未提示 stale"

# hydrate：预算内注入 + 空账本零注入
echo "{\"session_id\":\"s3\",\"cwd\":\"$SCRATCH/project\"}" | akm hydrate | grep -q additionalContext || fail "hydrate 无输出"
EMPTY="$SCRATCH/empty" && mkdir -p "$EMPTY"
AKM_HOME="$SCRATCH/.akm2" bash -c "$(declare -f akm); akm init --yes --ledger $EMPTY/ledger >/dev/null && echo '{\"session_id\":\"s4\",\"cwd\":\"$EMPTY\"}' | akm hydrate" | grep -q . && fail "空账本仍注入"

# get 记访问
ID=$(akm search 选题 | head -1 | sed 's/^- \[\([a-f0-9]*\)\].*/\1/')
akm get "$ID" | grep -q '正文\|文件' || fail "get 无内容"

# --detach：hook 秒退，后台进程完成蒸馏
echo "detach 测试" > "$SCRATCH/project/detach.md"
echo "{\"session_id\":\"s3\",\"cwd\":\"$SCRATCH/project\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$SCRATCH/project/detach.md\"}}" | akm capture
cat > "$SCRATCH/mock.json" <<EOF
{"distill":{"items":[{"type":"file","name":"detach-doc","summary":"detach 测试产物","status":"final","path":"$SCRATCH/project/detach.md"}]}}
EOF
START=$(python3 -c 'import time;print(time.time())')
echo "{\"session_id\":\"s3\",\"transcript_path\":\"$SCRATCH/transcript.jsonl\",\"cwd\":\"$SCRATCH/project\"}" | akm distill --detach
ELAPSED=$(python3 -c "import time;print(time.time()-$START)")
python3 -c "exit(0 if $ELAPSED < 5 else 1)" || fail "--detach 未秒退（${ELAPSED}s）"
for i in $(seq 1 20); do grep -q detach-doc "$SCRATCH/ledger/manifests.jsonl" 2>/dev/null && break; sleep 0.5; done
grep -q detach-doc "$SCRATCH/ledger/manifests.jsonl" || fail "detach 后台蒸馏未入账"

# 蒸馏依据归档（溯源不随宿主清理断链）+ export
[ -f "$SCRATCH/ledger/journal/s1.transcript.md" ] || fail "transcript 未归档"
akm export "$SCRATCH/transcript.jsonl" | grep -q '用户' || fail "export 无对话内容"

# compact：合并同类，来源转 superseded，拿不准（无效 id）整簇丢弃
ID_A=$(akm search 选题 | sed -n 's/^- \[\([a-f0-9]*\)\].*/\1/p' | head -1)
ID_B=$(akm search 方向A --all | sed -n 's/^- \[\([a-f0-9]*\)\].*topic-direction.*/\1/p' | head -1)
cat > "$SCRATCH/mock.json" <<EOF
{"compact":{"clusters":[
  {"ids":["$ID_A","$ID_B"],"name":"topic-knowledge","summary":"选题方向知识合并卡","body":"方向A确认；方向B放弃；新增方向C。"},
  {"ids":["deadbeef00000000","$ID_A"],"name":"bad-cluster","summary":"来源不存在应被丢弃","body":"x"}
]}}
EOF
akm compact | grep -q 'topic-knowledge' || fail "compact 未产出合并卡"
akm search 知识合并 | grep -q 'topic-knowledge' || fail "合并卡不可检索"
akm search 选题 | grep -q "\[$ID_A\]" && fail "来源未转 superseded"
akm search 选题 --all | grep -q 'bad-cluster' && fail "无效簇未被丢弃"
akm get "$ID_A" | grep -q 'superseded' || fail "来源状态未更新"

# T2：preference 常驻 + 首条消息相关性注入（拉模型） + verify 背书
python3 -c "
import json
e={'id':'pref000000000001','coords':{'namespace':'self','name':'no-ask-before-optimize','version':1},'type':'preference','status':'final','summary':'优化类改动直接改，不逐项询问','provenance':{'host':'x','session':'s0','inputs':[]},'verified_by':[],'scope':'user','created':'2026-01-01T00:00:00.000Z'}
open('$SCRATCH/ledger/manifests.jsonl','a').write(json.dumps(e,ensure_ascii=False)+'\n')"
akm rebuild >/dev/null
echo "{\"session_id\":\"h1\",\"cwd\":\"$SCRATCH/project\",\"hook_event_name\":\"SessionStart\"}" | akm hydrate | grep -q 'no-ask-before-optimize' || fail "开场未注入 preference"
echo "{\"session_id\":\"h1\",\"cwd\":\"$SCRATCH/project\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"继续上次的选题方向调研\"}" | akm hydrate > "$SCRATCH/h1.json"
grep -q 'topic-knowledge' "$SCRATCH/h1.json" || fail "首条消息未注入相关条目"
grep -q 'no-ask-before-optimize' "$SCRATCH/h1.json" && fail "偏好重复注入"
OUT2=$(echo "{\"session_id\":\"h1\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"再问一次选题\"}" | akm hydrate)
[ -z "$OUT2" ] || fail "相关性注入未按会话去重"
grep -q 'UserPromptSubmit' "$CLAUDE_SETTINGS" || fail "UserPromptSubmit hook 未注册"
VID=$(akm search 知识合并 | head -1 | sed 's/^- \[\([a-f0-9]*\)\].*/\1/')
akm verify "$VID" --by tester | grep -q '已背书' || fail "verify 失败"
akm search 知识合并 | head -1 | grep -q 'verified' || fail "verified 未在检索标记"

# T1：settings 备份 + Stop 防抖注册
[ -f "$CLAUDE_SETTINGS.akm-bak" ] || fail "settings 未备份"
grep -q 'distill --detach --debounce' "$CLAUDE_SETTINGS" || fail "Stop 未注册防抖"

# T1：防抖语义（小增量+短间隔跳过；无 --debounce 必蒸）
cat > "$SCRATCH/mock.json" <<EOF
{"distill":{"items":[{"type":"file","name":"debounce-doc","summary":"防抖测试产物","status":"final","path":"$SCRATCH/project/db1.md"}]}}
EOF
echo "x" > "$SCRATCH/project/db1.md"
echo "{\"session_id\":\"s4\",\"cwd\":\"$SCRATCH/project\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$SCRATCH/project/db1.md\"}}" | akm capture
echo "{\"session_id\":\"s4\",\"transcript_path\":\"$SCRATCH/transcript.jsonl\"}" | akm distill
grep -q debounce-doc "$SCRATCH/ledger/manifests.jsonl" || fail "s4 首蒸未入账"
echo "{\"session_id\":\"s4\",\"cwd\":\"$SCRATCH/project\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$SCRATCH/project/db1.md\"}}" | akm capture
N4=$(grep -c . "$SCRATCH/ledger/manifests.jsonl")
echo "{\"session_id\":\"s4\",\"transcript_path\":\"$SCRATCH/transcript.jsonl\"}" | akm distill --debounce
[ "$(grep -c . "$SCRATCH/ledger/manifests.jsonl")" -eq "$N4" ] || fail "防抖未生效"
echo "{\"session_id\":\"s4\",\"transcript_path\":\"$SCRATCH/transcript.jsonl\"}" | akm distill
[ "$(grep -c . "$SCRATCH/ledger/manifests.jsonl")" -gt "$N4" ] || fail "无防抖标志未蒸（SessionEnd 语义破坏）"

# T1：互斥锁（在位让位；10 分钟陈锁清理后可蒸）
echo "y" > "$SCRATCH/project/db2.md"
echo "{\"session_id\":\"s4\",\"cwd\":\"$SCRATCH/project\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$SCRATCH/project/db2.md\"}}" | akm capture
touch "$AKM_HOME/cache/distill-s4.lock"
N5=$(grep -c . "$SCRATCH/ledger/manifests.jsonl")
echo "{\"session_id\":\"s4\",\"transcript_path\":\"$SCRATCH/transcript.jsonl\"}" | akm distill
[ "$(grep -c . "$SCRATCH/ledger/manifests.jsonl")" -eq "$N5" ] || fail "有锁仍蒸了"
touch -t 202601010000 "$AKM_HOME/cache/distill-s4.lock"
echo "{\"session_id\":\"s4\",\"transcript_path\":\"$SCRATCH/transcript.jsonl\"}" | akm distill
[ "$(grep -c . "$SCRATCH/ledger/manifests.jsonl")" -gt "$N5" ] || fail "陈锁未清理"
[ -f "$AKM_HOME/cache/distill-s4.lock" ] && fail "锁未释放"

# T1：失败可观测（蒸馏失败 → status 警告）
echo "z" > "$SCRATCH/project/db3.md"
echo "{\"session_id\":\"s4\",\"cwd\":\"$SCRATCH/project\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$SCRATCH/project/db3.md\"}}" | akm capture
AKM_MOCK_JSON=/nonexistent-mock.json bash -c "$(declare -f akm); echo '{\"session_id\":\"s4\"}' | akm distill"
akm status | grep -q '蒸馏失败' || fail "蒸馏失败未在 status 提醒"

# T3：坐标化目录 + migrate + transcript 开关
grep -q '"body":"entries/self/' "$SCRATCH/ledger/manifests.jsonl" || fail "manifest 未记正文坐标路径"
find "$SCRATCH/ledger/entries/self" -name 'v*-*.md' | grep -q . || fail "坐标目录无正文文件"
python3 -c "
import json
e={'id':'oldstyle00000001','coords':{'namespace':'self','name':'legacy-note','version':1},'type':'conclusion','status':'final','summary':'旧式扁平正文条目','provenance':{'host':'x','session':'s0','inputs':[]},'verified_by':[],'scope':'user','created':'2026-06-01T00:00:00.000Z'}
open('$SCRATCH/ledger/manifests.jsonl','a').write(json.dumps(e,ensure_ascii=False)+'\n')"
echo "旧正文" > "$SCRATCH/ledger/entries/oldstyle00000001.md"
akm get oldstyle00000001 | grep -q '旧正文' || fail "旧位回退读取失败"
akm migrate | grep -q '迁移完成' || fail "migrate 失败"
[ -f "$SCRATCH/ledger/entries/self/legacy-note/v1-oldstyle.md" ] || fail "migrate 未落新位"
akm get oldstyle00000001 | grep -q '旧正文' || fail "migrate 后读取失败"

python3 -c "
import json
c=json.load(open('$AKM_HOME/config.json')); c['archive_transcripts']=False
json.dump(c,open('$AKM_HOME/config.json','w'))"
echo "s6" > "$SCRATCH/project/s6.md"
echo "{\"session_id\":\"s6\",\"cwd\":\"$SCRATCH/project\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$SCRATCH/project/s6.md\"}}" | akm capture
cat > "$SCRATCH/mock.json" <<EOF
{"distill":{"items":[{"type":"file","name":"s6-doc","summary":"归档开关测试","status":"final","path":"$SCRATCH/project/s6.md"}]}}
EOF
echo "{\"session_id\":\"s6\",\"transcript_path\":\"$SCRATCH/transcript.jsonl\"}" | akm distill
[ -f "$SCRATCH/ledger/journal/s6.transcript.md" ] && fail "关闭归档仍写了 transcript"
grep -q 's6-doc' "$SCRATCH/ledger/manifests.jsonl" || fail "关闭归档影响了入账"

# 每日模式：schedule 开启 → plist 落盘、distill hooks 摘除、capture/hydrate 保留
akm schedule --at 03:30 | grep -q '每日蒸馏已开启' || fail "schedule 开启失败"
[ -f "$SCRATCH/launch/com.akm.daily-distill.plist" ] || fail "plist 未写入"
grep -q '<integer>30</integer>' "$SCRATCH/launch/com.akm.daily-distill.plist" || fail "plist 时间错误"
grep -qE 'akm.* distill' "$CLAUDE_SETTINGS" && fail "daily 模式仍注册 distill hooks"
grep -q 'capture' "$CLAUDE_SETTINGS" || fail "capture hook 被误删"
grep -q '"distill_mode": "daily"' "$AKM_HOME/config.json" || fail "config 未记 daily 模式"

# distill-all：批处理待蒸会话
echo "s7" > "$SCRATCH/project/s7.md"
echo "{\"session_id\":\"s7\",\"cwd\":\"$SCRATCH/project\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$SCRATCH/project/s7.md\"}}" | akm capture
cat > "$SCRATCH/mock.json" <<EOF
{"distill":{"items":[{"type":"file","name":"s7-doc","summary":"每日批处理测试","status":"final","path":"$SCRATCH/project/s7.md"}]}}
EOF
akm distill-all | grep -q '1 个会话入账' || fail "distill-all 未按预期入账"
grep -q 's7-doc' "$SCRATCH/ledger/manifests.jsonl" || fail "批处理产物缺失"

# 重复 init 不洗配置、不在 daily 模式装回 distill hooks
akm init --yes --ledger "$SCRATCH/ledger" >/dev/null
grep -q '"distill_mode": "daily"' "$AKM_HOME/config.json" || fail "init 洗掉了 distill_mode"
grep -qE 'akm.* distill' "$CLAUDE_SETTINGS" && fail "init 在 daily 模式下装回 distill hooks"

# 每日模式兜底：当天首次 hydrate 自动后台拉起批处理（launchd 无权限时的退路）
echo "s8" > "$SCRATCH/project/s8.md"
echo "{\"session_id\":\"s8\",\"cwd\":\"$SCRATCH/project\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$SCRATCH/project/s8.md\"}}" | akm capture
cat > "$SCRATCH/mock.json" <<EOF
{"distill":{"items":[{"type":"file","name":"s8-doc","summary":"兜底批处理测试","status":"final","path":"$SCRATCH/project/s8.md"}]}}
EOF
echo "{\"session_id\":\"h2\",\"cwd\":\"$SCRATCH/project\",\"hook_event_name\":\"SessionStart\"}" | akm hydrate >/dev/null
for i in $(seq 1 20); do grep -q s8-doc "$SCRATCH/ledger/manifests.jsonl" 2>/dev/null && break; sleep 0.5; done
grep -q s8-doc "$SCRATCH/ledger/manifests.jsonl" || fail "每日兜底批处理未触发"
[ -f "$AKM_HOME/cache/daily-state.json" ] || fail "daily-state 未记录"

# schedule --off 恢复实时蒸馏
akm schedule --off | grep -q '已关闭' || fail "schedule 关闭失败"
[ -f "$SCRATCH/launch/com.akm.daily-distill.plist" ] && fail "plist 未删除"
grep -q 'distill --detach --debounce' "$CLAUDE_SETTINGS" || fail "off 后未恢复实时蒸馏 hooks"

# uninstall：hooks 摘除、账本保留
akm uninstall >/dev/null
grep -q 'akm' "$CLAUDE_SETTINGS" && fail "uninstall 未摘净 hooks"
[ -f "$SCRATCH/ledger/manifests.jsonl" ] || fail "uninstall 动了账本"

echo "✅ e2e 全部通过"
