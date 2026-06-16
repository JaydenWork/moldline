# CLAUDE.md

Claude Code 가이드. MOLDLINE — 아이디어를 중국 양산 제품으로 연결하는 랜딩 사이트 + 의뢰 접수 백엔드. 바닐라 프론트(HTML/CSS/JS) + 단일 파일 Express.

## 명령어

```bash
npm install   # 의존성 (최초 1회)
npm start     # 서버 → http://localhost:3000, 관리자 /admin
npm run dev   # 자동 재시작 (Node 18+)
```

테스트·린터·빌드 없음. `.env` 없어도 접수·저장은 동작하고 알림만 비활성화(`/api/health`로 확인).

## 아키텍처

- **`server.js`(단일 파일)**: 모든 라우트·업로드·알림. `express.static(__dirname)`로 정적 서빙.
- **`POST /api/submit`**: 공개 접수. multer로 파일을 `uploads/<접수번호>/`에 디스크 스트리밍 저장, 메타는 `_submission.json`.
- **`/api/admin/*`**: HTTP Basic 인증(`crypto.timingSafeEqual`). `ADMIN_PASS` 미설정 시 503.
- **알림은 접수와 독립**: 메일(nodemailer)·디스코드(웹훅)는 서로/접수와 독립. 실패해도 접수는 성공 처리 — 새 채널 추가 시도 이 원칙 유지.
- **프론트**: `script.js`(IIFE)가 드래그앤드롭·검증·`FormData` 전송. 별도 호스팅 시 `ENDPOINT` 상수를 전체 URL로 교체.

## 수정 시 함께 맞출 것

- **업로드 제한 4곳 동기화**: `server.js`(개당 `MAX_FILE_SIZE`+multer, 총합 `MAX_TOTAL_SIZE`/env `MAX_TOTAL_SIZE_MB`), `script.js`(클라 검증, 개당+총합 둘 다), nginx `client_max_body_size`(`deploy/nginx.conf`, 총합보다 약간 여유있게), `.env.example`.
- **허용 확장자**: `server.js`의 `ALLOWED_EXT`(+multer `fileFilter`)가 기준.
- **첨부 한도**: `EMAIL_ATTACH_LIMIT_MB`(20)/`DISCORD_ATTACH_LIMIT_MB`(8) 초과 파일은 첨부 대신 서버 경로만 안내(의도된 동작).
- **파일명**: `originalname`을 `Buffer.from(name,"latin1").toString("utf8")`로 복원. 저장명 `<hex>__<safeName>`, 표시명은 `__` 뒤.
- **경로 이탈 방지**: `/api/admin/download`의 id 화이트리스트 + `path.relative` 가드 유지.

## 자산

- `assets/img/`: 사진은 전부 Unsplash 무료 라이선스 스톡 이미지(실제 협력사/자사 사진 아님 — 캡션에 "예시 이미지" 명시). 실제 공장·제작사례 사진이 확보되면 같은 파일명으로 교체하면 됨.
- `assets/img/favicon.svg`: 임시 SVG 파비콘(로고 마크 기반). 정식 브랜드 자산 생기면 교체.

## 설정 & 배포

- 환경변수는 `.env`(키 목록은 `.env.example`).
- 운영: pm2(fork 모드, 업로드 폴더 공유로 클러스터 비권장) + nginx + certbot. 절차는 `deploy/DEPLOY.md`.
- git 제외: `uploads/`, `.env`, `node_modules/`, `logs/`. 업로드는 영속 데이터 — 보존/백업 유의.
