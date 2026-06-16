# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

MOLDLINE — 아이디어를 중국 제조 양산 제품으로 연결하는 랜딩 사이트 + 의뢰 접수 백엔드.
프레임워크 없는 바닐라 프론트엔드(HTML/CSS/JS)와 단일 파일 Express 백엔드로 구성된다.

## 명령어

```bash
npm install          # 의존성 설치 (최초 1회)
cp .env.example .env # 설정 파일 생성 (Windows: copy .env.example .env)
npm start            # 서버 실행 → http://localhost:3000, 관리자 /admin
npm run dev          # 코드 변경 시 자동 재시작 (node --watch, Node 18+)
```

- 테스트 스위트·린터·빌드 단계는 없다. `index.html`을 직접 열면 디자인만 확인 가능하나, 폼 제출·관리자·알림은 서버(`npm start`)가 있어야 동작한다.
- `.env` 없이도 서버는 뜨고 폼 제출·파일 저장은 정상 동작한다. SMTP/디스코드 값이 없으면 **알림만** 비활성화된다 (`/api/health`로 활성 상태 확인).

## 아키텍처

### 백엔드 (`server.js` — 단일 파일)
모든 라우트·업로드·알림 로직이 여기 한 곳에 있다.

- **정적 서빙**: `express.static(__dirname)` — 루트의 `index.html`/`admin.html` 등을 그대로 서빙한다. 별도 빌드 산출물 없음.
- **`POST /api/submit`**: 공개 의뢰 접수. `multer.diskStorage`로 파일을 **디스크에 스트리밍 저장**(메모리 미사용). 한 의뢰의 모든 파일은 요청별 폴더 `uploads/<접수번호>/`에 모이고, 메타데이터는 같은 폴더의 `_submission.json`에 기록된다 (알림 실패 시 백업 역할).
- **`/api/admin/*`**: HTTP Basic 인증(`adminAuth`, `crypto.timingSafeEqual`)으로 보호. 접수 목록 조회·파일 다운로드 제공. `ADMIN_PASS` 미설정 시 503 반환.
- **`GET /api/health`**: 메일·디스코드 준비 상태 확인.

### 알림은 접수와 독립적
이메일(`nodemailer`)과 디스코드(웹훅 + `fetch`/`FormData`)는 **서로, 그리고 접수 저장과도 독립적**이다. 일부 또는 전부 실패해도 파일은 이미 저장됐으므로 접수는 성공 처리한다. 새 알림 채널을 추가할 때도 이 "실패해도 접수는 성공" 원칙을 지킬 것.

### 프론트엔드 (`index.html` / `styles.css` / `script.js`)
- `script.js`는 IIFE 한 덩어리. 드래그앤드롭 업로드, 폼 검증, `FormData`로 `/api/submit` 전송을 담당한다.
- 프론트엔드를 별도 호스팅할 경우 `script.js`의 `ENDPOINT` 상수를 전체 URL로 교체해야 한다 (기본값은 상대경로 `/api/submit`).

## 주의할 점 (수정 시 함께 맞춰야 하는 것들)

- **업로드 제한이 3곳에 중복 정의되어 있다.** 변경 시 모두 동기화할 것:
  1. `server.js` 상단 상수 (`MAX_FILES`, `MAX_FILE_SIZE`) + `multer` `limits`
  2. `script.js`의 `MAX_FILES`/`MAX_SIZE` (클라이언트 사전 검증)
  3. nginx `client_max_body_size` (운영, `deploy/nginx.conf`)
- **허용 확장자**는 `server.js`의 `ALLOWED_EXT`(+ multer `fileFilter`)가 기준. 도면 포맷(stp/step/igs 등) 추가 시 여기를 수정한다.
- **첨부 용량 한도**: 개별/누적이 `EMAIL_ATTACH_LIMIT_MB`(기본 20) 또는 `DISCORD_ATTACH_LIMIT_MB`(기본 8, 디스코드 무료 한도)를 넘는 파일은 첨부하지 않고 서버 보관 경로만 안내한다 — 메일/디스코드 용량 초과를 막기 위한 의도된 동작.
- **다국어 파일명**: multer가 받은 `originalname`을 `Buffer.from(name, "latin1").toString("utf8")`로 복원해 한글 등 원본명을 보존한다. 저장 파일명은 `<랜덤hex>__<safeName>` 형식이고, 표시명은 `__` 뒤 부분이다.
- **경로 이탈 방지**: `/api/admin/download`는 id 화이트리스트 정규식 + `path.relative` 검사로 디렉터리 이탈을 차단한다. 다운로드 관련 코드 수정 시 이 가드를 유지할 것.

## 설정 & 배포

- 환경변수는 `.env`(dotenv)로 관리. 전체 키 목록·설명은 `.env.example` 참고 (SMTP_*, MAIL_*, DISCORD_*, ADMIN_*).
- 운영 배포는 pm2(`ecosystem.config.js`, 단일 프로세스 fork 모드 — 업로드 폴더 공유 때문에 클러스터 비권장) + nginx 리버스 프록시 + certbot HTTPS. 상세 절차는 `deploy/DEPLOY.md`.
- `uploads/`, `.env`, `node_modules/`, `logs/`는 git 제외. 업로드 파일은 영속 데이터이므로 배포·정리 시 보존/백업에 유의.
