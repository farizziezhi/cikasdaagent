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
