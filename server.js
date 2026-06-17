/* ============================================================
   MOLDLINE — 의뢰 접수 백엔드
   - 정적 프론트엔드 서빙
   - 대용량 도면(STP 등) 업로드: 디스크 저장 (메모리 안 씀)
   - 이메일 알림: 관리자 통지 + 고객 자동회신
   - 관리자 페이지: 접수 내역 조회 + 파일 다운로드 (Basic 인증)
   ============================================================ */
require("dotenv").config();

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;

/* ---- CORS (별도 호스팅된 프론트엔드에서 호출 허용) ----
   CORS_ORIGINS: 쉼표로 구분한 허용 출처 목록(예: "https://moldline.netlify.app,https://moldline.kr").
   비워두면 동일 출처에서만 동작(프론트+백엔드를 한 서버에서 서빙하는 기존 방식). */
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",").map(function (s) { return s.trim(); }).filter(Boolean);
app.use(function (req, res, next) {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204); // 프리플라이트
  next();
});

/* ---- 업로드 설정 ---- */
const MAX_FILES = 10;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 개당 50MB
// 의뢰 1건의 첨부 총합 한도 — nginx client_max_body_size와 맞출 것(deploy/nginx.conf)
const MAX_TOTAL_SIZE = (Number(process.env.MAX_TOTAL_SIZE_MB) || 60) * 1024 * 1024;
// 이메일 첨부 총량 한도 — 이보다 큰 파일은 첨부 대신 서버 경로만 안내
const EMAIL_ATTACH_LIMIT = (Number(process.env.EMAIL_ATTACH_LIMIT_MB) || 20) * 1024 * 1024;

// 디스코드 웹훅 — 설정 시 문의 알림 전송. 첨부 총량 한도(기본 8MB: 디스코드 무료 한도)
const DISCORD_WEBHOOK_URL = (process.env.DISCORD_WEBHOOK_URL || "").trim();
const DISCORD_ATTACH_LIMIT = (Number(process.env.DISCORD_ATTACH_LIMIT_MB) || 8) * 1024 * 1024;
const DISCORD_MENTION = process.env.DISCORD_MENTION || ""; // 예: "@here" 또는 "<@&역할ID>"
const discordReady = !!DISCORD_WEBHOOK_URL;
// 진단용: 적용된 웹훅의 ID 부분만(토큰 제외) — 어떤 URL이 배포에 반영됐는지 식별
const DISCORD_WEBHOOK_ID = (DISCORD_WEBHOOK_URL.match(/webhooks\/(\d+)/) || [])[1] || null;
// Discord 앞단 Cloudflare가 UA 없는 데이터센터 요청을 차단(429 HTML)하므로 정상 UA를 명시
const DISCORD_UA = "MOLDLINE-Webhook/1.0 (+https://moldline-ccvd.onrender.com)";

// 텔레그램 알림 — Discord와 달리 Cloudflare 봇 차단이 없어 데이터센터(Render 등)에서 안정적.
// @BotFather로 봇 생성 → 토큰, 봇과 대화방의 chat_id 필요. 봇 업로드 한도 50MB.
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || "").trim();
const TELEGRAM_ATTACH_LIMIT = (Number(process.env.TELEGRAM_ATTACH_LIMIT_MB) || 50) * 1024 * 1024;
const TELEGRAM_API = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;
const telegramReady = !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);

const UPLOAD_ROOT = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

// 허용 확장자 (도면/이미지/문서/압축)
const ALLOWED_EXT = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
  ".pdf", ".txt", ".doc", ".docx",
  ".stp", ".step", ".stl", ".igs", ".iges", ".x_t", ".x_b", ".sldprt", ".3dm", ".obj",
  ".zip", ".rar", ".7z"
]);

const FORBIDDEN_CHARS = /[<>:"/\\|?*]/g; // 파일시스템 금지문자
function safeName(name) {
  // 금지문자만 치환 (한글·숫자·점·공백·대시는 보존)
  const base = path.basename(name)
    .replace(FORBIDDEN_CHARS, "_")
    .replace(/^\.+/, "_"); // 선행 점(숨김/상대경로) 방지
  return base.slice(0, 180) || "file";
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // 요청별 폴더 (한 의뢰의 파일을 한곳에)
    if (!req._uploadDir) {
      const id = new Date().toISOString().replace(/[:.]/g, "-") +
        "_" + crypto.randomBytes(3).toString("hex");
      req._submissionId = id;
      req._uploadDir = path.join(UPLOAD_ROOT, id);
      fs.mkdirSync(req._uploadDir, { recursive: true });
    }
    cb(null, req._uploadDir);
  },
  filename: function (req, file, cb) {
    // 원본명 보존(다국어 대응) + 충돌 방지 prefix
    const original = Buffer.from(file.originalname, "latin1").toString("utf8");
    file._displayName = original;
    cb(null, crypto.randomBytes(4).toString("hex") + "__" + safeName(original));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter: function (req, file, cb) {
    const original = Buffer.from(file.originalname, "latin1").toString("utf8");
    const ext = path.extname(original).toLowerCase();
    if (ALLOWED_EXT.has(ext)) return cb(null, true);
    cb(new Error("허용되지 않는 파일 형식입니다: " + ext));
  }
});

/* ---- 메일 트랜스포터 ---- */
let transporter = null;
let mailReady = false;

if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE) === "true", // 465면 true
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  transporter.verify(function (err) {
    if (err) console.warn("⚠️  SMTP 연결 확인 실패:", err.message);
    else { mailReady = true; console.log("✓ SMTP 준비 완료"); }
  });
} else {
  console.warn("⚠️  SMTP 환경변수가 없습니다 — 메일 없이 접수만 저장됩니다. (.env 설정 필요)");
}

// 진단용: 시작 시 웹훅 URL 유효성을 GET으로 1회 확인 (null=미확인)
let discordWebhookValid = null;
let discordWebhookStatus = null; // GET 응답 상태코드 또는 오류 메시지(진단용)
let lastDiscord = null;          // 마지막 전송 시도 결과(진단용)
if (DISCORD_WEBHOOK_URL) {
  console.log("✓ 디스코드 웹훅 알림 활성화");
  if (typeof fetch !== "function") {
    discordWebhookValid = false;
    discordWebhookStatus = "no-fetch";
    console.warn("⚠️  이 Node 런타임에 전역 fetch가 없습니다 (Node 18+ 필요) — 디스코드 전송 불가:", process.version);
  } else {
    (async function () {
      try {
        const r = await fetch(DISCORD_WEBHOOK_URL, { method: "GET", headers: { "User-Agent": DISCORD_UA } });
        discordWebhookValid = r.ok;
        discordWebhookStatus = r.status;
        console.log(discordWebhookValid
          ? "✓ 디스코드 웹훅 URL 검증 통과"
          : "⚠️  디스코드 웹훅 URL 무효 — status " + r.status + " (대시보드 DISCORD_WEBHOOK_URL 확인 필요)");
      } catch (e) {
        discordWebhookValid = false;
        discordWebhookStatus = "error:" + e.message;
        console.warn("⚠️  디스코드 웹훅 검증 중 오류:", e.message);
      }
    })();
  }
} else {
  console.warn("⚠️  DISCORD_WEBHOOK_URL 미설정 — 디스코드 알림 비활성화");
}

// 진단용: 시작 시 텔레그램 봇 토큰 유효성을 getMe로 1회 확인 (null=미확인)
let telegramValid = null;
let telegramStatus = null; // getMe 응답 상태코드 또는 오류 메시지
let lastTelegram = null;   // 마지막 전송 시도 결과
if (telegramReady) {
  console.log("✓ 텔레그램 알림 활성화");
  if (typeof fetch !== "function") {
    telegramValid = false;
    telegramStatus = "no-fetch";
    console.warn("⚠️  전역 fetch 없음 (Node 18+ 필요) — 텔레그램 전송 불가:", process.version);
  } else {
    (async function () {
      try {
        const r = await fetch(TELEGRAM_API + "/getMe");
        const j = await r.json().catch(function () { return {}; });
        telegramValid = !!(r.ok && j.ok);
        telegramStatus = r.status;
        console.log(telegramValid
          ? "✓ 텔레그램 봇 토큰 검증 통과 (@" + ((j.result && j.result.username) || "?") + ")"
          : "⚠️  텔레그램 봇 토큰 무효 — status " + r.status + " (TELEGRAM_BOT_TOKEN 확인 필요)");
      } catch (e) {
        telegramValid = false;
        telegramStatus = "error:" + e.message;
        console.warn("⚠️  텔레그램 검증 중 오류:", e.message);
      }
    })();
  }
} else {
  console.warn("⚠️  TELEGRAM_BOT_TOKEN/CHAT_ID 미설정 — 텔레그램 알림 비활성화");
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildAdminHtml(d, files) {
  const rows = [
    ["이름/회사", d.name],
    ["연락처", d.phone],
    ["이메일", d.email],
    ["제품 분류", d.category],
    ["예상 수량", d.qty],
    ["예상 예산", d.budget]
  ].map(function (r) {
    return `<tr><td style="padding:8px 12px;background:#f4f6fa;font-weight:600;white-space:nowrap">${esc(r[0])}</td>
            <td style="padding:8px 12px">${esc(r[1]) || "-"}</td></tr>`;
  }).join("");

  const fileRows = files.length
    ? files.map(function (f) {
        return `<li>${esc(f.displayName)} <span style="color:#888">(${(f.size / 1048576).toFixed(2)} MB)${f.attached ? "" : " — 용량 초과, 서버 보관"}</span></li>`;
      }).join("")
    : "<li>첨부 없음</li>";

  return `
  <div style="font-family:system-ui,'Malgun Gothic',sans-serif;max-width:640px;margin:0 auto;color:#0e1726">
    <div style="background:#0e1726;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
      <h2 style="margin:0;font-size:18px">🔔 새 제품화 의뢰가 접수되었습니다</h2>
      <p style="margin:6px 0 0;color:#ffcf2d;font-size:13px">접수번호: ${esc(d.submissionId)}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e3e7ee;border-top:0">${rows}</table>
    <div style="padding:16px 24px;border:1px solid #e3e7ee;border-top:0">
      <h3 style="font-size:14px;margin:0 0 8px">아이디어 설명</h3>
      <p style="white-space:pre-wrap;margin:0;line-height:1.6">${esc(d.idea)}</p>
    </div>
    <div style="padding:16px 24px;border:1px solid #e3e7ee;border-top:0;border-radius:0 0 12px 12px">
      <h3 style="font-size:14px;margin:0 0 8px">첨부 파일</h3>
      <ul style="margin:0;padding-left:18px;line-height:1.7">${fileRows}</ul>
      <p style="color:#888;font-size:12px;margin-top:10px">서버 보관 위치: uploads/${esc(d.submissionId)}/</p>
    </div>
  </div>`;
}

function buildCustomerHtml(d) {
  const contact = process.env.CONTACT_EMAIL || process.env.MAIL_TO || "";
  return `
  <div style="font-family:system-ui,'Malgun Gothic',sans-serif;max-width:600px;margin:0 auto;color:#0e1726">
    <div style="background:#0e1726;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
      <h2 style="margin:0;font-size:20px">MOLD<span style="color:#ffcf2d">LINE</span></h2>
    </div>
    <div style="padding:28px 24px;border:1px solid #e3e7ee;border-top:0;border-radius:0 0 12px 12px">
      <p><strong>${esc(d.name)}</strong> 님, 의뢰가 정상 접수되었습니다.</p>
      <p style="color:#5a6678;line-height:1.7">
        보내주신 아이디어를 검토한 뒤, 영업일 기준 <strong>1~2일 내</strong>에 담당 PM이 직접 연락드리겠습니다.
        금형·개발비 견적은 공장 회신에 따라 통상 3~7일 정도 소요됩니다.
      </p>
      <div style="background:#f4f6fa;border-radius:10px;padding:16px;margin:18px 0">
        <p style="margin:0 0 4px;font-size:13px;color:#888">접수번호</p>
        <p style="margin:0;font-weight:700">${esc(d.submissionId)}</p>
      </div>
      <p style="color:#5a6678;font-size:14px">문의: <a href="mailto:${esc(contact)}" style="color:#f5b800">${esc(contact)}</a></p>
    </div>
  </div>`;
}

/* ============================================================
   디스코드 알림 (웹훅)
   - 문의가 오면 채널로 임베드 메시지 전송
   - 한도 내 첨부파일은 함께 업로드, 초과분은 목록으로 안내
   ============================================================ */
async function notifyDiscord(data, files) {
  if (!discordReady) return false;

  // 첨부 선별 (개별·누적 모두 한도 이내)
  const attach = [];
  let total = 0;
  for (const f of files) {
    if (f.size <= DISCORD_ATTACH_LIMIT && total + f.size <= DISCORD_ATTACH_LIMIT) {
      attach.push(f);
      total += f.size;
    }
  }
  const skipped = files.filter(function (f) { return attach.indexOf(f) < 0; });

  // 임베드 필드 (값은 1024자 제한)
  function field(name, value, inline) {
    return { name: name, value: (value && String(value).slice(0, 1024)) || "-", inline: !!inline };
  }
  const fields = [
    field("이름 / 회사", data.name, true),
    field("연락처", data.phone, true),
    field("이메일", data.email, true),
    field("제품 분류", data.category, true),
    field("예상 수량", data.qty, true),
    field("예상 예산", data.budget, true),
    field("아이디어 설명", data.idea)
  ];
  if (files.length) {
    const lines = files.map(function (f) {
      const mb = (f.size / 1048576).toFixed(2);
      const mark = attach.indexOf(f) >= 0 ? "📎" : "🗄️";
      const tail = attach.indexOf(f) >= 0 ? "" : " (용량 초과 — 서버 보관)";
      return mark + " " + f.displayName + " (" + mb + "MB)" + tail;
    });
    fields.push(field("첨부 파일 (" + files.length + ")", lines.join("\n")));
  }

  const embed = {
    title: "🔔 새 제품화 의뢰가 접수되었습니다",
    color: 0xffcf2d,
    fields: fields,
    footer: { text: "접수번호 " + data.submissionId },
    timestamp: new Date().toISOString()
  };

  const payload = { embeds: [embed] };
  if (DISCORD_MENTION) {
    payload.content = DISCORD_MENTION;
    payload.allowed_mentions = { parse: ["roles", "users", "everyone"] };
  }

  if (typeof fetch !== "function") {
    console.warn("⚠️  디스코드 전송 불가 — 전역 fetch 없음 (Node 18+ 필요):", process.version);
    return false;
  }

  // 한 번 전송 시도 (multipart는 매 시도마다 새 폼 필요)
  function sendOnce() {
    if (!attach.length) {
      // 첨부 없음 — 단순 JSON 전송 (multipart/FormData/Blob 불필요해 더 견고)
      return fetch(DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": DISCORD_UA },
        body: JSON.stringify(payload)
      });
    }
    // 첨부 있음 — multipart로 파일 동봉
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    attach.forEach(function (f, i) {
      const buf = fs.readFileSync(f.path);
      form.append("files[" + i + "]", new Blob([buf]), f.displayName);
    });
    return fetch(DISCORD_WEBHOOK_URL, { method: "POST", headers: { "User-Agent": DISCORD_UA }, body: form });
  }

  // 429(레이트리밋)면 retry_after 만큼 대기 후 재시도 (최대 3회)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await sendOnce();
      if (res.ok) {
        lastDiscord = { at: new Date().toISOString(), ok: true, status: res.status, attempt: attempt };
        if (skipped.length) {
          console.log("ℹ️  디스코드 첨부 제외(용량):", skipped.map(function (f) { return f.displayName; }).join(", "));
        }
        return true;
      }
      const body = await res.text().catch(function () { return ""; });
      lastDiscord = { at: new Date().toISOString(), ok: false, status: res.status, attempt: attempt, body: body.slice(0, 200) };
      console.warn("⚠️  디스코드 전송 실패(" + attempt + "회차):", res.status, body.slice(0, 200));
      if (res.status === 429 && attempt < 3) {
        let wait = 1500;
        try { const j = JSON.parse(body); if (j.retry_after) wait = Math.min(Number(j.retry_after) * 1000 + 250, 8000); } catch (e) {}
        await new Promise(function (r) { setTimeout(r, wait); });
        continue;
      }
      return false;
    } catch (e) {
      lastDiscord = { at: new Date().toISOString(), ok: false, status: "error", attempt: attempt, body: e.message };
      console.warn("⚠️  디스코드 전송 오류(" + attempt + "회차):", e.message);
      return false;
    }
  }
  return false;
}

/* ============================================================
   텔레그램 알림 (봇)
   - 문의가 오면 지정 채팅방으로 메시지 전송
   - 한도(50MB) 내 첨부는 sendDocument로 동봉, 초과분은 목록으로 안내
   ============================================================ */
async function notifyTelegram(data, files) {
  if (!telegramReady) return false;
  if (typeof fetch !== "function") {
    console.warn("⚠️  텔레그램 전송 불가 — 전역 fetch 없음 (Node 18+ 필요):", process.version);
    return false;
  }

  // 첨부 선별 (개별·누적 모두 한도 이내)
  const attach = [];
  let total = 0;
  for (const f of files) {
    if (f.size <= TELEGRAM_ATTACH_LIMIT && total + f.size <= TELEGRAM_ATTACH_LIMIT) {
      attach.push(f);
      total += f.size;
    }
  }

  // 메시지 본문 (HTML parse_mode, 4096자 제한)
  function row(label, value) {
    return "<b>" + esc(label) + ":</b> " + (esc(value) || "-");
  }
  const lines = [
    "🔔 <b>새 제품화 의뢰가 접수되었습니다</b>",
    "접수번호: <code>" + esc(data.submissionId) + "</code>",
    "",
    row("이름/회사", data.name),
    row("연락처", data.phone),
    row("이메일", data.email),
    row("제품 분류", data.category),
    row("예상 수량", data.qty),
    row("예상 예산", data.budget),
    "",
    "<b>아이디어</b>",
    esc(data.idea)
  ];
  if (files.length) {
    lines.push("", "<b>첨부 (" + files.length + ")</b>");
    files.forEach(function (f) {
      const mb = (f.size / 1048576).toFixed(2);
      const mark = attach.indexOf(f) >= 0 ? "📎" : "🗄️";
      const tail = attach.indexOf(f) >= 0 ? "" : " (용량 초과 — 서버 보관)";
      lines.push(mark + " " + esc(f.displayName) + " (" + mb + "MB)" + tail);
    });
  }
  const text = lines.join("\n").slice(0, 4096);

  // 1회 전송 + 429(레이트리밋) 시 retry_after 만큼 대기 후 재시도 (최대 3회)
  async function send(makeRequest) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      let res;
      try { res = await makeRequest(); }
      catch (e) { return { ok: false, status: "error", body: e.message }; }
      if (res.ok) return { ok: true, status: res.status, body: "" };
      const body = await res.text().catch(function () { return ""; });
      if (res.status === 429 && attempt < 3) {
        let wait = 1500;
        try {
          const j = JSON.parse(body);
          if (j.parameters && j.parameters.retry_after) wait = Math.min(Number(j.parameters.retry_after) * 1000 + 250, 8000);
        } catch (e) {}
        await new Promise(function (r) { setTimeout(r, wait); });
        continue;
      }
      return { ok: false, status: res.status, body: body.slice(0, 200) };
    }
    return { ok: false, status: "retry-exhausted", body: "" };
  }

  // 메시지 먼저 전송
  const msg = await send(function () {
    return fetch(TELEGRAM_API + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    });
  });
  if (!msg.ok) {
    lastTelegram = { at: new Date().toISOString(), ok: false, status: msg.status, body: msg.body };
    console.warn("⚠️  텔레그램 전송 실패:", msg.status, msg.body);
    return false;
  }

  // 한도 내 첨부를 문서로 전송 (재시도마다 폼을 새로 만들어야 하므로 클로저 내부에서 생성)
  for (const f of attach) {
    const buf = fs.readFileSync(f.path);
    const dr = await send(function () {
      const form = new FormData();
      form.append("chat_id", TELEGRAM_CHAT_ID);
      form.append("document", new Blob([buf]), f.displayName);
      return fetch(TELEGRAM_API + "/sendDocument", { method: "POST", body: form });
    });
    if (!dr.ok) console.warn("⚠️  텔레그램 첨부 실패(" + f.displayName + "):", dr.status, String(dr.body).slice(0, 120));
  }

  lastTelegram = { at: new Date().toISOString(), ok: true, status: 200 };
  return true;
}

/* ============================================================
   관리자 인증 (HTTP Basic) — /api/admin/* 보호
   ============================================================ */
function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function adminAuth(req, res, next) {
  const user = process.env.ADMIN_USER || "admin";
  const pass = process.env.ADMIN_PASS;
  if (!pass) {
    return res.status(503).json({ ok: false, error: "ADMIN_PASS가 설정되지 않았습니다. .env를 확인하세요." });
  }
  const hdr = req.headers.authorization || "";
  const m = hdr.match(/^Basic (.+)$/);
  if (m) {
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    const u = decoded.slice(0, idx);
    const p = decoded.slice(idx + 1);
    if (timingSafeEqual(u, user) && timingSafeEqual(p, pass)) return next();
  }
  // WWW-Authenticate 헤더는 일부러 생략 — 이게 있으면 브라우저가 기본 Basic 인증 팝업을
  // 띄움. admin.html의 커스텀 로그인 폼이 Authorization 헤더로 인증을 처리하므로 불필요(중복 팝업 방지).
  return res.status(401).json({ ok: false, error: "인증이 필요합니다." });
}

// 접수 폴더 1개를 읽어 메타+실제 파일 목록으로 변환
function readSubmission(id) {
  const dir = path.join(UPLOAD_ROOT, id);
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, "_submission.json"), "utf8")); }
  catch (e) { /* 메타 없음 */ }

  let files = [];
  try {
    files = fs.readdirSync(dir)
      .filter(function (f) { return f !== "_submission.json"; })
      .map(function (f) {
        const st = fs.statSync(path.join(dir, f));
        return { stored: f, display: f.split("__").slice(1).join("__") || f, size: st.size };
      });
  } catch (e) { /* 폴더 없음 */ }

  return {
    id: id,
    name: meta.name || "", phone: meta.phone || "", email: meta.email || "",
    category: meta.category || "", qty: meta.qty || "", budget: meta.budget || "",
    idea: meta.idea || "", at: meta.at || "",
    files: files
  };
}

/* ---- 관리자 API ---- */
app.use("/api/admin", adminAuth);

app.get("/api/admin/submissions", function (req, res) {
  let dirs = [];
  try {
    dirs = fs.readdirSync(UPLOAD_ROOT, { withFileTypes: true })
      .filter(function (d) { return d.isDirectory(); })
      .map(function (d) { return d.name; });
  } catch (e) { /* 비어있음 */ }

  const items = dirs.map(readSubmission)
    .sort(function (a, b) { return String(b.at || b.id).localeCompare(String(a.at || a.id)); });

  res.json({ ok: true, count: items.length, items: items });
});

app.get("/api/admin/download", function (req, res) {
  const id = String(req.query.id || "");
  const file = String(req.query.file || "");
  // id 형식 화이트리스트 (타임스탬프_hex), 파일명에 경로 구분자 불가
  if (!/^[\w.\-]+$/.test(id) || /[/\\]/.test(file)) {
    return res.status(400).json({ ok: false, error: "잘못된 요청입니다." });
  }
  const dir = path.join(UPLOAD_ROOT, id);
  const target = path.join(dir, file);
  // 경로 이탈 방지
  const rel = path.relative(dir, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return res.status(400).json({ ok: false, error: "잘못된 경로입니다." });
  }
  if (!fs.existsSync(target)) {
    return res.status(404).json({ ok: false, error: "파일을 찾을 수 없습니다." });
  }
  const display = file.split("__").slice(1).join("__") || file;
  res.download(target, display);
});

// 접수 1건 삭제 (폴더+첨부 통째로). id는 query로 전달.
app.post("/api/admin/delete", function (req, res) {
  const id = String(req.query.id || "");
  // id 형식 화이트리스트 (다운로드와 동일) — 경로 구분자/상위경로 차단
  if (!/^[\w.\-]+$/.test(id)) {
    return res.status(400).json({ ok: false, error: "잘못된 요청입니다." });
  }
  const dir = path.join(UPLOAD_ROOT, id);
  // 경로 이탈 방지 — UPLOAD_ROOT 바로 아래 폴더만 허용
  const rel = path.relative(UPLOAD_ROOT, dir);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel) || rel.indexOf(path.sep) >= 0) {
    return res.status(400).json({ ok: false, error: "잘못된 경로입니다." });
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return res.status(404).json({ ok: false, error: "접수를 찾을 수 없습니다." });
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return res.json({ ok: true, deleted: id });
});

/* ---- 정적 프론트엔드 ---- */
app.use(express.static(__dirname, { extensions: ["html"] }));

/* ---- 의뢰 접수 API ---- */
app.post("/api/submit", function (req, res) {
  upload.any()(req, res, async function (err) {
    if (err) {
      let msg = err.message || "업로드 오류";
      if (err.code === "LIMIT_FILE_SIZE") msg = "파일이 50MB를 초과합니다.";
      if (err.code === "LIMIT_FILE_COUNT") msg = "파일은 최대 " + MAX_FILES + "개까지 가능합니다.";
      return res.status(400).json({ ok: false, error: msg });
    }

    // 첨부 총합 한도 체크 (개별 파일은 multer가 이미 통과시킨 상태)
    const totalSize = (req.files || []).reduce(function (sum, f) { return sum + f.size; }, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      if (req._uploadDir) fs.rm(req._uploadDir, { recursive: true, force: true }, function () {});
      return res.status(400).json({
        ok: false,
        error: "첨부 파일 총합이 " + (MAX_TOTAL_SIZE / 1048576).toFixed(0) + "MB를 초과합니다."
      });
    }

    const b = req.body || {};
    // 필수값 검증
    const required = ["name", "phone", "email", "idea"];
    for (const key of required) {
      if (!b[key] || !String(b[key]).trim()) {
        return res.status(400).json({ ok: false, error: "필수 항목이 누락되었습니다." });
      }
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) {
      return res.status(400).json({ ok: false, error: "이메일 형식이 올바르지 않습니다." });
    }

    const data = {
      submissionId: req._submissionId || "no-files",
      name: b.name, phone: b.phone, email: b.email,
      category: b.category, qty: b.qty, budget: b.budget, idea: b.idea
    };

    // 첨부 분류 (이메일 한도 내만 첨부)
    const files = (req.files || []).map(function (f) {
      const display = f._displayName || f.originalname;
      const attached = f.size <= EMAIL_ATTACH_LIMIT;
      return { path: f.path, displayName: display, size: f.size, attached: attached };
    });

    // 접수 로그 (메일 실패해도 기록 남김)
    try {
      const logDir = req._uploadDir || UPLOAD_ROOT;
      fs.writeFileSync(path.join(logDir, "_submission.json"),
        JSON.stringify({ ...data, files: files.map(f => ({ name: f.displayName, size: f.size })), at: new Date().toISOString() }, null, 2));
    } catch (e) { /* 무시 */ }

    // 디스코드 알림 (메일과 독립적으로, 실패해도 접수는 성공 처리)
    let discordSent = false;
    if (discordReady) {
      discordSent = await notifyDiscord(data, files);
    }

    // 텔레그램 알림 (메일·디스코드와 독립적으로, 실패해도 접수는 성공 처리)
    let telegramSent = false;
    if (telegramReady) {
      telegramSent = await notifyTelegram(data, files);
    }

    // 메일 발송
    if (mailReady) {
      const attachments = files
        .filter(function (f) { return f.attached; })
        .map(function (f) { return { filename: f.displayName, path: f.path }; });

      try {
        // 관리자 통지
        await transporter.sendMail({
          from: process.env.MAIL_FROM || process.env.SMTP_USER,
          to: process.env.MAIL_TO,
          replyTo: data.email,
          subject: `[의뢰] ${data.name} — ${data.category || "제품 미분류"}`,
          html: buildAdminHtml(data, files),
          attachments: attachments
        });

        // 고객 자동회신
        await transporter.sendMail({
          from: process.env.MAIL_FROM || process.env.SMTP_USER,
          to: data.email,
          subject: "[MOLDLINE] 제품화 의뢰가 접수되었습니다",
          html: buildCustomerHtml(data)
        }).catch(function (e) { console.warn("고객 자동회신 실패:", e.message); });

      } catch (e) {
        console.error("관리자 메일 발송 실패:", e.message);
        // 파일은 저장됐으므로 접수 자체는 성공 처리하되, 운영자가 로그로 확인
        return res.json({ ok: true, submissionId: data.submissionId, mail: false, discord: discordSent, telegram: telegramSent });
      }
    }

    return res.json({ ok: true, submissionId: data.submissionId, mail: mailReady, discord: discordSent, telegram: telegramSent });
  });
});

/* ---- 헬스체크 ---- */
app.get("/api/health", function (req, res) {
  res.json({
    ok: true,
    node: process.version,
    uptimeSec: Math.round(process.uptime()),
    hasFetch: typeof fetch === "function",
    hasFormData: typeof FormData === "function",
    mail: mailReady,
    discord: discordReady,
    discordWebhookId: DISCORD_WEBHOOK_ID, // 적용된 웹훅 ID(토큰 제외)
    discordWebhookValid: discordWebhookValid, // true=URL유효, false=무효/fetch없음, null=미확인
    discordWebhookStatus: discordWebhookStatus, // GET 상태코드(401=토큰오류 등) 또는 오류
    lastDiscord: lastDiscord, // 마지막 전송 시도 결과(상태/본문)
    telegram: telegramReady, // TELEGRAM_BOT_TOKEN+CHAT_ID 설정 여부
    telegramValid: telegramValid, // true=토큰유효, false=무효/fetch없음, null=미확인
    telegramStatus: telegramStatus, // getMe 상태코드 또는 오류
    lastTelegram: lastTelegram // 마지막 전송 시도 결과
  });
});

app.listen(PORT, function () {
  console.log("\n  MOLDLINE 서버 실행 중  →  http://localhost:" + PORT);
  console.log("  관리자 페이지       →  http://localhost:" + PORT + "/admin\n");
});
