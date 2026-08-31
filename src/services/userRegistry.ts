import { env } from "../config/env.js";
import { ensureTabExists, appendRow, findRows } from "./sheetsClient.js";

const TAB_NAME = "RegisteredUsers";
const HEADERS = ["chat_id", "nama", "registered_at", "status"];

// Cache in-memory agar tidak query Sheet setiap pesan masuk
let registeredCache: Set<string> = new Set();
let cacheLoaded = false;

/**
 * Muat cache dari Google Sheet (dipanggil sekali saat pertama kali dibutuhkan)
 */
async function loadCache(): Promise<void> {
  if (cacheLoaded) return;
  
  try {
    await ensureTabExists(TAB_NAME, HEADERS);
    
    // Ambil semua baris, filter yang statusnya "active"
    const rows = await findRows(TAB_NAME, 3, "active"); // kolom 3 = status
    
    // Karena findRows filter by value, kita juga perlu ambil semua rows
    // dan filter yang active
    // Sebenarnya findRows sudah filter, jadi kita tinggal ambil chat_id-nya
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
 */
export async function isRegistered(chatId: string): Promise<boolean> {
  await loadCache();
  return registeredCache.has(chatId.toString());
}

/**
 * Daftarkan user baru. Verifikasi kode akses terlebih dahulu.
 * @returns Object { success, message }
 */
export async function registerUser(
  chatId: string,
  nama: string,
  registrationCode: string
): Promise<{ success: boolean; message: string }> {
  // 1. Verifikasi kode akses
  if (registrationCode !== env.REGISTRATION_CODE) {
    return {
      success: false,
      message: "Kode akses salah. Silakan hubungi admin untuk mendapatkan kode yang benar.",
    };
  }

  // 2. Cek apakah sudah terdaftar
  await loadCache();
  if (registeredCache.has(chatId.toString())) {
    return {
      success: false,
      message: "Anda sudah terdaftar sebelumnya.",
    };
  }

  // 3. Pastikan tab ada
  await ensureTabExists(TAB_NAME, HEADERS);

  // 4. Tulis ke Google Sheet
  const now = new Date().toISOString();
  await appendRow(TAB_NAME, [chatId.toString(), nama, now, "active"]);

  // 5. Update cache
  registeredCache.add(chatId.toString());

  console.log(`[UserRegistry] User ${nama} (${chatId}) berhasil didaftarkan.`);

  return {
    success: true,
    message: `Selamat datang, ${nama}! Anda berhasil terdaftar sebagai pengguna AI Agent PPID. Silakan gunakan bot ini untuk mencari arsip, membuat notulen, dan lainnya.`,
  };
}

/**
 * Reset cache (dipanggil jika admin mengubah Sheet secara manual)
 */
export function resetCache(): void {
  registeredCache.clear();
  cacheLoaded = false;
}
