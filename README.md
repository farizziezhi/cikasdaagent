# PPID AI Agent

PPID AI Agent adalah bot Telegram cerdas untuk Kesekretariatan PPID yang dibangun dengan framework **OpenClaw**. 
Bot ini menggunakan model generatif **Gemini 1.5 Flash** untuk memproses *natural language* dan **Groq Whisper** untuk transkripsi audio super cepat.

## Fitur Utama
1. **Mode 1: Asisten Pencarian Arsip**
   - Staf dapat mengirimkan *Voice Note* (Pesan Suara) atau Teks.
   - Bot mencari dokumen di dalam Google Drive (berdasarkan kata kunci, rentang waktu, atau jenis dokumen).
   - Bot akan mengirim dokumen secara langsung (jika `<25MB`) atau memberikan link Google Drive.
2. **Mode 2: Pembuat Notulen Rapat Otomatis**
   - Staf dapat mengunggah file Audio (sebagai *Document/Audio* di Telegram).
   - Bot melakukan *chunking* otomatis untuk file berukuran besar.
   - Hasil rapat dirangkum menggunakan format *Structured JSON* yang diubah menjadi dokumen Markdown (`.md`) dan langsung diunggah ke Google Drive.
3. **Audit Logging & Whitelist**
   - Hanya pengguna dengan Telegram ID yang terdaftar (`WHITELIST_CHAT_IDS`) yang dapat memakai bot ini.
   - Setiap interaksi (sukses maupun error) otomatis dicatat ke Google Sheets.

---

## 💻 Instalasi Lokal (Local Development)

### 1. Persyaratan Sistem
- **Node.js** v20+ 
- **pnpm** package manager
- Akun Telegram (untuk mendapatkan Bot Token via BotFather)
- Akun Google Cloud (untuk Service Account JSON)
- Akun Groq & Gemini (untuk API Key)

### 2. Setup
1. *Clone repository* ini.
2. Instal dependensi:
   ```bash
   pnpm install
   ```
3. Buat file `.env` di *root directory* dan isi berdasarkan template di `.env.example`.
4. Letakkan file kredensial Google Service Account Anda di folder `/config` dengan nama `google-service-account.json`.

### 3. Menjalankan Bot
Jalankan perintah berikut untuk menyalakan mode *development*:
```bash
pnpm run dev
```

### 4. Testing
Untuk mencoba *unit testing* (menggunakan *native test runner* Node.js):
```bash
pnpm test
```

---

## 🚀 Deployment Checklist (Render Free Tier)

Agar bot dapat berjalan 24/7 secara gratis di [Render](https://render.com/), pastikan Anda mengikuti langkah-langkah berikut:

### 1. Setup GitHub Repo
- *Push* kode sumber Anda ke repository GitHub.
- Pastikan folder `node_modules` dan file `google-service-account.json` (ataupun `.env`) masuk ke dalam `.gitignore`! Jangan pernah mem-*push* *secret key* ke repository publik/pribadi.

### 2. Buat Web Service di Render
- Login ke Render dashboard, klik **New** -> **Web Service**.
- Hubungkan dengan repository GitHub Anda.
- Konfigurasi dasar:
  - **Environment**: Node
  - **Build Command**: `pnpm install && pnpm run build`
  - **Start Command**: `pnpm start`

### 3. Setup Environment Variables (Dashboard)
Di tab *Environment* milik Web Service tersebut, masukkan seluruh variabel dari `.env` Anda secara manual:
- `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `GROQ_API_KEY`
- `WHITELIST_CHAT_IDS`, `AUDIT_LOG_SHEET_ID`
- `DRIVE_ARCHIVE_FOLDER_ID`, `DRIVE_MINUTES_FOLDER_ID`
- `GROQ_MAX_UPLOAD_MB` (isi dengan `25`)
- **Penting: `GOOGLE_SERVICE_ACCOUNT_JSON`**
  - Karena kita tidak mengunggah file `google-service-account.json`, buka file JSON tersebut di laptop Anda, *copy* HANYA HANYA **ISI KESELURUHAN TEKSNYA** (pastikan satu baris panjang atau salinan utuh tanpa karakter rusak).
  - *Paste* di Render dashboard sebagai *Environment Variable* dengan *key* `GOOGLE_SERVICE_ACCOUNT_JSON`.
  - Di dalam kode (sudah diimplementasi), sistem akan membaca JSON ini dari *environment*, bukan dari file lokal.

### 4. Pemilihan Mode Telegram: Long Polling vs Webhooks
- **Default sistem ini menggunakan Long Polling**. 
- **Tantangan Render Free**: Aplikasi gratis Render akan "tertidur" (*spin down*) setelah 15 menit tidak menerima *request* masuk. Jika aplikasi tertidur, **Long Polling akan mati dan bot Anda tidak merespons!**
- **Solusinya (Wajib)**: Kita sudah menyediakan sebuah endpoint `/health` (berjalan di `process.env.PORT`). 
  1. Daftar ke [cron-job.org](https://cron-job.org) atau UptimeRobot.
  2. Buat *cron job* untuk melakukan PING (`GET`) ke URL aplikasi Render Anda (contoh: `https://ppid-agent.onrender.com/health`) setiap **14 Menit**.
  3. Dengan *Keep-Alive* ping ini, Render server Anda tidak akan tertidur, dan metode Long Polling akan tetap aman 24/7.
  
> *(Opsional: Jika menggunakan webhook, Telegram otomatis 'membangunkan' Render saat ada chat baru. Namun Render memerlukan waktu ~1-2 menit untuk 'bangun' (cold start). Ini membuat pengguna bot merasa bot-nya lambat membalas pesan pertama mereka. Oleh karena itu, Keep-Alive dengan Long Polling merupakan solusi paling nyaman untuk pengguna.)*
