# 텔레그램 브레인스토밍 룸 봇

한 채팅방에서 **💡 아이디어봇 ↔ 🛠️ PM봇** 두 페르소나가 핑퐁하며 사업·사이트 개선
아이디어를 주고받는다. 봇끼리는 **토론만** 하고, 코드는 사장님이 `/apply` 로 **승인할 때만**
기존 유지보수 흐름(Claude Code 수정·커밋)으로 넘어간다. 실제 배포는 여전히 `/push`.

```
/go → 💡 아이디어봇 제안 → 🛠️ PM봇 평가/구체화 → 📌 실행 제안
        ↑ 사장님이 한 줄로 방향 개입 가능 (자유 텍스트)
      마음에 들면 /apply → 수정·커밋 → /push → Render 배포
```

## ⚠️ 왜 "봇 2개"가 아니라 페르소나 2개인가

텔레그램 봇은 **다른 봇이 보낸 메시지를 받을 수 없다**(privacy mode를 꺼도 `getUpdates`에
안 들어옴 — 플랫폼 하드 제약). 그래서 진짜 봇 2개를 한 방에 넣어 서로 읽게 하는 건 불가능하다.
대신 이 프로세스 1개가 두 페르소나를 번갈아 호출해 대화를 그룹에 중계한다. 결과는 동일하다.

## 준비 (.env)

| 키 | 설명 |
|---|---|
| `TELEGRAM_BRAINSTORM_BOT_TOKEN` | **전용 봇** 토큰. @BotFather 로 새 봇을 하나 더 만들 것. (필수 권장) |
| `TELEGRAM_BRAINSTORM_CHAT_IDS` | 이 봇을 쓸 chat ID(쉼표 구분). 그룹이면 그룹 ID(보통 `-100…`). 미지정 시 유지보수/알림 chat ID로 폴백 |
| `BOT_CLAUDE_TIMEOUT_SEC` | Claude 1회 호출 타임아웃(초). 기본 600 (유지보수 봇과 공통) |

> ⚠️ **토큰을 유지보수 봇과 공유하지 말 것.** 같은 토큰으로 `npm run bot` 과 `npm run brainstorm` 을
> 동시에 켜면 두 프로세스가 같은 `getUpdates` 큐를 두고 다퉈 메시지가 서로 사라진다. 반드시 전용 봇.

### 그룹에서 쓰려면
1. @BotFather → `/newbot` 으로 새 봇 생성 → 토큰을 `TELEGRAM_BRAINSTORM_BOT_TOKEN` 에.
2. 텔레그램 그룹을 만들고 그 봇을 멤버로 초대. (봇이 일반 메시지를 받으려면 BotFather에서
   `/setprivacy` → **Disable** 권장)
3. 그룹에서 아무 메시지나 보낸 뒤 `https://api.telegram.org/bot<토큰>/getUpdates` 를 열어
   `chat.id`(음수)를 확인 → `TELEGRAM_BRAINSTORM_CHAT_IDS` 에 넣는다.

## 실행

```bash
npm run brainstorm                 # 포그라운드

# 항상 켜두기 — pm2 (server + 유지보수 봇 + 브레인스토밍 봇 함께)
pm2 start ecosystem.config.js
pm2 logs moldline-brainstorm
pm2 save
```

## 명령

| 명령 | 동작 |
|---|---|
| `/go [주제]` | 한 라운드 진행. 주제를 적으면 그 방향, 없으면 임팩트 큰 것부터 |
| `/more` | 직전 흐름을 이어 한 라운드 더 |
| (자유 텍스트) | 방향을 끼워넣고 한 라운드 (예: "전환율 위주로", "검품 리포트 강조") |
| `/apply` | 합의된 **실행 제안**을 실제 수정·커밋 (배포는 안 함) |
| `/push` | 마지막 커밋 배포(푸시) |
| `/reset` | 마지막 커밋 되돌리기 (푸시 전) |
| `/status` | 브랜치·커밋·대기 중 제안·대화 누적 상태 |
| `/clear` | 대화 흐름·대기 제안 초기화 |
| `/help` | 도움말 |

## 안전장치

- **허용된 chat ID만** 사용 가능. 그 외엔 거부.
- 봇끼리의 핑퐁은 **토론·제안까지만** — 절대 코드를 자동 수정하지 않는다.
- 코드 변경은 사장님이 `/apply` 로 승인할 때만. 그래도 **`git push` 는 하지 않으며** 배포는 `/push` 로 한 번 더 승인.
- 잘못된 구현은 `/reset` 으로 되돌린다(푸시 전).
- LLM 두뇌는 이 PC의 Claude Code 구독을 그대로 사용 — 별도 API 키 불필요.

## 관련 문서

- 명령형 유지보수 봇: [README.md](./README.md)
- 다른 PC로 이전: [MIGRATE.md](./MIGRATE.md)
