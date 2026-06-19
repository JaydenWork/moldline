/* ============================================================
   MOLDLINE — 텔레그램 "브레인스토밍 룸" 봇
   ------------------------------------------------------------
   한 채팅방에서 두 페르소나(💡 아이디어봇 ↔ 🛠️ PM봇)가 핑퐁하듯
   사업·사이트 개선 아이디어를 주고받는다. 봇끼리는 "토론만" 하고,
   코드는 절대 자동으로 건드리지 않는다. 사장님이 마음에 드는 제안을
   /apply 로 "승인"할 때만 기존 유지보수 흐름(Claude Code 수정·커밋)으로
   넘어가고, 실제 배포는 여전히 /push 로 승인한다.

   ※ 텔레그램 제약: 봇은 "다른 봇이 보낸 메시지"를 받을 수 없다.
     그래서 진짜 봇 2개를 한 방에 넣는 대신, 이 프로세스 1개가
     두 페르소나를 번갈아 호출해 대화를 그룹에 중계한다.

   - LLM 두뇌 = 이 PC에 설치된 Claude Code(구독 사용, 별도 API 키 불필요)
   - 보안 = 허용된 텔레그램 chat ID(또는 그룹 ID)만 사용 가능

   실행:  npm run brainstorm     (= node bot/brainstorm.js)
   필요 .env:
     TELEGRAM_BRAINSTORM_BOT_TOKEN  (권장 — 유지보수 봇과 다른 전용 봇)
     TELEGRAM_BRAINSTORM_CHAT_IDS   (이 봇을 쓸 그룹/개인 chat ID, 쉼표 구분)
   ============================================================ */
"use strict";

const path = require("path");
const fs = require("fs");
const { spawn, execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
require("dotenv").config({ path: path.join(REPO, ".env") });

// ⚠️ 같은 토큰으로 maintainer.js 와 동시에 polling 하면 getUpdates 가 서로 충돌한다.
//    반드시 전용 봇 토큰을 쓸 것. 없으면 폴백하되 경고한다.
const DEDICATED = (process.env.TELEGRAM_BRAINSTORM_BOT_TOKEN || "").trim();
const TOKEN = (DEDICATED || process.env.TELEGRAM_MAINTAINER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
const API = "https://api.telegram.org/bot" + TOKEN;
const ALLOWED = (process.env.TELEGRAM_BRAINSTORM_CHAT_IDS || process.env.TELEGRAM_MAINTAINER_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || "")
  .split(",").map(function (s) { return s.trim(); }).filter(Boolean);
const CLAUDE_TIMEOUT_MS = (Number(process.env.BOT_CLAUDE_TIMEOUT_SEC) || 600) * 1000;
const MAX_THREAD = 10; // 프롬프트에 실어보낼 직전 대화 턴 수

if (!TOKEN) { console.error("❌ 봇 토큰 미설정 — .env 의 TELEGRAM_BRAINSTORM_BOT_TOKEN(권장) 확인"); process.exit(1); }
if (!ALLOWED.length) { console.error("❌ 허용 chat ID 없음 — TELEGRAM_BRAINSTORM_CHAT_IDS 설정"); process.exit(1); }
if (!DEDICATED) {
  console.warn("⚠️ 전용 토큰(TELEGRAM_BRAINSTORM_BOT_TOKEN) 미설정 — 유지보수/알림 토큰으로 폴백합니다.");
  console.warn("   유지보수 봇(npm run bot)과 같은 토큰을 동시에 켜면 메시지가 서로 사라집니다. 전용 봇 사용을 권장합니다.");
}

/* ---- Claude Code 실행 파일 경로 해석 (maintainer.js 와 동일) ---- */
function resolveClaude() {
  try {
    const root = execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const exe = process.platform === "win32" ? "claude.exe" : "claude";
    const p = path.join(root, "@anthropic-ai", "claude-code", "bin", exe);
    if (fs.existsSync(p)) return p;
  } catch (e) { /* noop */ }
  return process.platform === "win32" ? "claude.exe" : "claude";
}
const CLAUDE = resolveClaude();

/* ============================================================
   MOLDLINE 포지셔닝 브리프 — 두 페르소나의 공통 컨텍스트
   ============================================================ */
const POSITIONING = [
  "[MOLDLINE 한 줄] 아이디어/기존 제품을 중국 양산으로 연결하는 '제품 PM' 서비스 랜딩 사이트.",
  "[핵심 차별점] 물건 찾아주는 무역상이 아니라, 함께 개발·개선하고 검품으로 품질을 책임지는 PM.",
  "[타깃] 스마트스토어·쿠팡·크라우드펀딩 셀러, 자체 브랜드 만들고 싶은데 중국 공장 못 다루는 사람.",
  "[고객 통증] 불량, MOQ 협상, 샘플 핑퐁, KC 인증, 중국 공장과의 소통 단절.",
  "[파는 것] 제품 개발·개선 + 공장 직접 관리 + 검품 리포트. (수익: 소싱 수수료 5~10% + 검품 건당 + 월 리테이너)",
  "[사이트 구성] 히어로 / 강점 / 차별점(무역상 vs PM 비교) / 진행과정 / 제작 가능 품목 / 통관·물류 / 비용(양산 시 개발비 무료) / 신뢰 / 인증·품질(3단계 검사+문서 샘플) / KC 인증 / 의뢰 폼 / FAQ.",
  "[기술] 바닐라 HTML/CSS/JS + 단일 파일 Express. 텔레그램·카카오 채널 연동. 정적 랜딩이라 카피·구성·신뢰요소·전환 위주 개선이 현실적.",
].join("\n");

/* ============================================================
   텔레그램 API 헬퍼 (maintainer.js 와 동일)
   ============================================================ */
async function tg(method, body) {
  const r = await fetch(API + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json().catch(function () { return {}; });
}

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
   로컬 명령 실행 (claude / git) — maintainer.js 와 동일
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

// Claude Code 헤드리스 호출 → 응답 텍스트 추출
async function callClaude(prompt) {
  const res = await run(CLAUDE, [
    "-p", prompt,
    "--dangerously-skip-permissions",
    "--output-format", "json",
  ], { timeout: CLAUDE_TIMEOUT_MS });
  if (res.killed) return { text: "", error: "timeout" };
  try {
    const obj = JSON.parse(res.out.trim());
    return { text: (obj && (obj.result || obj.error)) || "", error: obj && obj.is_error ? "is_error" : null };
  } catch (e) {
    return { text: res.out.trim() || res.err.trim(), error: null };
  }
}

/* ============================================================
   대화 상태 (한 방의 흐름을 라운드 간에 이어붙임)
   ============================================================ */
let thread = [];           // [{ who: "💡 아이디어봇"|"🛠️ PM봇"|"👤 사장님", text }]
let pendingProposal = "";  // PM봇이 합의한 '실행 제안' 한 줄 — /apply 대상
let busy = false;

function pushThread(who, text) {
  thread.push({ who: who, text: text });
  if (thread.length > MAX_THREAD) thread = thread.slice(-MAX_THREAD);
}
function threadText() {
  if (!thread.length) return "(아직 대화 없음 — 첫 라운드)";
  return thread.map(function (t) { return t.who + ": " + t.text; }).join("\n");
}

/* ============================================================
   페르소나 프롬프트
   ============================================================ */
function ideaPrompt(topic) {
  return [
    "당신은 MOLDLINE의 '사업기획·그로스 PM' 입니다. 아래 포지셔닝을 깊이 이해하고 있습니다.",
    POSITIONING,
    "",
    "[당신의 역할] 지금까지의 대화를 이어, '작고 구체적이고 이 정적 랜딩 사이트에 바로 반영 가능한' 개선 아이디어를 단 1개 제시합니다.",
    "- 카피/문구, 섹션 구성, 신뢰 요소, 전환(문의 유도), 셀러 타깃 설득에 집중하세요.",
    "- '검품 리포트 샘플 공개', 'FAQ 보강', '비교표에 행 추가'처럼 손에 잡히는 것. 'AI 도입' 같은 거대 담론·새 백엔드 기능은 피하세요.",
    "- 핑퐁이므로 직전 PM봇의 지적이 있으면 반영해 발전시키세요.",
    "- 절대 파일을 수정하지 마세요. 이건 아이디어 토론입니다.",
    "[형식] 3~5문장. 한국어. 'why(셀러에게 왜 효과)'를 한 줄 포함. 마지막에 '제안: <한 줄 요지>'.",
    topic ? ("[이번 주제/방향] " + topic) : "[이번 주제/방향] (지정 없음 — 가장 임팩트 큰 것부터)",
    "",
    "── 지금까지의 대화 ──",
    threadText(),
  ].join("\n");
}

function pmPrompt(latestIdea) {
  return [
    "당신은 MOLDLINE의 '제품 PM·실행 책임자' 입니다. 아래 포지셔닝을 이해하고 있습니다.",
    POSITIONING,
    "",
    "[당신의 역할] 방금 아이디어봇이 낸 제안을 냉정하게 평가합니다.",
    "- 타당성, 구현 난이도(이 사이트는 바닐라 정적 랜딩 — index.html/styles.css/script.js 위주), 우선순위, 리스크를 따집니다.",
    "- 좋으면 '바로 구현 가능한 한 줄 지시'로 더 구체화하고, 과하면 더 작은 대안으로 좁히세요.",
    "- 절대 파일을 수정하지 마세요. 평가·구체화만 합니다.",
    "[형식] 2~4문장 한국어 평가 후, 반드시 마지막 줄을 아래 둘 중 하나로 끝내세요:",
    "  · 실행할 가치가 있으면 →  👉 실행 제안: <Claude Code 유지보수 봇에 그대로 줄 수 있는 한 줄 지시>",
    "  · 보류가 낫다면      →  👉 실행 제안: 보류 — <이유>",
    "",
    "── 아이디어봇의 이번 제안 ──",
    latestIdea,
    "",
    "── 지금까지의 대화 ──",
    threadText(),
  ].join("\n");
}

// PM봇 응답에서 '실행 제안' 한 줄 추출
function extractProposal(pmText) {
  const m = String(pmText).match(/👉\s*실행\s*제안:\s*(.+)\s*$/m);
  if (!m) return "";
  const line = m[1].trim();
  if (/^보류/.test(line)) return "";
  return line;
}

/* ============================================================
   한 라운드: 💡 아이디어 → 🛠️ PM 평가
   ============================================================ */
async function runRound(chatId, topic) {
  await send(chatId, "💭 라운드 시작…" + (topic ? (" (주제: " + topic + ")") : "") + "\n잠시만요, 두 봇이 핑퐁합니다.");

  // 1) 아이디어봇
  const idea = await callClaude(ideaPrompt(topic));
  if (idea.error === "timeout") { await send(chatId, "⏱️ 아이디어 생성이 시간 초과됐어요. 다시 /go 해주세요."); return; }
  const ideaText = (idea.text || "(빈 응답)").trim();
  pushThread("💡 아이디어봇", ideaText);
  await send(chatId, "💡 아이디어봇\n" + ideaText);

  // 2) PM봇
  const pm = await callClaude(pmPrompt(ideaText));
  if (pm.error === "timeout") { await send(chatId, "⏱️ PM 평가가 시간 초과됐어요. /more 로 이어가거나 다시 /go 하세요."); return; }
  const pmText = (pm.text || "(빈 응답)").trim();
  pushThread("🛠️ PM봇", pmText);
  await send(chatId, "🛠️ PM봇\n" + pmText);

  // 3) 합의된 실행 제안 보관
  const prop = extractProposal(pmText);
  if (prop) {
    pendingProposal = prop;
    await send(chatId,
      "📌 이번 라운드의 실행 제안:\n" + prop +
      "\n\n• 마음에 들면 /apply — 유지보수 봇이 실제로 수정·커밋합니다 (배포는 그 뒤 /push)." +
      "\n• 더 다듬고 싶으면 /more 또는 방향을 한 줄로 적어 보내세요." +
      "\n• 새 주제로 가려면 /go <주제>.");
  } else {
    await send(chatId, "🤔 이번 제안은 PM봇이 '보류'로 봤어요. /more 로 다른 각도를 보거나, 방향을 한 줄로 적어 보내세요.");
  }
}

/* ============================================================
   /apply — 합의된 제안을 실제 구현(수정·커밋). 사장님 승인 단계.
   maintainer.js 의 구현 프롬프트를 재사용한다. push 는 하지 않는다.
   ============================================================ */
async function doApply(chatId) {
  if (!pendingProposal) { await send(chatId, "먼저 /go 로 라운드를 돌려 '실행 제안'을 만든 뒤 /apply 하세요."); return; }
  if (await isDirty()) { await send(chatId, "⚠️ 작업트리에 커밋되지 않은 변경이 있어요. 먼저 /status 로 확인 후 정리해 주세요."); return; }

  const proposal = pendingProposal;
  const before = await head();
  await send(chatId, "🛠️ 승인된 제안을 구현합니다…\n" + proposal + "\n\n(수정 → 커밋. 수십 초~몇 분 걸릴 수 있어요)");

  const prompt = [
    "당신은 'MOLDLINE'(아이디어를 중국 양산 제품으로 연결하는 랜딩 사이트) repo의 유지보수를 맡고 있습니다.",
    "바닐라 프론트(index.html, styles.css, script.js)와 단일 파일 Express 백엔드(server.js)로 구성됩니다.",
    "아래는 브레인스토밍에서 합의되어 사람이 승인한 개선 지시입니다. 기존 코드 스타일·구조를 따르고 변경은 최소화하세요.",
    "작업이 끝나면 반드시 변경을 커밋하세요: `git add -A` 후 `git commit` (메시지는 한국어로 무엇을 바꿨는지 요약).",
    "절대 `git push` 하지 마세요 — 푸시는 별도 승인 단계에서 사람이 처리합니다.",
    "지시가 모호하거나 바꿀 내용이 없으면, 수정하지 말고 무엇이 필요한지 한국어로 간단히 답하세요.",
    "마지막 응답에는 무엇을 어떻게 바꿨는지 한국어로 2~4줄 요약을 포함하세요.",
    "",
    "── 승인된 지시 ──",
    proposal,
  ].join("\n");

  const res = await callClaude(prompt);
  if (res.error === "timeout") { await send(chatId, "⏱️ 시간이 초과되어 작업을 중단했습니다. 제안을 더 작게 쪼개 다시 시도하세요."); return; }
  const summary = (res.text || "(요약 없음)").trim();

  const after = await head();
  if (after === before) {
    let msg = "ℹ️ 새 커밋이 없습니다.\n\n" + summary;
    if (await isDirty()) msg += "\n\n⚠️ 커밋되지 않은 변경이 남아 있습니다. /reset 으로 되돌릴 수 있어요.";
    await send(chatId, msg);
    return;
  }

  pendingProposal = ""; // 구현 완료 → 제안 소진
  const stat = (await git(["show", "--stat", "--format=%h %s%n", "HEAD"])).out.trim();
  await send(chatId, "✅ 구현 완료 & 커밋했습니다.\n\n" + summary + "\n\n── 변경 요약 ──\n" + stat +
    "\n\n🚀 배포하려면 /push, 되돌리려면 /reset.");
}

/* ============================================================
   푸시 / 되돌리기 / 상태 (maintainer.js 와 동일)
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
  await send(chatId,
    "📊 상태\n브랜치: " + (await branch()) +
    "\n최근 커밋: " + (await lastSubject()) +
    "\n미커밋 변경: " + ((await isDirty()) ? "있음 ⚠️" : "없음") +
    "\n대기 중 실행 제안: " + (pendingProposal ? ("\n  └ " + pendingProposal) : "없음") +
    "\n대화 턴 누적: " + thread.length + "개");
}

const HELP =
  "🧠 MOLDLINE 브레인스토밍 룸\n\n" +
  "💡 아이디어봇 ↔ 🛠️ PM봇 이 핑퐁하며 개선 아이디어를 냅니다. 봇은 토론만 하고, 코드는 사장님이 /apply 로 승인할 때만 바뀝니다.\n\n" +
  "명령:\n" +
  "/go [주제] — 한 라운드 진행 (주제 없으면 임팩트 큰 것부터)\n" +
  "/more — 직전 흐름을 이어 한 라운드 더\n" +
  "(그냥 한 줄 입력) — 방향을 끼워넣고 한 라운드 진행 (예: \"전환율 위주로\")\n" +
  "/apply — 합의된 실행 제안을 실제 수정·커밋 (배포는 안 함)\n" +
  "/push — 마지막 커밋 배포 / /reset — 마지막 커밋 되돌리기\n" +
  "/status — 상태 / /clear — 대화 흐름 초기화 / /help — 도움말";

/* ============================================================
   메시지 라우팅
   ============================================================ */
async function onMessage(msg) {
  const chatId = msg.chat && msg.chat.id;
  const text = (msg.text || "").trim();
  if (!chatId || !text) return;

  if (ALLOWED.indexOf(String(chatId)) === -1) {
    console.warn("⛔ 허용되지 않은 chat ID:", chatId);
    await send(chatId, "⛔ 이 봇은 허용된 채팅방 전용입니다. (chat ID: " + chatId + ")");
    return;
  }

  const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@.*$/, "");
  const rest = text.slice(text.split(/\s+/)[0].length).trim();

  if (cmd === "/start" || cmd === "/help") { await send(chatId, HELP); return; }
  if (cmd === "/status") { await doStatus(chatId); return; }
  if (cmd === "/clear") { thread = []; pendingProposal = ""; await send(chatId, "🧹 대화 흐름과 대기 제안을 초기화했어요."); return; }
  if (cmd === "/push") { if (busy) { await send(chatId, "⏳ 진행 중입니다."); return; } await doPush(chatId); return; }
  if (cmd === "/reset") { if (busy) { await send(chatId, "⏳ 진행 중입니다."); return; } await doReset(chatId); return; }

  if (busy) { await send(chatId, "⏳ 이전 작업이 진행 중입니다. 끝나면 다시 보내주세요."); return; }
  busy = true;
  try {
    if (cmd === "/go") { await runRound(chatId, rest); }
    else if (cmd === "/more") { await runRound(chatId, ""); }
    else if (cmd === "/apply") { await doApply(chatId); }
    else if (cmd.charAt(0) === "/") { await send(chatId, "모르는 명령이에요. /help 를 보세요."); }
    else {
      // 자유 텍스트 = 사장님의 방향 제시 → 끼워넣고 한 라운드
      pushThread("👤 사장님", text);
      await runRound(chatId, text);
    }
  } catch (e) {
    await send(chatId, "❌ 처리 중 오류: " + (e && e.message || e));
  } finally {
    busy = false;
  }
}

/* ============================================================
   롱 폴링 루프 (maintainer.js 와 동일)
   ============================================================ */
let offset = 0;
async function poll() {
  try {
    const r = await fetch(API + "/getUpdates?timeout=50&offset=" + offset, {});
    const j = await r.json().catch(function () { return {}; });
    if (j && j.ok && Array.isArray(j.result)) {
      for (const upd of j.result) {
        offset = upd.update_id + 1;
        if (upd.message) await onMessage(upd.message);
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
  console.log("✅ 브레인스토밍 봇 시작: @" + me.result.username);
  console.log("   repo:", REPO);
  console.log("   허용 chat ID:", ALLOWED.join(", "));
  console.log("   전용 토큰:", DEDICATED ? "사용" : "폴백(⚠️ 유지보수 봇과 동시 실행 금지)");
  console.log("   Claude:", CLAUDE);
  try {
    const r = await fetch(API + "/getUpdates?offset=-1");
    const j = await r.json();
    if (j && j.ok && j.result.length) offset = j.result[j.result.length - 1].update_id + 1;
  } catch (e) { /* noop */ }
  poll();
})();
