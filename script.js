/* ============================================================
   MOLDLINE — 인터랙션 & 폼 처리
   ============================================================ */
(function () {
  "use strict";

  /* ---- 연도 ---- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---- 카카오톡 상담 채널 ----
     window.MOLDLINE_KAKAO_URL 이 설정돼 있으면 [data-kakao] 링크에 주소를 연결하고
     관련 요소를 노출, 미설정 시 깨진 링크 대신 모두 숨김. */
  var kakaoUrl = (window.MOLDLINE_KAKAO_URL || "").trim();
  document.querySelectorAll("[data-kakao]").forEach(function (el) {
    if (kakaoUrl) {
      el.setAttribute("href", kakaoUrl);
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  });
  // 카카오 채널이 있을 때만 함께 보이는 보조 문구/래퍼
  document.querySelectorAll("[data-kakao-or]").forEach(function (el) { el.hidden = !kakaoUrl; });

  /* ---- 모바일 메뉴 ---- */
  var nav = document.getElementById("nav");
  var navToggle = document.getElementById("navToggle");
  if (navToggle) {
    navToggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.querySelectorAll(".nav__links a").forEach(function (a) {
      a.addEventListener("click", function () {
        nav.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ============================================================
     애플 스타일 스크롤 인터랙션
     - 섹션별 reveal 변형 + 순차 등장(스태거)
     - 이미지 패럴럭스 · 히어로 스크롤 페이드 · nav 스크롤 상태
     ============================================================ */
  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setReveal(el, variant, delay) {
    if (!el || el.hasAttribute("data-reveal")) return;
    el.setAttribute("data-reveal", variant || "up");
    if (delay) el.style.setProperty("--reveal-delay", delay + "ms");
  }
  function groupReveal(containerSel, itemSel, variant, step, cap) {
    document.querySelectorAll(containerSel).forEach(function (c) {
      Array.prototype.forEach.call(c.querySelectorAll(itemSel), function (el, i) {
        setReveal(el, variant, Math.min(i, cap || 6) * (step || 80));
      });
    });
  }

  /* 콘텐츠 그룹 — 순차 등장 */
  groupReveal(".stats__inner", ".stat", "up", 90);
  groupReveal(".cards", ".card", "up", 80);
  /* 제작 사례 카드는 핀 고정 가로 스크롤로 등장하므로 reveal 제외 */
  groupReveal(".steps", ".step", "up", 90);
  groupReveal(".certs", ".cert", "scale", 55);
  groupReveal(".qc__steps", ".qc__step", "up", 70);
  groupReveal(".pricing", ".price-card", "up", 110);
  groupReveal(".faq", ".faq__item", "up", 55);

  /* 신뢰 섹션 — 좌우 분할 슬라이드 */
  setReveal(document.querySelector(".trust__text"), "left");
  setReveal(document.querySelector(".trust__panel"), "right");

  /* 미디어 카드 / KC 배너 — 페이드(내부 이미지 패럴럭스와 겹치지 않게 이동 없음) */
  document.querySelectorAll(".media-card, .kc-banner").forEach(function (el) { setReveal(el, "fade"); });

  /* 푸터 컬럼 */
  var footerInner = document.querySelector(".footer__inner");
  if (footerInner) Array.prototype.forEach.call(footerInner.children, function (el, i) { setReveal(el, "up", i * 90); });

  /* 섹션 헤더 — eyebrow → title → lead 캐스케이드 (이미 reveal 내부면 제외) */
  document.querySelectorAll("section").forEach(function (sec) {
    if (sec.classList.contains("hero")) return;
    [".eyebrow", ".section__title", ".section__lead"].forEach(function (sel, i) {
      var el = sec.querySelector(sel);
      if (el && !el.closest("[data-reveal]")) setReveal(el, "up", i * 70);
    });
  });

  /* 히어로 — 로드 시 순차 등장 */
  var heroBits = [];
  document.querySelectorAll(".hero .eyebrow, .hero__title, .hero__sub, .hero__cta, .hero__badges")
    .forEach(function (el, i) { setReveal(el, "up", i * 90); heroBits.push(el); });

  /* IntersectionObserver — 뷰포트 진입 시 등장 */
  if (!prefersReduced && "IntersectionObserver" in window) {
    // 진입 시 등장, 이탈 시 원위치 — 스크롤을 내렸다 올리면 효과가 반대로 다시 재생됨(양방향)
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        e.target.classList.toggle("is-in", e.isIntersecting);
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll("[data-reveal]").forEach(function (el) {
      if (!el.closest(".hero")) io.observe(el);
    });
  } else {
    document.querySelectorAll("[data-reveal]").forEach(function (el) { el.classList.add("is-in"); });
  }

  /* 히어로는 로드 직후 등장 */
  if (!prefersReduced) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        heroBits.forEach(function (el) { el.classList.add("is-in"); });
      });
    });
  }

  /* ============================================================
     스크롤 스파이 — 화면 중앙에 걸린 섹션에 따라 nav 링크 강조(상태 변경)
     ============================================================ */
  (function () {
    var links = {};
    document.querySelectorAll('.nav__links a[href^="#"]').forEach(function (a) {
      var id = a.getAttribute("href").slice(1);
      if (id) links[id] = a;
    });
    var targets = Object.keys(links)
      .map(function (id) { return document.getElementById(id); })
      .filter(Boolean);
    if (!("IntersectionObserver" in window) || !targets.length) return;
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        Object.keys(links).forEach(function (id) {
          links[id].classList.toggle("is-active", id === e.target.id);
        });
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    targets.forEach(function (t) { spy.observe(t); });
  })();

  /* 이미지 패럴럭스 대상 */
  var parallaxImgs = [];
  if (!prefersReduced) {
    document.querySelectorAll(".photo-banner img, .kc-banner img, .media-card img").forEach(function (img) {
      img.classList.add("has-parallax");
      parallaxImgs.push(img);
    });
  }

  /* ============================================================
     핀 고정 가로 스크롤 (#cases) — 세로 스크롤로 카드가 좌우로 이동
     - 트랙 폭이 화면보다 넓고, 모션 허용·데스크톱일 때만 핀 모드
     - 그 외(모바일/모션축소)는 CSS 폴백(가로 스와이프, 스크롤바 숨김)
     ============================================================ */
  var hs = document.getElementById("casesHscroll");
  var hsTrack = hs ? hs.querySelector(".portfolio") : null;
  var hsMaxX = 0, hsEnabled = false;
  function hsCanPin() {
    return !!hs && !!hsTrack && !prefersReduced &&
      window.innerWidth >= 768 && hsTrack.scrollWidth > window.innerWidth + 40;
  }
  function hsMeasure() {
    if (!hs || !hsTrack) return;
    var should = hsCanPin();
    if (should && !hsEnabled) { hsEnabled = true; hs.classList.add("is-pinned"); }
    else if (!should && hsEnabled) {
      hsEnabled = false; hs.classList.remove("is-pinned");
      hs.style.height = ""; hsTrack.style.transform = "";
    }
    if (hsEnabled) {
      hsMaxX = Math.max(0, hsTrack.scrollWidth - window.innerWidth);
      hs.style.height = (window.innerHeight + hsMaxX) + "px";
    }
  }
  function hsUpdate() {
    if (!hsEnabled) return;
    var top = hs.getBoundingClientRect().top;
    var scrolled = Math.min(Math.max(-top, 0), hsMaxX);
    hsTrack.style.transform = "translate3d(" + (-scrolled).toFixed(1) + "px,0,0)";
  }
  hsMeasure();
  window.addEventListener("load", function () { hsMeasure(); hsUpdate(); });

  var heroInner = document.querySelector(".hero__inner");
  var heroGrid = document.querySelector(".hero__grid");

  function onScrollFx() {
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    if (nav) nav.classList.toggle("is-scrolled", y > 18);
    if (prefersReduced) return;

    /* 히어로 — 스크롤에 따라 위로 밀리며 페이드 */
    if (heroInner && y < 800) {
      heroInner.style.transform = "translate3d(0," + (y * 0.16).toFixed(1) + "px,0)";
      heroInner.style.opacity = String(Math.max(0, 1 - y / 560));
    }
    if (heroGrid && y < 1000) heroGrid.style.transform = "translate3d(0," + (y * 0.28).toFixed(1) + "px,0)";

    /* 이미지 패럴럭스 */
    var vh = window.innerHeight;
    parallaxImgs.forEach(function (img) {
      var host = img.parentElement;
      var r = host.getBoundingClientRect();
      if (r.bottom < -80 || r.top > vh + 80) return;
      var prog = (r.top + r.height / 2 - vh / 2) / vh;
      var shift = (-prog * 26).toFixed(1);
      img.style.transform = "translate3d(0," + shift + "px,0) scale(1.18)";
    });

    /* 핀 고정 가로 스크롤 위치 갱신 */
    hsUpdate();
  }

  var fxTicking = false;
  function onScroll() {
    if (!fxTicking) {
      window.requestAnimationFrame(function () { onScrollFx(); fxTicking = false; });
      fxTicking = true;
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", function () { hsMeasure(); onScroll(); }, { passive: true });
  onScrollFx();

  /* ============================================================
     파일 업로드 (드래그앤드롭 + 미리보기 목록)
     ============================================================ */
  var MAX_FILES = 10;
  var MAX_SIZE = 50 * 1024 * 1024; // 개당 50MB
  var MAX_TOTAL_SIZE = 60 * 1024 * 1024; // 총합 60MB — server.js MAX_TOTAL_SIZE_MB와 동기화
  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("files");
  var fileListEl = document.getElementById("filelist");
  var selectedFiles = []; // {file, id}
  var uid = 0;

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function renderFiles() {
    fileListEl.innerHTML = "";
    selectedFiles.forEach(function (item) {
      var li = document.createElement("li");

      var name = document.createElement("span");
      name.className = "fl__name";
      name.textContent = item.file.name;

      var size = document.createElement("span");
      size.className = "fl__size";
      size.textContent = fmtSize(item.file.size);

      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "fl__remove";
      rm.setAttribute("aria-label", item.file.name + " 삭제");
      rm.textContent = "×";
      rm.addEventListener("click", function () {
        selectedFiles = selectedFiles.filter(function (f) { return f.id !== item.id; });
        renderFiles();
      });

      li.appendChild(name);
      li.appendChild(size);
      li.appendChild(rm);
      fileListEl.appendChild(li);
    });
  }

  function currentTotalSize() {
    return selectedFiles.reduce(function (sum, item) { return sum + item.file.size; }, 0);
  }

  function addFiles(list) {
    var arr = Array.prototype.slice.call(list);
    for (var i = 0; i < arr.length; i++) {
      var f = arr[i];
      if (selectedFiles.length >= MAX_FILES) {
        setNote("파일은 최대 " + MAX_FILES + "개까지 첨부할 수 있습니다.", "err");
        break;
      }
      if (f.size > MAX_SIZE) {
        setNote("'" + f.name + "' 파일이 50MB를 초과합니다.", "err");
        continue;
      }
      if (currentTotalSize() + f.size > MAX_TOTAL_SIZE) {
        setNote("첨부 파일 총합이 " + (MAX_TOTAL_SIZE / 1048576).toFixed(0) + "MB를 초과합니다.", "err");
        continue;
      }
      selectedFiles.push({ file: f, id: ++uid });
    }
    renderFiles();
  }

  if (dropzone && fileInput) {
    dropzone.addEventListener("click", function () { fileInput.click(); });
    dropzone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
    });
    fileInput.addEventListener("change", function () { addFiles(fileInput.files); fileInput.value = ""; });

    ["dragenter", "dragover"].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add("is-drag"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.remove("is-drag"); });
    });
    dropzone.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });
  }

  /* ============================================================
     폼 검증 & 제출
     ============================================================ */
  var form = document.getElementById("ideaForm");
  var noteEl = document.getElementById("formNote");
  var submitBtn = document.getElementById("submitBtn");

  function setNote(msg, type) {
    if (!noteEl) return;
    noteEl.textContent = msg;
    noteEl.className = "form__note" + (type === "ok" ? " is-ok" : type === "err" ? " is-err" : "");
  }

  function markError(field, on) {
    var wrap = field.closest(".field");
    if (wrap) wrap.classList.toggle("has-error", on);
  }

  function validate() {
    var ok = true;
    var firstBad = null;
    var required = form.querySelectorAll("[required]");
    required.forEach(function (el) {
      var valid = el.type === "checkbox" ? el.checked : el.value.trim() !== "";
      if (el.type === "email" && valid) valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim());
      markError(el, !valid);
      if (!valid && !firstBad) firstBad = el;
      if (!valid) ok = false;
    });
    if (firstBad) firstBad.focus();
    return ok;
  }

  // 입력 시 에러 해제
  if (form) {
    form.querySelectorAll("input, select, textarea").forEach(function (el) {
      el.addEventListener("input", function () { markError(el, false); });
      el.addEventListener("change", function () { markError(el, false); });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!validate()) {
        setNote("필수 항목을 확인해 주세요.", "err");
        return;
      }

      // 실제 전송: FormData 구성 (백엔드/폼 서비스 연동 지점)
      var fd = new FormData(form);
      fd.delete("files");
      selectedFiles.forEach(function (item) { fd.append("files[]", item.file, item.file.name); });

      submitBtn.disabled = true;
      submitBtn.textContent = "전송 중...";
      setNote("", "");

      /* --------------------------------------------------------
         ▼▼▼ 백엔드 연동 지점 ▼▼▼
         아래 ENDPOINT를 실제 수신 주소로 교체하세요.
         - 자체 서버(Node/PHP 등) 업로드 엔드포인트, 또는
         - Formspree 등 폼 서비스 URL
         연동 전까지는 데모 모드로 동작합니다.
         -------------------------------------------------------- */
      // 프론트와 백엔드가 같은 서버면 상대 경로(/api/submit)로 충분.
      // 프론트를 별도 호스팅(Netlify 등)하면 index.html에서
      //   window.MOLDLINE_API_BASE = "https://백엔드주소";
      // 를 지정하세요. 비어 있으면 동일 출처로 요청합니다.
      var API_BASE = (window.MOLDLINE_API_BASE || "").replace(/\/+$/, "");
      var ENDPOINT = API_BASE + "/api/submit";

      fetch(ENDPOINT, { method: "POST", body: fd, headers: { Accept: "application/json" } })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok || data.ok === false) {
              throw new Error(data.error || "server");
            }
            return data;
          });
        })
        .then(function (data) {
          submitBtn.disabled = false;
          submitBtn.textContent = "의뢰 보내기";
          var msg = "✓ 의뢰가 접수되었습니다. 영업일 기준 1~2일 내 연락드리겠습니다.";
          if (data && data.submissionId) msg += " (접수번호: " + data.submissionId + ")";
          setNote(msg, "ok");
          form.reset();
          selectedFiles = [];
          renderFiles();
        })
        .catch(function (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = "의뢰 보내기";
          var detail = err && err.message && err.message !== "server" ? " (" + err.message + ")" : "";
          setNote("전송 중 오류가 발생했습니다" + detail + ". 잠시 후 다시 시도하거나 kkangg92@gmail.com로 보내주세요.", "err");
        });
    });
  }
})();
