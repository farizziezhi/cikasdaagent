import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import { ppidClient as defaultPpidClient, PpidClient, maskNik } from "./ppidClient.js";
import { searchFiles } from "./driveClient.js";
import type { SendBroadcastOptions, TelegramInlineKeyboardMarkup } from "./broadcast.js";

export interface ArchiveMatchSnippet {
  file_id: string;
  name: string;
}

export interface RealtimeWatcherCallbacks {
  sendBroadcast: (message: string, options?: SendBroadcastOptions) => Promise<void>;
}

export interface RealtimeWatcherDeps {
  ppidClient?: PpidClient;
  searchArchiveFn?: (keywords: string) => Promise<ArchiveMatchSnippet[]>;
  ppidSupabaseUrl?: string;
  ppidSupabaseKey?: string;
  siveraSupabaseUrl?: string;
  siveraSupabaseKey?: string;
}

export interface NewPermohonanPayload {
  id: number;
  jenis_informasi?: string;
  deskripsi?: string;
  status?: string;
  deadline_awal?: string | null;
  created_at?: string;
  pemohonNama?: string;
  pemohonNikMasked?: string;
}

export interface NewSiveraSuratPayload {
  id: string;
  nomorSurat?: string;
  nomorAgenda?: string | null;
  pengirim?: string;
  perihal?: string;
  statusSaatIni?: string;
}

export interface NewSiveraDisposisiPayload {
  id: string;
  suratId?: string;
  catatan?: string | null;
  keBidangId?: string;
  bidangTujuanNama?: string;
}

export function formatNewPermohonanAlert(
  item: NewPermohonanPayload,
  archiveMatches: ArchiveMatchSnippet[] = [],
): string {
  const jenis = item.jenis_informasi || "Permohonan Informasi Publik";
  const pemohon = item.pemohonNama || "Pemohon Umum";
  const nikMasked = item.pemohonNikMasked || "-";
  const deadline = item.deadline_awal || "10 hari kerja sejak diterima";

  const lines = [
    `🔔 <b>PERMOHONAN INFORMASI BARU [#${item.id}]</b>`,
    `• <b>Informasi Diminta:</b> ${jenis}`,
    `• <b>Pemohon:</b> ${pemohon} (NIK: ${nikMasked})`,
    `• <b>Tenggat Awal SLA:</b> ${deadline}`,
  ];

  if (archiveMatches.length > 0) {
    lines.push("");
    lines.push(`📁 <b>Arsip Drive Terkait (${archiveMatches.length} ditemukan):</b>`);
    for (const m of archiveMatches.slice(0, 3)) {
      lines.push(`• ${m.name}`);
    }
  } else {
    lines.push(`• <b>Arsip Drive:</b> Belum ditemukan berkas otomatis — perlu koordinasi dengan bidang terkait.`);
  }

  lines.push("");
  lines.push(`💡 <i>Gunakan tombol di bawah atau balas 'cek tiket #${item.id}' untuk menindaklanjuti.</i>`);

  return lines.join("\n");
}

export function buildNewPermohonanButtons(
  ticketId: number,
  archiveMatches: ArchiveMatchSnippet[] = [],
): TelegramInlineKeyboardMarkup {
  const rows: TelegramInlineKeyboardMarkup["inline_keyboard"] = [
    [
      { text: "📄 Detail Tiket", callback_data: `cek tiket #${ticketId}` },
      { text: "⏱️ Perpanjang +7 Hari", callback_data: `perpanjang permohonan ${ticketId}` },
    ],
  ];

  for (const m of archiveMatches.slice(0, 2)) {
    const shortName = m.name.length > 28 ? `${m.name.slice(0, 25)}...` : m.name;
    rows.push([
      {
        text: `📁 ${shortName}`,
        url: `https://drive.google.com/file/d/${m.file_id}/view`,
      },
    ]);
  }

  return { inline_keyboard: rows };
}

export function buildNewSiveraSuratButtons(nomorSurat?: string): TelegramInlineKeyboardMarkup | undefined {
  const clean = (nomorSurat || "").trim();
  if (!clean) return undefined;
  return {
    inline_keyboard: [
      [{ text: "📍 Lacak Posisi Surat", callback_data: `lacak surat ${clean.slice(0, 48)}` }],
    ],
  };
}

export function formatNewSiveraSuratAlert(item: NewSiveraSuratPayload): string {
  return [
    `📬 <b>SURAT MASUK BARU (SIVERA)</b>`,
    `• <b>No. Surat:</b> <code>${item.nomorSurat || "-"}</code>`,
    `• <b>Pengirim :</b> ${item.pengirim || "-"}`,
    `• <b>Perihal  :</b> ${item.perihal || "-"}`,
    `• <b>Status   :</b> <code>${item.statusSaatIni || "DIDAFTARKAN_PPID"}</code>`,
    "",
    `💡 <i>Ketik 'lacak surat ${item.nomorSurat || item.pengirim || ""}' untuk melihat alur checkpoint.</i>`,
  ].join("\n");
}

export function formatNewSiveraDisposisiAlert(item: NewSiveraDisposisiPayload): string {
  const tujuan = item.bidangTujuanNama || item.keBidangId || "Bidang Terkait";
  return [
    `📝 <b>DISPOSISI BARU TURUN (SIVERA)</b>`,
    `• <b>ID Surat :</b> <code>${item.suratId || "-"}</code>`,
    `• <b>Tujuan   :</b> ${tujuan}`,
    item.catatan ? `• <b>Catatan  :</b> <i>"${item.catatan}"</i>` : `• <b>Catatan  :</b> <i>(Tanpa catatan tambahan)</i>`,
    "",
    `💡 <i>Silakan tindak lanjuti sesuai arahan disposisi pimpinan.</i>`,
  ].join("\n");
}

/**
 * Layanan True Realtime berbasis Supabase Realtime (WebSocket postgres_changes).
 * Memantau tabel `permohonan` (PPID-Digital) serta `Surat` & `Disposisi` (SIVERA)
 * dan langsung mengirim notifikasi proaktif ke Telegram dalam hitungan detik.
 */
export class RealtimeWatcher {
  private callbacks: RealtimeWatcherCallbacks;
  private ppidClient: PpidClient;
  private searchArchiveFn: (keywords: string) => Promise<ArchiveMatchSnippet[]>;
  private ppidSupabaseUrl: string;
  private ppidSupabaseKey: string;
  private siveraSupabaseUrl: string;
  private siveraSupabaseKey: string;

  private ppidSupabase: SupabaseClient | null = null;
  private siveraSupabase: SupabaseClient | null = null;
  private channels: RealtimeChannel[] = [];
  private seenKeys: Set<string> = new Set();
  private started = false;

  constructor(callbacks: RealtimeWatcherCallbacks, deps: RealtimeWatcherDeps = {}) {
    this.callbacks = callbacks;
    this.ppidClient = deps.ppidClient ?? defaultPpidClient;
    this.searchArchiveFn =
      deps.searchArchiveFn ??
      (async (keywords: string) => {
        const rows = await searchFiles({ keywords });
        return rows.map((r) => ({ file_id: r.file_id, name: r.name }));
      });
    this.ppidSupabaseUrl = (deps.ppidSupabaseUrl ?? env.PPID_SUPABASE_URL ?? "").trim();
    this.ppidSupabaseKey = (deps.ppidSupabaseKey ?? env.PPID_SUPABASE_SERVICE_KEY ?? "").trim();
    this.siveraSupabaseUrl = (deps.siveraSupabaseUrl ?? env.SIVERA_SUPABASE_URL ?? "").trim();
    this.siveraSupabaseKey = (deps.siveraSupabaseKey ?? env.SIVERA_SUPABASE_SERVICE_KEY ?? "").trim();
  }

  private markSeen(key: string): boolean {
    if (this.seenKeys.has(key)) return false;
    this.seenKeys.add(key);
    // Jaga ukuran cache memori tetap ramping
    if (this.seenKeys.size > 500) {
      const oldest = this.seenKeys.values().next().value;
      if (oldest) this.seenKeys.delete(oldest);
    }
    return true;
  }

  public async handlePermohonanInsert(rawRow: Record<string, any>): Promise<string | null> {
    const id = Number(rawRow?.id);
    if (!Number.isFinite(id) || id <= 0) return null;
    if (!this.markSeen(`ppid-permohonan-${id}`)) return null;

    let payload: NewPermohonanPayload = {
      id,
      jenis_informasi: rawRow.jenis_informasi,
      deskripsi: rawRow.deskripsi,
      status: rawRow.status,
      deadline_awal: rawRow.deadline_awal,
      created_at: rawRow.created_at,
    };

    try {
      const detail = await this.ppidClient.getPermohonanById(id);
      if (detail) {
        const profile = Array.isArray(detail.profiles) ? detail.profiles[0] : detail.profiles;
        payload = {
          id: detail.id,
          jenis_informasi: detail.jenis_informasi,
          deskripsi: detail.deskripsi,
          status: detail.status,
          deadline_awal: detail.deadline_awal,
          created_at: detail.created_at,
          pemohonNama: profile?.nama ?? "Pemohon Umum",
          pemohonNikMasked: maskNik(profile?.nik),
        };
      }
    } catch (err) {
      console.warn("[RealtimeWatcher] Gagal mengambil detail profil permohonan, pakai data event:", err);
    }

    // Auto-cari arsip Google Drive terkait topik permohonan (aman jika kosong/offline)
    let archiveMatches: ArchiveMatchSnippet[] = [];
    const searchTopic = (payload.jenis_informasi || "").trim();
    if (searchTopic.length >= 3) {
      try {
        archiveMatches = await this.searchArchiveFn(searchTopic);
      } catch (err) {
        console.warn("[RealtimeWatcher] Auto-cari arsip Drive gagal, lanjut tanpa lampiran:", err);
      }
    }

    const message = formatNewPermohonanAlert(payload, archiveMatches);
    const replyMarkup = buildNewPermohonanButtons(id, archiveMatches);
    await this.callbacks.sendBroadcast(message, { replyMarkup });
    return message;
  }

  public async handleSuratInsert(rawRow: Record<string, any>): Promise<string | null> {
    const id = String(rawRow?.id || "").trim();
    if (!id) return null;
    if (!this.markSeen(`sivera-surat-${id}`)) return null;

    const message = formatNewSiveraSuratAlert({
      id,
      nomorSurat: rawRow.nomorSurat,
      nomorAgenda: rawRow.nomorAgenda,
      pengirim: rawRow.pengirim,
      perihal: rawRow.perihal,
      statusSaatIni: rawRow.statusSaatIni,
    });
    const replyMarkup = buildNewSiveraSuratButtons(rawRow.nomorSurat);
    await this.callbacks.sendBroadcast(message, replyMarkup ? { replyMarkup } : undefined);
    return message;
  }

  public async handleDisposisiInsert(rawRow: Record<string, any>): Promise<string | null> {
    const id = String(rawRow?.id || "").trim();
    if (!id) return null;
    if (!this.markSeen(`sivera-disposisi-${id}`)) return null;

    const message = formatNewSiveraDisposisiAlert({
      id,
      suratId: rawRow.suratId,
      catatan: rawRow.catatan,
      keBidangId: rawRow.keBidangId,
      bidangTujuanNama: rawRow.bidangTujuanNama,
    });
    await this.callbacks.sendBroadcast(message);
    return message;
  }

  public start(): void {
    if (this.started) return;
    this.started = true;

    if (this.ppidSupabaseUrl && this.ppidSupabaseKey) {
      this.ppidSupabase = createClient(this.ppidSupabaseUrl, this.ppidSupabaseKey, {
        auth: { persistSession: false },
      });

      const ppidChannel = this.ppidSupabase
        .channel("ppid-permohonan-realtime")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "permohonan" },
          (payload) => {
            this.handlePermohonanInsert(payload.new).catch((err) => {
              console.error("[RealtimeWatcher] Error proses INSERT permohonan:", err);
            });
          },
        )
        .subscribe((status) => {
          console.log(`[RealtimeWatcher] PPID permohonan channel status: ${status}`);
        });

      this.channels.push(ppidChannel);
    } else {
      console.log("[RealtimeWatcher] PPID_SUPABASE_URL/KEY belum diisi — realtime permohonan dilewati.");
    }

    if (this.siveraSupabaseUrl && this.siveraSupabaseKey) {
      this.siveraSupabase = createClient(this.siveraSupabaseUrl, this.siveraSupabaseKey, {
        auth: { persistSession: false },
      });

      const siveraChannel = this.siveraSupabase
        .channel("sivera-surat-disposisi-realtime")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "Surat" },
          (payload) => {
            this.handleSuratInsert(payload.new).catch((err) => {
              console.error("[RealtimeWatcher] Error proses INSERT Surat:", err);
            });
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "Disposisi" },
          (payload) => {
            this.handleDisposisiInsert(payload.new).catch((err) => {
              console.error("[RealtimeWatcher] Error proses INSERT Disposisi:", err);
            });
          },
        )
        .subscribe((status) => {
          console.log(`[RealtimeWatcher] SIVERA Surat/Disposisi channel status: ${status}`);
        });

      this.channels.push(siveraChannel);
    } else {
      console.log("[RealtimeWatcher] SIVERA_SUPABASE_URL/KEY belum diisi — realtime SIVERA dilewati.");
    }
  }

  public async stop(): Promise<void> {
    this.started = false;
    for (const ch of this.channels) {
      try {
        await ch.unsubscribe();
      } catch {
        // abaikan error saat shutdown
      }
    }
    this.channels = [];
  }
}
