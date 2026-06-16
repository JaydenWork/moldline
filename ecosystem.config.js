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
    }
  ]
};
