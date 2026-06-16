/* ============================================================
   MOLDLINE — 인터랙션 & 폼 처리
   ============================================================ */
(function () {
  "use strict";

  /* ---- 연도 ---- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

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

  /* ---- 스크롤 등장 애니메이션 ---- */
  var revealTargets = [];
  document.querySelectorAll(".card, .step, .cert, .qc__step, .price-card, .faq__item, .trust__text, .trust__panel")
    .forEach(function (el) { el.setAttribute("data-reveal", ""); revealTargets.push(el); });

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    revealTargets.forEach(function (el) { io.observe(el); });
  } else {
    revealTargets.forEach(function (el) { el.classList.add("is-in"); });
  }

  /* ============================================================
     파일 업로드 (드래그앤드롭 + 미리보기 목록)
     ============================================================ */
  var MAX_FILES = 10;
  var MAX_SIZE = 50 * 1024 * 1024; // 50MB
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
      // Node 백엔드(server.js)와 같은 서버에서 서빙되므로 상대 경로 사용.
      // 프론트엔드를 별도 호스팅한다면 전체 URL로 교체하세요. (예: "https://api.moldline.kr/api/submit")
      var ENDPOINT = "/api/submit";

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
          setNote("전송 중 오류가 발생했습니다" + detail + ". 잠시 후 다시 시도하거나 contact@moldline.kr로 보내주세요.", "err");
        });
    });
  }
})();
