# Sequential Agent Prompts — AI Agent Arsip & Notulensi PPID

Gunakan prompt ini satu per satu ke AI coding agent (Claude Code, dsb), berurutan. Jangan lompat ke prompt berikutnya sebelum tahap sebelumnya diverifikasi jalan. Lampirkan file **PRD-AI-Agent-Arsip-PPID-revisi.html** dan **TDD-AI-Agent-Arsip-PPID.html** di setiap prompt sebagai referensi (atau tempel isinya jika agent tidak bisa baca file).

---

## Prompt 0 — Scaffolding Project

```
Saya sedang membangun AI agent Telegram untuk kesekretariatan PPID (instansi
pemerintah), menggunakan OpenClaw sebagai gateway, di-deploy ke Render Free
tier. Referensi lengkap ada di PRD dan TDD terlampir.

Tugas kamu sekarang HANYA scaffolding, belum ada logic bisnis:

1. Inisialisasi project Node.js + TypeScript dengan pnpm sesuai struktur folder
   di TDD §1.
2. Install dependencies: openclaw, fluent-ffmpeg, ffmpeg-static, ffprobe-static,
   googleapis (untuk Drive & Sheets), @google/generative-ai (Gemini), groq-sdk,
   zod (validasi env).
3. Buat src/config/env.ts yang memvalidasi semua environment variable di TDD §2
   pakai zod, dan throw error jelas kalau ada yang missing saat startup.
4. Buat .env.example berisi semua key dari TDD §2 (tanpa value asli).
5. Buat render.yaml sesuai TDD §7.
6. Setup tsconfig.json dan package.json scripts (build, start, dev).

Jangan implementasikan tools atau logic bisnis apa pun dulu. Setelah selesai,
tunjukkan struktur folder final dan jelaskan cara saya test env validation-nya
secara lokal.
```

---

## Prompt 1 — Whitelist Middleware & Audit Log

```
Lanjutan dari scaffolding sebelumnya. Sekarang implementasikan:

1. src/middleware/whitelist.ts sesuai TDD §3.1: fungsi isWhitelisted(chatId)
   yang membaca WHITELIST_CHAT_IDS dari env (comma-separated), dan middleware
   yang dipasang di awal setiap message handler OpenClaw. Jika chat_id tidak
   terdaftar, tolak dengan pesan standar dan JANGAN lanjut ke tool manapun.

2. src/services/auditLog.ts sesuai skema TDD §3.2: fungsi logActivity(entry)
   yang menulis satu baris ke Google Sheet (AUDIT_LOG_SHEET_ID) via googleapis,
   dengan kolom: timestamp, chat_id, staff_name, mode, query_or_filename,
   result_document, status.

3. Panggil logActivity di whitelist middleware untuk mencatat status
   "rejected_whitelist" setiap kali ada percobaan akses dari chat_id yang
   tidak terdaftar.

Tulis unit test sederhana untuk isWhitelisted (tidak perlu test auditLog yang
butuh koneksi Google API sungguhan, cukup mock).

Setelah selesai, jelaskan cara saya setup Google Service Account dan share
akses Sheet ke service account tersebut.
```

---

## Prompt 2 — Tool: search_archive & send_document (Mode 1)

```
Lanjutan. Sekarang implementasikan Mode 1 (pencarian arsip) sesuai TDD §4.1
dan §4.2:

1. src/services/driveClient.ts: wrapper googleapis Drive v3, dibatasi ke
   folder DRIVE_ARCHIVE_FOLDER_ID (lihat TDD §3.3 untuk field yang dipakai:
   name, modifiedTime, mimeType, parents).

2. src/tools/searchArchive.ts: tool search_archive sesuai schema JSON di TDD
   §4.1, register ke OpenClaw pakai api.registerTool(). Terjemahkan keywords/
   date_from/date_to/doc_type jadi Drive API query string yang valid.

3. src/tools/sendDocument.ts: tool send_document sesuai TDD §4.2. Logic:
   - Ambil metadata file dari file_id untuk cek ukuran.
   - Jika < MAX_DIRECT_SEND_MB: download ke folder temp, kirim sebagai
     dokumen Telegram, lalu HAPUS file temp (fs.unlinkSync) segera setelah
     terkirim.
   - Jika >= MAX_DIRECT_SEND_MB: kirim link Drive (webViewLink) sebagai teks.
   - Panggil auditLog.logActivity dengan status "success" atau "not_found".

4. src/prompts/intentParsing.ts: system prompt persis seperti di TDD §6.1,
   dipakai saat memanggil Gemini untuk mode ini.

5. Wire semuanya di src/index.ts: voice note masuk → transkripsi Groq (boleh
   pakai groq-sdk langsung, whisper-large-v3-turbo) → teks dikirim ke Gemini
   dengan system prompt intentParsing + tools [search_archive, send_document]
   → Gemini panggil tool sesuai kebutuhan.

Setelah selesai, jelaskan cara saya test alur ini end-to-end dengan bot
Telegram sungguhan (langkah BotFather, dsb), dan skenario apa yang harus saya
coba (query yang ada hasilnya, query yang tidak ada hasilnya, chat_id yang
tidak whitelisted).
```

---

## Prompt 3 — Audio Chunking Module

```
Lanjutan. Sekarang implementasikan src/audio/chunker.ts PERSIS sesuai kode
referensi di TDD §5 (pakai ffmpeg-static + ffprobe-static + fluent-ffmpeg,
mono 16kHz, chunk sekuensial bukan paralel — ini penting karena Render Free
cuma 512MB RAM/0.1 CPU).

Requirement:
1. Fungsi getDurationSeconds(filePath) pakai ffprobe.
2. Fungsi splitIntoChunks(filePath, chunkMinutes, outputDir) yang split
   audio jadi segmen berurutan (bukan Promise.all), return array path chunk.
3. Fungsi shouldChunk(filePath) yang cek ukuran file terhadap
   GROQ_MAX_UPLOAD_MB — return true kalau perlu di-chunk.
4. Fungsi cleanupChunks(chunkPaths) yang hapus semua file chunk temp setelah
   selesai dipakai.

Tulis test dengan file audio sample kecil (boleh generate silent audio pakai
ffmpeg untuk testing, tidak perlu file asli) untuk verifikasi chunking
menghasilkan jumlah segmen yang benar dan durasi masing-masing sesuai.

PENTING: pastikan ffmpeg-static jalan di lingkungan Linux Render (bukan cuma
di macOS/Windows lokal saya) — jelaskan kalau ada perbedaan platform yang
perlu saya perhatikan.
```

---

## Prompt 4 — Tool: transcribe_and_summarize_minutes (Mode 2)

```
Lanjutan, ini bagian paling kompleks. Implementasikan Mode 2 (notulen rapat)
sesuai TDD §4.3, §5, §6.2:

1. src/prompts/minutesSynthesis.ts: system prompt persis seperti TDD §6.2.

2. src/tools/transcribeMinutes.ts, alur:
   a. Terima audio_file_path (file yang sudah diunduh dari upload Telegram).
   b. Cek shouldChunk() dari chunker.ts.
   c. Jika perlu chunk: splitIntoChunks(), lalu transkripsi TIAP CHUNK
      SATU PER SATU (await berurutan, bukan Promise.all) via Groq Whisper,
      gabungkan semua hasil teks jadi satu transkrip utuh.
   d. Jika tidak perlu chunk: transkripsi langsung.
   e. Kirim transkrip lengkap ke Gemini dengan system prompt
      minutesSynthesis, minta output terstruktur (title, agenda_points,
      decisions, action_items) — gunakan structured output/JSON mode Gemini
      supaya hasilnya predictable, bukan free-text yang perlu di-parse manual.
   f. Simpan draf notulen sebagai file (.md cukup untuk MVP) ke
      DRIVE_MINUTES_FOLDER_ID via driveClient.
   g. cleanupChunks() dan hapus audio_file_path asli.
   h. Panggil auditLog.logActivity dengan mode "minutes".
   i. Return sesuai shape response di TDD §4.3.

3. Di src/index.ts: handler untuk upload dokumen audio (bukan voice note) di
   Telegram → langsung balas "File diterima, sedang diproses..." SEBELUM
   mulai transkripsi (supaya tidak keliatan hang) → jalankan proses di atas
   sebagai async job → kirim hasil sebagai pesan terpisah setelah selesai.

4. Setelah dapat hasil dari Gemini, format ulang jadi pesan Telegram yang
   rapi (agenda/keputusan/action item dengan bullet), tutup dengan catatan
   wajib: "Draf ini dihasilkan otomatis dan perlu diverifikasi manual
   sebelum difinalisasi."

Setelah selesai, jelaskan skenario testing yang harus saya coba: file
audio kecil (<25MB, tidak perlu chunk) dan simulasi file besar (>25MB) untuk
memastikan jalur chunking benar-benar terpanggil.
```

---

## Prompt 5 — Integrasi Final & Render Deployment

```
Ini tahap terakhir. Sekarang:

1. Review src/index.ts secara keseluruhan — pastikan urutan middleware benar:
   whitelist check → routing ke Mode 1 (voice note pendek) atau Mode 2
   (upload dokumen audio) → tool calling → audit log di setiap jalur,
   termasuk jalur error.

2. Tambahkan error handling global: kalau Groq/Gemini/Drive API gagal
   (timeout, rate limit, dsb), bot harus membalas pesan error yang jelas ke
   staf (bukan silent fail), dan tetap tercatat di audit log dengan status
   "error".

3. Tambahkan health check endpoint sederhana (GET /health) yang dipakai
   untuk keep-alive ping (lihat PRD §4 soal spin-down Render Free) —
   endpoint ini HARUS ringan, tidak memicu proses berat apa pun.

4. Cek ulang: apakah semua file temp (audio asli, chunk, hasil download
   dokumen) benar-benar dihapus di semua jalur, termasuk jalur error
   (pakai try/finally, bukan cuma di happy path)?

5. Siapkan checklist deployment ke Render: urutan setup env var di dashboard,
   cara menghubungkan repo GitHub, cara setup Telegram webhook/polling mode
   yang sesuai untuk Render Free (spin-down mempengaruhi pilihan ini —
   jelaskan mana yang lebih cocok, webhook atau long-polling, untuk
   environment yang bisa sleep).

Setelah selesai, buatkan saya README.md ringkas berisi: cara install lokal,
cara testing, dan checklist sebelum deploy pertama kali ke Render.
```

---

## Catatan Pemakaian

- Tiap prompt diasumsikan dikerjakan dalam sesi/percakapan yang sama dengan
  konteks project yang sudah ada (AI coding agent bisa lihat kode dari
  prompt sebelumnya).
- Kalau AI coding agent menyimpang dari skema di TDD (misal ganti struktur
  data tool), minta dia jelaskan alasannya dulu sebelum lanjut — supaya PRD
  dan TDD tetap jadi sumber kebenaran yang konsisten dengan kode.
- Setelah Prompt 5 selesai dan sudah dites lokal, baru lakukan deployment
  sungguhan ke Render dan uji end-to-end dengan bot Telegram nyata sebelum
  diserahkan ke staf PPID.
