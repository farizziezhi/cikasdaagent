import { z } from "zod";

/**
 * Zod schema untuk validasi semua environment variable yang dibutuhkan.
 * Throw error dengan pesan jelas kalau ada yang missing saat startup.
 *
 * Ref: TDD §2 - Environment Variables
 */
const envSchema = z.object({
  // === Required secrets ===
  TELEGRAM_BOT_TOKEN: z
    .string()
    .min(1, "TELEGRAM_BOT_TOKEN wajib diisi (token dari BotFather)"),

  GEMINI_API_KEY: z
    .string()
    .min(1, "GEMINI_API_KEY wajib diisi (API key Google AI Studio)"),

  GROQ_API_KEY: z
    .string()
    .min(1, "GROQ_API_KEY wajib diisi (API key Groq Console)"),

  GOOGLE_SERVICE_ACCOUNT_JSON: z
    .string()
    .min(1, "GOOGLE_SERVICE_ACCOUNT_JSON wajib diisi (base64-encoded service account credential)"),

  // === Google Drive / Sheets IDs ===
  DRIVE_ARCHIVE_FOLDER_ID: z
    .string()
    .min(1, "DRIVE_ARCHIVE_FOLDER_ID wajib diisi (ID folder arsip DIP di Google Drive)"),

  DRIVE_MINUTES_FOLDER_ID: z
    .string()
    .min(1, "DRIVE_MINUTES_FOLDER_ID wajib diisi (ID folder tujuan simpan draf notulen)"),

  DRIVE_WATCH_FOLDER_ID: z
    .string()
    .default("")
    .describe("ID folder Google Drive masuk yang dipantau otomatis oleh DriveWatcher (opsional)"),

  PPID_DRIVE_FOLDER_ID: z
    .string()
    .default("")
    .describe("ID folder Google Drive khusus arsip jawaban PPID (opsional, fallback ke DRIVE_ARCHIVE_FOLDER_ID)"),

  PPID_DRIVE_CLIENT_ID: z
    .string()
    .default("")
    .describe("OAuth2 Client ID akun Google Drive PPID-Digital (opsional, Cara B)"),

  PPID_DRIVE_CLIENT_SECRET: z
    .string()
    .default("")
    .describe("OAuth2 Client Secret akun Google Drive PPID-Digital (opsional, Cara B)"),

  PPID_DRIVE_REFRESH_TOKEN: z
    .string()
    .default("")
    .describe("OAuth2 Refresh Token akun Google Drive PPID-Digital (opsional, Cara B)"),

  AUDIT_LOG_SHEET_ID: z
    .string()
    .min(1, "AUDIT_LOG_SHEET_ID wajib diisi (ID Google Sheet untuk audit log)"),

  // === Registrasi User ===
  REGISTRATION_CODE: z
    .string()
    .min(1, "REGISTRATION_CODE wajib diisi (kode rahasia untuk registrasi pegawai baru)"),

  // === Whitelist (legacy, opsional — digunakan sebagai admin list) ===
  WHITELIST_CHAT_IDS: z
    .string()
    .default("")
    .describe("Daftar chat_id admin, dipisah koma. Opsional."),

  // === Optional with defaults ===
  MAX_DIRECT_SEND_MB: z.coerce
    .number()
    .positive()
    .default(50)
    .describe("Ambang ukuran file kirim langsung vs link (MB)"),

  GROQ_MAX_UPLOAD_MB: z.coerce
    .number()
    .positive()
    .default(25)
    .describe("Ambang ukuran audio sebelum chunking (MB)"),

  CHUNK_DURATION_MINUTES: z.coerce
    .number()
    .positive()
    .default(20)
    .describe("Durasi tiap segmen chunking audio (menit)"),

  // === 9Router Gateway ===
  ROUTER_API_KEY: z
    .string()
    .default("")
    .describe("API Key untuk 9Router lokal di VPS"),

  ROUTER_BASE_URL: z
    .string()
    .default("http://127.0.0.1:20128/v1")
    .describe("Base URL 9Router"),

  // === Integrasi PPID-Digital (Supabase) ===
  PPID_SUPABASE_URL: z
    .string()
    .default("")
    .describe("URL Supabase project PPID-Digital"),

  PPID_SUPABASE_SERVICE_KEY: z
    .string()
    .default("")
    .describe("Anon/Service Role key Supabase PPID-Digital"),

  // === Integrasi SIVERA (Neon/Supabase PostgreSQL + Realtime) ===
  SIVERA_DATABASE_URL: z
    .string()
    .default("")
    .describe("Database connection string PostgreSQL SIVERA"),

  SIVERA_SUPABASE_URL: z
    .string()
    .default("")
    .describe("URL Supabase project SIVERA (opsional, untuk Realtime surat & disposisi)"),

  SIVERA_SUPABASE_SERVICE_KEY: z
    .string()
    .default("")
    .describe("Service Role / Anon key Supabase SIVERA (opsional, untuk Realtime)"),

  // === Integrasi APEL-IN (Neon PostgreSQL) ===
  APELIN_DATABASE_URL: z
    .string()
    .default("")
    .describe("Database connection string Neon PostgreSQL APEL-IN"),

  // === Broadcast Proaktif (Scheduler CIKASDA) ===
  BROADCAST_CHAT_IDS: z
    .string()
    .default("")
    .describe("Daftar chat_id penerima broadcast proaktif, dipisah koma (contoh: grup pimpinan)"),

  BROADCAST_TO_REGISTERED: z
    .string()
    .default("true")
    .describe("Kirim broadcast ke seluruh pengguna terdaftar di Sheet ('true' atau 'false')"),

  // === Integrasi WordPress CIKASDA NEWS (opsional, DRAFT-only) ===
  WP_BASE_URL: z
    .string()
    .default("https://cikasda.sultengprov.go.id")
    .describe("Base URL WordPress, tanpa trailing slash"),

  WP_USER: z
    .string()
    .default("")
    .describe("Username WordPress khusus bot (mis. ppid-bot)"),

  WP_APP_PASSWORD: z
    .string()
    .default("")
    .describe("Application Password user bot (bukan password login WP)"),

  WP_CATEGORY_ID: z
    .string()
    .default("3,7")
    .describe("Daftar ID kategori WordPress dipisah koma (default: '3,7' untuk FAKTUAL + PPID CIKASDA)"),
});




export type Env = z.infer<typeof envSchema>;

/**
 * Parse dan validasi process.env.
 * Dipanggil saat startup — jika ada env var missing/invalid, langsung throw
 * dengan pesan error yang jelas supaya developer tahu apa yang perlu diperbaiki.
 */
function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ✗ ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    console.error("\n╔══════════════════════════════════════════════════╗");
    console.error("║  ❌  ENVIRONMENT VARIABLE VALIDATION FAILED      ║");
    console.error("╚══════════════════════════════════════════════════╝\n");
    console.error(formatted);
    console.error("\nPastikan semua env var sudah diisi. Lihat .env.example untuk referensi.\n");

    throw new Error(`Missing/invalid environment variables:\n${formatted}`);
  }

  return result.data;
}

/** Singleton env config — import ini dari mana saja */
export const env = loadEnv();
