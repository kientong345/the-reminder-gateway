# The Reminder — Gateway

Stateless Cloudflare Worker đóng vai trò proxy, đồng bộ lịch trình từ **Google Calendar**, tóm tắt nội dung bằng **Cloudflare Workers AI** (`@cf/meta/llama-3.1-8b-instruct`), tổng hợp giọng nói tiếng Việt (`audio/mpeg`) và lưu đệm tại **Cloudflare Edge Cache** (`caches.default`) cho thiết bị **ESP32 Deep Sleep**.

---

## Kiến trúc & Cấu trúc thư mục

```text
gateway/
├── src/
│   ├── index.ts             # HTTP Router (/health, /oauth/*, /poll, /audio)
│   ├── oauth.ts             # Google OAuth2 Authorization Code & Refresh Token flow
│   ├── schedule_provider.ts # Google Calendar API client (fields mask + ETag/304 cache)
│   ├── llm_provider.ts      # Cloudflare Workers AI tóm tắt câu nhắc tiếng Việt
│   ├── tts_provider.ts      # Google Translate TTS tổng hợp MP3
│   ├── cache_provider.ts    # Cloudflare Cache API wrapper (caches.default)
│   ├── utils.ts             # FNV-1a version hash, compact schedule, dynamic poll interval
│   └── types.ts             # TypeScript interfaces
├── .github/workflows/
│   └── ci-cd.yml            # GitHub Actions: Typecheck & Wrangler Deploy
├── wrangler.jsonc           # Cấu hình Cloudflare Worker
└── .env.example             # Mẫu biến môi trường local
```

---

## HTTP Endpoints

Mọi endpoint dành cho thiết bị (`/poll`, `/audio`) yêu cầu xác thực qua header `Authorization: Bearer <DEVICE_AUTH_TOKEN>` hoặc query param `?token=<DEVICE_AUTH_TOKEN>`.

| Method | Endpoint | Mô tả |
| :--- | :--- | :--- |
| `GET` | `/health` | Kiểm tra trạng thái hoạt động của Worker (`{"status":"healthy"}`). |
| `GET` | `/oauth/login` | Chuyển hướng sang trang cấp quyền Google OAuth2 (`calendar.readonly`, `offline`). |
| `GET` | `/oauth/callback` | Đổi `code` lấy `access_token` và `refresh_token`. |
| `GET` | `/poll?version=<hash>` | Kiểm tra thay đổi lịch trong ngày. Trả về `changed`, `version` (FNV-1a 8-hex), `server_time`, `poll_after_sec`, `current_idx`, và mảng `events` (`remind_ts`, `start_ts`). |
| `GET` | `/audio?target=today\|next&version=<hash>&idx=<n>` | Trả về luồng nhị phân `audio/mpeg` (MP3) đã được cache theo `version` tại Edge PoP, kèm header `X-Version` và `X-Speech-Text`. |

---

## Cài đặt & Chạy Local

### 1. Cài đặt dependencies
```bash
npm install
```

### 2. Cấu hình biến môi trường (`.env`)
Tạo file `.env` từ `.env.example`:
```bash
cp .env.example .env
```
Điền các thông số vào `.env`:
```env
DEVICE_AUTH_TOKEN="your-secret-edge-token"
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
GOOGLE_REFRESH_TOKEN="your-google-refresh-token"
```

### 3. Chạy môi trường dev
```bash
npm run dev
```
*(Mặc định lắng nghe tại `http://localhost:8787`)*.

### 4. Lấy `GOOGLE_REFRESH_TOKEN` lần đầu
1. Trong Google Cloud Console (**APIs & Services → Credentials**), thêm `http://localhost:8787/oauth/callback` (hoặc `<WORKER_DOMAIN>/oauth/callback`) vào **Authorized redirect URIs**.
2. Mở trình duyệt truy cập `http://localhost:8787/oauth/login` và cấp quyền tài khoản Google.
3. Copy giá trị `refresh_token` trả về tại `/oauth/callback` và lưu vào `GOOGLE_REFRESH_TOKEN`.

---

## Triển khai (Deployment)

### 1. Nạp Secrets lên Cloudflare Worker
Đẩy toàn bộ biến từ file `.env` lên Cloudflare:
```bash
npx wrangler secret bulk .env
```

### 2. Deploy thủ công từ máy local
```bash
npm run deploy
```

### 3. Tự động Deploy qua GitHub Actions
File `.github/workflows/ci-cd.yml` tự động chạy `tsc --noEmit` và `wrangler deploy` khi push vào nhánh `main`. Cần cấu hình 2 Repository Secrets trên GitHub:
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` *(tạo từ template **Edit Cloudflare Workers**)*

> **Lưu ý về Edge Cache (`caches.default`):** Để `caches.default` hoạt động trên môi trường production, Worker cần được gắn với một **Custom Domain** (ví dụ `https://the-reminder-gateway.kientd.shop`) thay vì chỉ dùng subdomain `*.workers.dev`.
