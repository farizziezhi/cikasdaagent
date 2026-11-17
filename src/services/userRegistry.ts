import { env } from "../config/env.js";
import { ensureTabExists, appendRow, findRows } from "./sheetsClient.js";

const TAB_NAME = "RegisteredUsers";
const HEADERS = ["chat_id", "nama", "registered_at", "status"];

// Cache in-memory agar tidak query Sheet setiap pesan masuk
const registeredCache: Set<string> = new Set();
let cacheLoaded = false;

/**
 * Muat cache dari Google Sheet (hanya membaca data tanpa overhead pembuatan tab)
 */
async function loadCache(): Promise<void> {
  if (cacheLoaded) return;

  try {
    const rows = await findRows(TAB_NAME, 3, "active");
    for (const row of rows) {
      if (row[0]) {
        registeredCache.add(row[0].toString());
      }
    }

    cacheLoaded = true;
    console.log(`[UserRegistry] Cache loaded: ${registeredCache.size} registered users.`);
  } catch (error) {
    console.error("[UserRegistry] Error loading cache:", error);
  }
}

/**
 * Cek apakah user dengan chat_id tertentu sudah terdaftar.
 * Instan (0 ms) jika user ada di WHITELIST_CHAT_IDS atau sudah ada di cache memori.
 */
export async function isRegistered(chatId: string): Promise<boolean> {
  const strId = chatId.toString().trim();

  // 1. Cek daftar admin / whitelist env (Instan 0 ms)
  if (env.WHITELIST_CHAT_IDS) {
    const whitelist = env.WHITELIST_CHAT_IDS.split(",").map((s) => s.trim());
    if (whitelist.includes(strId)) {
      return true;
    }
  }

  // 2. Cek in-memory cache (Instan 0 ms)
  if (registeredCache.has(strId)) {
    return true;
  }

  // 3. Jika belum di cache, muat dari Google Sheets
  await loadCache();
  return registeredCache.has(strId);
}

/**
 * Daftarkan user baru. Verifikasi kode akses terlebih dahulu.
 */
export async function registerUser(
  chatId: string,
  nama: string,
  registrationCode: string
): Promise<{ success: boolean; message: string }> {
  const strId = chatId.toString().trim();

  // 1. Verifikasi kode akses
  if (registrationCode !== env.REGISTRATION_CODE) {
    return {
      success: false,
      message: "Kode akses salah. Silakan hubungi admin untuk mendapatkan kode yang benar.",
    };
  }

  // 2. Cek apakah sudah terdaftar
  if (await isRegistered(strId)) {
    return {
      success: false,
      message: "Anda sudah terdaftar sebelumnya.",
    };
  }

  // 3. Pastikan tab ada di Google Sheets
  await ensureTabExists(TAB_NAME, HEADERS);

  // 4. Tulis ke Google Sheet
  const now = new Date().toISOString();
  await appendRow(TAB_NAME, [strId, nama, now, "active"]);

  // 5. Update cache memori
  registeredCache.add(strId);

  console.log(`[UserRegistry] User ${nama} (${strId}) berhasil didaftarkan.`);

  return {
    success: true,
    message: `Selamat datang, ${nama}! Anda berhasil terdaftar sebagai pengguna AI Agent PPID. Silakan gunakan bot ini untuk mencari arsip, membuat notulen, dan lainnya.`,
  };
}

/**
 * Ambil semua chat_id pengguna terdaftar yang berstatus aktif.
 * Digunakan oleh broadcast.ts untuk pengiriman proaktif.
 */
export async function getRegisteredChatIds(): Promise<string[]> {
  await loadCache();
  return Array.from(registeredCache);
}

/**
 * Reset cache
 */
export function resetCache(): void {
  registeredCache.clear();
  cacheLoaded = false;
}
