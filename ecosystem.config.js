/* ============================================================
   PM2 프로세스 설정
   사용법:
     pm2 start ecosystem.config.js
     pm2 logs moldline
     pm2 restart moldline
     pm2 save && pm2 startup   # 부팅 시 자동 실행 등록
   ============================================================ */
module.exports = {
  apps: [
    {
      name: "moldline",
      script: "server.js",
      cwd: __dirname,
      exec_mode: "fork",        // 업로드 폴더 공유·세션 단순화를 위해 단일 프로세스 권장
      instances: 1,
      autorestart: true,
      watch: false,             // 운영에서는 false (코드 변경 시 수동 restart/deploy)
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      },
      // 로그 (pm2 logs 로 확인)
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      merge_logs: true,
      time: true
    },
    {
      // 텔레그램 유지보수 봇 — 항상 켜진 PC에서 실행 (Claude Code 헤드리스로 수정·커밋)
      name: "moldline-bot",
      script: "bot/maintainer.js",
      cwd: __dirname,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      out_file: "./logs/bot-out.log",
      error_file: "./logs/bot-error.log",
      merge_logs: true,
      time: true
    },
    {
      // 텔레그램 브레인스토밍 룸 봇 — 두 페르소나 핑퐁(토론만, 코드는 /apply 승인 시에만)
      // ⚠️ TELEGRAM_BRAINSTORM_BOT_TOKEN(전용 봇) 설정 후 사용. 미설정 시 폴백하나 유지보수 봇과 토큰 충돌 주의.
      name: "moldline-brainstorm",
      script: "bot/brainstorm.js",
      cwd: __dirname,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      out_file: "./logs/brainstorm-out.log",
      error_file: "./logs/brainstorm-error.log",
      merge_logs: true,
      time: true
    }
  ]
};
