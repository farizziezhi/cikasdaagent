// broadcast.ts — BARU (v2 gabungan). Kirim pesan ke Telegram langsung
// via Bot API, supaya bot bisa MULAI chat sendiri (proaktif), bukan cuma
// membalas pesan masuk.
//
// Daftar penerima = gabungan, tanpa duplikat, urutan ini:
//   1. BROADCAST_CHAT_IDS (env, eksplisit — mis. grup pimpinan)
//   2. WHITELIST_CHAT_IDS (env, admin — sudah ada di repo)
//   3. Pengguna terdaftar di Google Sheet tab RegisteredUsers
//      (kolom status = "active"), SELAMA BROADCAST_TO_REGISTERED
//      bukan "false". Daftar ini diambil lewat getRegisteredChatIds()
//      di userRegistry.ts, yang memakai cache + findRows(tab, 3, "active").
//      Kalau Sheet offline / gagal, broadcast tetap jalan ke daftar 1+2.
//
// Env yang dipakai (tambahkan ke .env, lihat dot-env-example-addition.txt):
//   TELEGRAM_BOT_TOKEN       (sudah ada)
//   BROADCAST_CHAT_IDS       (baru, contoh: 123456789,-1001234567890)
//   WHITELIST_CHAT_IDS       (sudah ada)
//   BROADCAST_TO_REGISTERED  (baru, "true"/"false", default "true")
//
// Catatan keamanan: daftar penerima proaktif HARUS eksplisit seperti di
// atas. Jangan kirim broadcast ke sembarang chat_id yang pernah chat.

const TELEGRAM_API = "https://api.telegram.org";

function splitIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);
}

export async function getBroadcastChatIds(): Promise<string[]> {
  const explicit = splitIds(process.env.BROADCAST_CHAT_IDS);
  const whitelist = splitIds(process.env.WHITELIST_CHAT_IDS);

  let registered: string[] = [];
  if (process.env.BROADCAST_TO_REGISTERED !== "false") {
    try {
      // Dynamic import supaya broadcast.ts tetap bisa diuji tanpa
      // Google Sheets, dan supaya gagal Sheet tidak mematikan bot.
      // userRegistry mengimpor env + sheetsClient; di runtime bot
      // env sudah tervalidasi saat startup.
      const { getRegisteredChatIds } = await import("./userRegistry.js");
      registered = await getRegisteredChatIds();
    } catch (err) {
      console.warn(
        "[broadcast] gagal membaca pengguna terdaftar, lanjut dengan daftar env saja:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Dedup, pertahankan urutan pertama muncul.
  return [...new Set([...explicit, ...whitelist, ...registered])];
}

function splitForTelegram(text: string, limit = 4000): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut <= 0) cut = limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) parts.push(rest);
  return parts;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN belum di-set di .env");

  for (const part of splitForTelegram(text)) {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: part,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Telegram sendMessage ke ${chatId} gagal (${res.status}): ${body.slice(0, 200)}`,
      );
    }
  }
}

/** Kirim satu pesan ke semua chat penerima. Gagal di satu chat tidak
 *  menggagalkan chat lain; error dicatat ke console. */
export async function sendBroadcast(message: string): Promise<void> {
  const chatIds = await getBroadcastChatIds();
  if (chatIds.length === 0) {
    console.warn(
      "[broadcast] tidak ada penerima (BROADCAST_CHAT_IDS / WHITELIST_CHAT_IDS / pengguna terdaftar kosong) — pesan tidak dikirim.",
    );
    return;
  }
  for (const chatId of chatIds) {
    try {
      await sendTelegramMessage(chatId, message);
      console.log(`[broadcast] terkirim ke ${chatId}`);
    } catch (err) {
      console.error(`[broadcast] gagal ke ${chatId}:`, err);
    }
  }
}
