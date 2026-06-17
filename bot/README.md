# 텔레그램 유지보수 봇

텔레그램으로 자연어 지시를 보내면 **이 PC의 Claude Code(헤드리스)**가 사이트를 수정·커밋하고,
승인 시 `git push` → Render 자동 배포로 이어진다. 두뇌(LLM)는 이 PC에 설치된 Claude Code 구독을
그대로 쓰므로 **별도 Anthropic API 키가 필요 없다.**

```
텔레그램 메시지 → 봇(이 PC) → chat ID 확인 → Claude Code 수정·커밋 → /push 승인 → 배포
```

## 준비 (.env)

기존 알림용 토큰을 그대로 재사용한다.

| 키 | 설명 |
|---|---|
| `TELEGRAM_MAINTAINER_BOT_TOKEN` | **유지보수 전용 봇**(@moldline_bot2) 토큰. 권장 — 알림 봇과 분리. 없으면 아래로 폴백 |
| `TELEGRAM_BOT_TOKEN` | 알림용 봇 토큰. 유지보수 전용 토큰이 없을 때 폴백으로 사용 |
| `TELEGRAM_CHAT_ID` | 명령을 허용할 본인 chat ID (필수, 보안 핵심) |
| `TELEGRAM_MAINTAINER_CHAT_IDS` | (선택) 여러 명 허용 시 쉼표 구분. 없으면 `TELEGRAM_CHAT_ID` 사용 |
| `AUTO_PUSH` | `true`면 커밋 직후 자동 배포. 기본 `false`(텔레그램 `/push` 승인 필요) |
| `BOT_CLAUDE_TIMEOUT_SEC` | Claude 1회 작업 타임아웃(초). 기본 600 |

## 실행

```bash
npm run bot                      # 빠른 실행(포그라운드)

# 항상 켜두기 (권장) — pm2
pm2 start ecosystem.config.js    # server + bot 함께
pm2 logs moldline-bot
pm2 save                         # 부팅 자동 실행 등록(별도 OS 설정 필요)
```

## 사용법

봇과의 대화창에 그냥 한국어로 지시:

- "히어로 부제목을 더 짧게 줄여줘"
- "FAQ에 배송 기간 관련 질문 하나 추가해줘"
- "비용 섹션 버튼 색을 더 진하게"

명령:

| 명령 | 동작 |
|---|---|
| (일반 텍스트) | 지시 반영 → 수정 → 커밋 (푸시는 안 함) |
| `/push` | 마지막 커밋을 배포(푸시) |
| `/reset` | 마지막 커밋 되돌리기 (푸시 전용) |
| `/status` | 브랜치·커밋·미커밋 변경 상태 |
| `/help` | 도움말 |

## 보안

- **허용된 chat ID만** 명령 가능. 그 외에는 무시·거부.
- Claude는 `--dangerously-skip-permissions`로 자동 실행되므로, **반드시 chat ID 화이트리스트를 본인으로 한정**할 것.
- 기본은 `AUTO_PUSH=false` — 사람이 `/push`로 승인해야 실제 배포된다. 잘못된 수정은 `/reset`으로 되돌릴 수 있다.
- 봇은 **수정·커밋만** 하고 push는 하지 않도록 지시받는다(푸시는 봇이 별도 단계에서 처리).
