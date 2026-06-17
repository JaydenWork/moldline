/* ============================================================
   MOLDLINE — 텔레그램 유지보수 봇 (항상 켜진 PC에서 실행)
   ------------------------------------------------------------
   텔레그램으로 자연어 지시를 보내면, 이 PC의 Claude Code(헤드리스)가
   repo를 수정·커밋하고, 승인 시 push → Render 자동 배포로 이어진다.

   - LLM 두뇌 = 이 PC에 설치된 Claude Code(구독 사용, 별도 API 키 불필요)
   - 보안 = 허용된 텔레그램 chat ID만 명령 가능
   - 푸시 = 기본은 "미리보기 후 /push 승인" (AUTO_PUSH=true면 즉시 푸시)

   실행:  npm run bot        (= node bot/maintainer.js)
   필요 .env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (또는 TELEGRAM_MAINTAINER_CHAT_IDS)
   ============================================================ */
"use strict";

const path = require("path");
const fs = require("fs");
const { spawn, execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
require("dotenv").config({ path: path.join(REPO, ".env") });

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const API = "https://api.telegram.org/bot" + TOKEN;
const ALLOWED = (process.env.TELEGRAM_MAINTAINER_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || "")
  .split(",").map(function (s) { return s.trim(); }).filter(Boolean);
const AUTO_PUSH = /^(1|true|yes)$/i.test(process.env.AUTO_PUSH || "");
const CLAUDE_TIMEOUT_MS = (Number(process.env.BOT_CLAUDE_TIMEOUT_SEC) || 600) * 1000;

if (!TOKEN) { console.error("❌ TELEGRAM_BOT_TOKEN 미설정 — .env 확인"); process.exit(1); }
if (!ALLOWED.length) { console.error("❌ 허용 chat ID 없음 — TELEGRAM_CHAT_ID 또는 TELEGRAM_MAINTAINER_CHAT_IDS 설정"); process.exit(1); }

/* ---- Claude Code 실행 파일 경로 해석 ---- */
function resolveClaude() {
  try {
    const root = execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const exe = process.platform === "win32" ? "claude.exe" : "claude";
    const p = path.join(root, "@anthropic-ai", "claude-code", "bin", exe);
    if (fs.existsSync(p)) return p;
  } catch (e) { /* noop */ }
  return process.platform === "win32" ? "claude.exe" : "claude"; // PATH 폴백
}
const CLAUDE = resolveClaude();

/* ============================================================
   텔레그램 API 헬퍼
   ============================================================ */
async function tg(method, body) {
  const r = await fetch(API + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json().catch(function () { return {}; });
}

// 텔레그램 메시지 4096자 제한 → 분할 전송
async function send(chatId, text) {
  const MAX = 3800;
  const str = String(text == null ? "" : text);
  for (let i = 0; i < str.length || i === 0; i += MAX) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: str.slice(i, i + MAX) || "(빈 응답)",
      disable_web_page_preview: true,
    });
  }
}

/* ============================================================
   로컬 명령 실행 (git / claude) — shell:false, cwd=REPO
   ============================================================ */
function run(cmd, args, opts) {
  return new Promise(function (resolve) {
    const p = spawn(cmd, args, Object.assign({ cwd: REPO, shell: false }, opts || {}));
    let out = "", err = "";
    let killed = false;
    let timer = null;
    if (opts && opts.timeout) {
      timer = setTimeout(function () { killed = true; try { p.kill("SIGKILL"); } catch (e) {} }, opts.timeout);
    }
    if (p.stdout) p.stdout.on("data", function (d) { out += d; });
    if (p.stderr) p.stderr.on("data", function (d) { err += d; });
    p.on("error", function (e) { if (timer) clearTimeout(timer); resolve({ code: -1, out: out, err: String(e && e.message || e), killed: killed }); });
    p.on("close", function (code) { if (timer) clearTimeout(timer); resolve({ code: code, out: out, err: err, killed: killed }); });
  });
}

function git(args) { return run("git", args); }

async function head() { return (await git(["rev-parse", "HEAD"])).out.trim(); }
async function branch() { return (await git(["rev-parse", "--abbrev-ref", "HEAD"])).out.trim(); }
async function lastSubject() { return (await git(["log", "-1", "--format=%h %s"])).out.trim(); }
async function isDirty() { return (await git(["status", "--porcelain"])).out.trim().length > 0; }

/* ============================================================
   유지보수 지시 처리 — Claude Code 헤드리스로 수정 + 커밋
   ============================================================ */
async function handleInstruction(chatId, text) {
  const before = await head();

  await send(chatId, "🛠️ 작업을 시작합니다…\n지시: " + text + "\n\n(수정 → 커밋. 잠시만요, 수십 초~몇 분 걸릴 수 있어요)");

  const prompt = [
    "당신은 'MOLDLINE'(아이디어를 중국 양산 제품으로 연결하는 랜딩 사이트) repo의 유지보수를 맡고 있습니다.",
    "바닐라 프론트(index.html, styles.css, script.js)와 단일 파일 Express 백엔드(server.js)로 구성됩니다.",
    "아래는 텔레그램으로 받은 유지보수 지시입니다. 요청을 반영하되, 기존 코드 스타일·구조를 따르고 변경은 최소화하세요.",
    "작업이 끝나면 반드시 변경을 커밋하세요: `git add -A` 후 `git commit` (메시지는 한국어로 무엇을 바꿨는지 요약).",
    "절대 `git push` 하지 마세요 — 푸시는 별도 승인 단계에서 사람이 처리합니다.",
    "변경할 내용이 없거나 요청이 모호하면, 수정하지 말고 무엇이 필요한지 한국어로 간단히 답하세요.",
    "마지막 응답에는 무엇을 어떻게 바꿨는지 한국어로 2~4줄 요약을 포함하세요.",
    "",
    "── 지시 ──",
    text,
  ].join("\n");

  const res = await run(CLAUDE, [
    "-p", prompt,
    "--dangerously-skip-permissions",
    "--output-format", "json",
  ], { timeout: CLAUDE_TIMEOUT_MS });

  if (res.killed) { await send(chatId, "⏱️ 시간이 초과되어 작업을 중단했습니다. 더 작은 단위로 다시 지시해 주세요."); return; }

  // Claude print 모드 JSON 파싱 → 요약 추출
  let summary = "";
  try {
    const obj = JSON.parse(res.out.trim());
    summary = (obj && (obj.result || obj.error)) || "";
    if (obj && obj.is_error) summary = "⚠️ " + (summary || "Claude가 오류를 보고했습니다.");
  } catch (e) {
    summary = res.out.trim() || res.err.trim();
  }
  if (!summary) summary = "(요약 없음)";

  const after = await head();

  if (after === before) {
    // 커밋이 생기지 않음 → 변경 없음 또는 미커밋
    const dirty = await isDirty();
    let msg = "ℹ️ 새 커밋이 없습니다.\n\n" + summary;
    if (dirty) msg += "\n\n⚠️ 커밋되지 않은 변경이 남아 있습니다. '커밋해줘'라고 다시 지시하거나 /reset 으로 되돌릴 수 있어요.";
    await send(chatId, msg);
    return;
  }

  const stat = (await git(["show", "--stat", "--format=%h %s%n", "HEAD"])).out.trim();
  await send(chatId, "✅ 수정 완료 & 커밋했습니다.\n\n" + summary + "\n\n── 변경 요약 ──\n" + stat);

  if (AUTO_PUSH) {
    await doPush(chatId);
  } else {
    await send(chatId, "🚀 배포하려면 /push 를 보내세요. 되돌리려면 /reset 을 보내세요.");
  }
}

/* ============================================================
   푸시 / 되돌리기
   ============================================================ */
async function doPush(chatId) {
  const br = await branch();
  await send(chatId, "⤴️ origin/" + br + " 로 푸시 중…");
  const r = await git(["push", "origin", br]);
  if (r.code === 0) {
    await send(chatId, "🚀 푸시 완료! Render 자동 배포가 시작됩니다.\n" + (await lastSubject()) +
      "\nhttps://moldline-ccvd.onrender.com/");
  } else {
    await send(chatId, "❌ 푸시 실패:\n" + (r.err || r.out).slice(-1500));
  }
}

async function doReset(chatId) {
  // 마지막 커밋을 취소하고(소프트 X, 완전 폐기) 작업트리 정리 — 아직 push 안 한 경우용
  const sub = await lastSubject();
  const r = await git(["reset", "--hard", "HEAD~1"]);
  if (r.code === 0) {
    await git(["clean", "-fd"]);
    await send(chatId, "↩️ 마지막 커밋을 되돌렸습니다: " + sub + "\n현재: " + (await lastSubject()));
  } else {
    await send(chatId, "❌ 되돌리기 실패:\n" + (r.err || r.out).slice(-1500));
  }
}

async function doStatus(chatId) {
  const br = await branch();
  const sub = await lastSubject();
  const dirty = await isDirty();
  await send(chatId,
    "📊 상태\n브랜치: " + br +
    "\n최근 커밋: " + sub +
    "\n미커밋 변경: " + (dirty ? "있음 ⚠️" : "없음") +
    "\n자동 푸시: " + (AUTO_PUSH ? "ON" : "OFF (승인 필요)"));
}

const HELP =
  "🤖 MOLDLINE 유지보수 봇\n\n" +
  "그냥 한국어로 수정 지시를 보내세요. 예:\n" +
  "• \"히어로 부제목을 더 짧게 줄여줘\"\n" +
  "• \"FAQ에 배송 기간 질문 하나 추가해줘\"\n" +
  "• \"비용 섹션 버튼 색을 더 진하게\"\n\n" +
  "명령:\n" +
  "/push — 마지막 커밋을 배포(푸시)\n" +
  "/reset — 마지막 커밋 되돌리기(푸시 전)\n" +
  "/status — 현재 브랜치·커밋 상태\n" +
  "/help — 이 도움말";

/* ============================================================
   메시지 라우팅
   ============================================================ */
let busy = false;

async function onMessage(msg) {
  const chatId = msg.chat && msg.chat.id;
  const text = (msg.text || "").trim();
  if (!chatId || !text) return;

  // 인증: 허용된 chat ID만
  if (ALLOWED.indexOf(String(chatId)) === -1) {
    console.warn("⛔ 허용되지 않은 chat ID:", chatId);
    await send(chatId, "⛔ 이 봇은 관리자 전용입니다. (chat ID: " + chatId + ")");
    return;
  }

  // 명령 처리
  const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@.*$/, "");
  if (cmd === "/start" || cmd === "/help") { await send(chatId, HELP); return; }
  if (cmd === "/status") { await doStatus(chatId); return; }
  if (cmd === "/push") {
    if (busy) { await send(chatId, "⏳ 다른 작업 진행 중입니다. 잠시 후 다시 시도하세요."); return; }
    await doPush(chatId); return;
  }
  if (cmd === "/reset") {
    if (busy) { await send(chatId, "⏳ 다른 작업 진행 중입니다."); return; }
    await doReset(chatId); return;
  }

  // 일반 텍스트 = 유지보수 지시
  if (busy) { await send(chatId, "⏳ 이전 작업이 아직 진행 중입니다. 끝나면 다시 보내주세요."); return; }
  busy = true;
  try {
    await handleInstruction(chatId, text);
  } catch (e) {
    await send(chatId, "❌ 처리 중 오류: " + (e && e.message || e));
  } finally {
    busy = false;
  }
}

/* ============================================================
   롱 폴링 루프
   ============================================================ */
let offset = 0;

async function poll() {
  try {
    const r = await fetch(API + "/getUpdates?timeout=50&offset=" + offset, { });
    const j = await r.json().catch(function () { return {}; });
    if (j && j.ok && Array.isArray(j.result)) {
      for (const upd of j.result) {
        offset = upd.update_id + 1;
        if (upd.message) {
          // 동기 처리(한 번에 하나) — busy 가드로 중복 방지
          await onMessage(upd.message);
        }
      }
    }
  } catch (e) {
    console.error("폴링 오류:", e && e.message || e);
    await new Promise(function (r) { setTimeout(r, 3000); });
  }
  setImmediate(poll);
}

/* ============================================================
   기동
   ============================================================ */
(async function main() {
  const me = await tg("getMe");
  if (!me || !me.ok) { console.error("❌ 봇 토큰이 유효하지 않습니다 (getMe 실패)."); process.exit(1); }
  console.log("✅ 봇 시작: @" + me.result.username);
  console.log("   repo:", REPO);
  console.log("   허용 chat ID:", ALLOWED.join(", "));
  console.log("   자동 푸시:", AUTO_PUSH ? "ON" : "OFF (승인 필요)");
  console.log("   Claude:", CLAUDE);
  // 시작 시 미처리 업데이트 건너뛰기(과거 메시지 폭주 방지)
  try {
    const r = await fetch(API + "/getUpdates?offset=-1");
    const j = await r.json();
    if (j && j.ok && j.result.length) offset = j.result[j.result.length - 1].update_id + 1;
  } catch (e) { /* noop */ }
  poll();
})();
