# 운영 배포 가이드 (Ubuntu + nginx + HTTPS + pm2)

Ubuntu 22.04/24.04 서버 기준. 도메인은 `moldline.kr` 예시 — 실제 도메인으로 바꿔 진행하세요.

---

## 0. 사전 준비

- 도메인 DNS의 A 레코드를 서버 공인 IP로 연결 (`moldline.kr`, `www.moldline.kr`)
- 방화벽에서 80/443 포트 개방
  ```bash
  sudo ufw allow OpenSSH
  sudo ufw allow 'Nginx Full'
  sudo ufw enable
  ```

## 1. Node.js 설치 (LTS)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # v20.x 확인
```

## 2. 코드 배포 & 의존성

```bash
sudo mkdir -p /var/www/moldline
sudo chown $USER:$USER /var/www/moldline
# 코드 업로드 (git clone 또는 scp/rsync)
cd /var/www/moldline

npm ci --omit=dev      # package-lock 기반 설치 (lock 없으면 npm install)
cp .env.example .env
nano .env              # SMTP_*, MAIL_TO, ADMIN_PASS 등 입력
mkdir -p logs uploads
```

> `.env`의 `ADMIN_PASS`는 반드시 강력한 값으로. `PORT`는 3000 유지(아래 nginx가 이 포트로 프록시).

## 3. pm2로 상시 실행

```bash
sudo npm install -g pm2

pm2 start ecosystem.config.js
pm2 logs moldline          # 로그 확인
pm2 save                   # 현재 프로세스 목록 저장
pm2 startup                # 출력되는 명령을 복사해 실행 → 부팅 시 자동 실행
```

확인:
```bash
curl http://127.0.0.1:3000/api/health   # {"ok":true,...}
```

## 4. nginx 설치 & 설정

```bash
sudo apt-get install -y nginx

# 저장소의 예시 설정 복사 (server_name을 실제 도메인으로 수정)
sudo cp deploy/nginx.conf /etc/nginx/sites-available/moldline
sudo ln -s /etc/nginx/sites-available/moldline /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # 기본 페이지 제거(선택)
```

> ⚠️ TLS 인증서를 아직 발급하지 않았다면, nginx.conf의 443 블록(ssl_certificate 라인)이
> 없는 파일이 없어서 `nginx -t`가 실패합니다. 5번에서 certbot이 인증서와 443 설정을
> 자동으로 채워주는 방식을 쓰거나, 우선 80 블록만 남기고 테스트하세요.

## 5. HTTPS (Let's Encrypt / certbot)

가장 간단한 방법 — certbot이 nginx 설정까지 자동 수정:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d moldline.kr -d www.moldline.kr
# 이메일 입력, 약관 동의, 'HTTP→HTTPS 리다이렉트' 선택
```

발급 후 적용:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

자동 갱신은 certbot이 systemd 타이머로 등록합니다. 테스트:
```bash
sudo certbot renew --dry-run
```

## 6. 동작 확인

- `https://moldline.kr` → 사이트 표시
- `https://moldline.kr/admin` → 관리자 로그인 (ADMIN_USER/ADMIN_PASS)
- 폼에서 STP 첨부 제출 → 메일 수신 + `/var/www/moldline/uploads/<접수번호>/` 저장

---

## 업데이트 배포

```bash
cd /var/www/moldline
git pull                      # 또는 새 파일 업로드
npm ci --omit=dev             # 의존성 변경 시
pm2 restart moldline
```

## 운영 팁

| 항목 | 권장 |
|------|------|
| 업로드 백업 | `uploads/`를 정기 백업하거나 S3/오브젝트 스토리지 연동 |
| 업로드 한도 | nginx `client_max_body_size`(60m)와 server.js의 50MB를 함께 조정 |
| 관리자 보호 | Basic 인증 + (선택) nginx IP 화이트리스트 (nginx.conf 주석 참고) |
| 로그 | `pm2 logs moldline`, nginx는 `/var/log/nginx/` |
| 모니터링 | `pm2 monit`, 필요 시 `pm2-logrotate` 설치 |
| 디스크 | 업로드 누적 대비 디스크 사용량 주기 점검 |

## 자주 막히는 부분

- **413 Request Entity Too Large** → nginx `client_max_body_size`가 너무 작음. 60m로.
- **502 Bad Gateway** → Node 미실행. `pm2 status` / `pm2 logs`로 확인.
- **관리자 503 응답** → `.env`에 `ADMIN_PASS` 미설정.
- **메일 안 감** → `.env`의 SMTP 정보 확인, `pm2 logs`에서 "SMTP 준비 완료" 여부 확인.
