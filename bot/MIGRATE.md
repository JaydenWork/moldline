# 유지보수 봇 — 다른 PC로 옮기기 (Migration)

유지보수 봇(`@moldnine2_bot`)은 **항상 켜진 PC 한 대**에서 돌아간다. 그 PC를 바꾸려면
아래 순서를 새 PC에서 한 번 따라 하면 된다. **봇 토큰·명령 대화·chat ID는 그대로**고,
바뀌는 건 "봇을 실행하는 PC"뿐이다.

## ⚠️ 가장 중요한 규칙

봇은 **동시에 한 대에서만** 돌려야 한다. 텔레그램 롱폴링은 두 곳에서 동시에 받으면
`409 Conflict`가 나서 둘 다 오작동한다.

> **새 PC에서 켜기 전에, 반드시 옛 PC의 봇을 먼저 끈다.** (맨 아래 "옛 PC 정리" 참고)

## 깃에 들어있지 않아 직접 옮겨야 하는 것

`git clone`만으로는 안 되고, 아래 3가지는 **수동으로** 새 PC에 마련해야 한다.

1. **`.env`** — 봇 토큰·chat ID 등 비밀값 (`.gitignore`로 제외됨)
2. **Claude Code 로그인** — 봇의 LLM 두뇌. 새 PC에서 `claude` 실행 후 구독 로그인
3. **GitHub push 인증** — 새 PC에서 `git push`가 되도록 (`/push` 배포에 필요)

---

## 새 PC 설치 순서

### 1) 사전 준비물 (한 번)

- Git, Node.js 18+ 설치
- Claude Code 설치 및 로그인:

```bash
npm i -g @anthropic-ai/claude-code
claude          # 실행 후 구독 로그인 (봇 두뇌)
```

### 2) 레포 가져오기

```bash
git clone https://github.com/JaydenWork/moldline.git
cd moldline
npm install
```

### 3) `.env` 옮기기 (필수)

옛 PC의 `<repo>/.env` 파일을 **새 PC의 같은 위치(`moldline/.env`)로 복사**한다.
USB·보안 메신저 등으로 직접 이동(채팅에 평문으로 붙여넣지 말 것).

봇이 쓰는 핵심 키:

| 키 | 설명 |
|---|---|
| `TELEGRAM_MAINTAINER_BOT_TOKEN` | 유지보수 봇(`@moldnine2_bot`) 토큰 |
| `TELEGRAM_MAINTAINER_CHAT_IDS` | 명령 허용 chat ID (본인 개인 ID) |
| `AUTO_PUSH` | 보통 미설정/`false` — `/push` 승인 후 배포 |

> `.env`를 분실했다면: `@BotFather`에서 토큰을 다시 확인하고, chat ID는
> 봇에 메시지를 한 번 보낸 뒤 `https://api.telegram.org/bot<TOKEN>/getUpdates`로 알아낼 수 있다.

### 4) GitHub push 인증

새 PC에서 `git push origin main`이 동작하도록 인증을 잡는다.

```bash
gh auth login          # GitHub CLI 사용 시
# 또는 PAT(개인 액세스 토큰) / SSH 키 설정
```

확인:

```bash
git push origin main   # (변경 없으면 "Everything up-to-date" 가 떠야 정상)
```

### 5) 봇 켜기 + 상시 구동

```bash
npm i -g pm2
pm2 start ecosystem.config.js   # server + bot 함께
pm2 save
pm2 startup                     # 안내되는 명령 한 줄 더 실행 → 부팅 자동 시작
pm2 logs moldline-bot           # 기동 로그 확인
```

정상 기동 로그 예:

```
✅ 봇 시작: @moldnine2_bot
   허용 chat ID: 7616972930
   자동 푸시: OFF (승인 필요)
   Claude: .../@anthropic-ai/claude-code/bin/claude(.exe)
```

### 6) 왕복 테스트

`@moldnine2_bot` 1:1 대화에서 `/status` 를 보낸다. 브랜치·커밋 상태가 돌아오면 성공.

---

## 옛 PC 정리 (새 PC 가동 확인 후)

옛 PC에서 봇을 완전히 끈다(동시 폴링 방지).

```bash
# pm2로 돌리던 경우
pm2 delete moldline-bot && pm2 save

# node로 직접 띄웠던 경우 (Windows PowerShell)
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'maintainer' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

---

## 빠른 체크리스트

- [ ] 옛 PC 봇 OFF (또는 새 PC 가동 직후 끌 준비)
- [ ] 새 PC: Node 18+, Git, Claude Code 설치 + `claude` 로그인
- [ ] `git clone` + `npm install`
- [ ] `.env` 복사 (토큰·chat ID)
- [ ] `git push` 인증 확인
- [ ] `pm2 start` + `pm2 save` + `pm2 startup`
- [ ] `/status` 왕복 테스트 OK
- [ ] 옛 PC 봇 완전 종료
