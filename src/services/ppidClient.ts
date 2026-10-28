import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import {
  calculateBusinessDaysRemaining,
  addBusinessDays,
  type BusinessDaysResult,
} from "./businessDays.js";

export interface ProfileSnippet {
  nama: string;
  nik?: string | null;
  telepon?: string | null;
}

export interface PermohonanRow {
  id: number;
  user_id: string;
  jenis_informasi: string;
  deskripsi: string;
  status: "diajukan" | "diproses" | "dijawab" | "ditolak";
  deadline_awal: string | null;
  diperpanjang: boolean;
  alasan_perpanjangan: string | null;
  deadline_akhir: string | null;
  created_at: string;
  profiles?: ProfileSnippet | null;
}

export interface DigestItem {
  id: number;
  jenisInformasi: string;
  pemohonNama: string;
  pemohonNikMasked: string;
  status: string;
  diperpanjang: boolean;
  targetDeadline: string;
  sla: {
    status: "NORMAL" | "WARNING" | "CRITICAL" | "OVERDUE";
    daysRemaining: number;
  };
}

export interface ActivePermohonanItem extends DigestItem {
  deskripsi: string;
  status: "diajukan" | "diproses";
  pemohonTeleponMasked: string;
  alasanPerpanjangan: string | null;
  sla: BusinessDaysResult;
  createdAt: string;
}


export interface ExtendSlaResult {
  id: number;
  diperpanjang: boolean;
  deadlineSebelumnya: string;
  deadlineBaru: string;
  alasan: string;
}

export interface PpidClientOptions {
  supabaseUrl?: string;
  supabaseKey?: string;
  customFetchActive?: () => Promise<PermohonanRow[]>;
  customGetById?: (id: number) => Promise<PermohonanRow | null>;
  customUpdateExtend?: (id: number, deadlineBaru: string, alasan: string) => Promise<void>;
}

export function maskNik(nik?: string | null): string {
  if (!nik || typeof nik !== "string") return "-";
  const trimmed = nik.trim();
  if (trimmed.length < 8) return trimmed || "-";
  if (trimmed.length === 16) {
    return `${trimmed.slice(0, 6)}******${trimmed.slice(12)}`;
  }
  return `${trimmed.slice(0, 4)}******`;
}

export function maskPhone(phone?: string | null): string {
  if (!phone || typeof phone !== "string") return "-";
  const trimmed = phone.trim();
  if (trimmed.length < 8) return trimmed || "-";
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`;
}

export class PpidClient {
  private supabase: SupabaseClient | null = null;
  private customFetchActive?: () => Promise<PermohonanRow[]>;
  private customGetById?: (id: number) => Promise<PermohonanRow | null>;
  private customUpdateExtend?: (id: number, deadlineBaru: string, alasan: string) => Promise<void>;

  constructor(options: PpidClientOptions = {}) {
    this.customFetchActive = options.customFetchActive;
    this.customGetById = options.customGetById;
    this.customUpdateExtend = options.customUpdateExtend;

    const url = options.supabaseUrl ?? env.PPID_SUPABASE_URL;
    const key = options.supabaseKey ?? env.PPID_SUPABASE_SERVICE_KEY;

    if (url && key) {
      this.supabase = createClient(url, key, {
        auth: { persistSession: false },
      });
    }
  }

  public isConnected(): boolean {
    return Boolean(this.supabase || this.customFetchActive);
  }

  public async getActivePermohonan(referenceDate: Date = new Date()): Promise<ActivePermohonanItem[]> {
    let rows: PermohonanRow[] = [];

    if (this.customFetchActive) {
      rows = await this.customFetchActive();
    } else if (this.supabase) {
      const { data, error } = await this.supabase
        .from("permohonan")
        .select(`
          id,
          user_id,
          jenis_informasi,
          deskripsi,
          status,
          deadline_awal,
          diperpanjang,
          alasan_perpanjangan,
          deadline_akhir,
          created_at,
          profiles (
            nama,
            nik,
            telepon
          )
        `)
        .in("status", ["diajukan", "diproses"])
        .order("created_at", { ascending: true });

      if (error) {
        throw new Error(`Gagal mengambil data permohonan PPID: ${error.message}`);
      }

      rows = (data as unknown as PermohonanRow[]) ?? [];
    } else {
      return [];
    }

    const items: ActivePermohonanItem[] = rows.map((row) => {
      // Prioritaskan deadline_akhir jika status permohonan sudah diperpanjang (+7 hari)
      const targetDeadlineStr = (row.diperpanjang && row.deadline_akhir)
        ? row.deadline_akhir
        : (row.deadline_awal ?? new Date(row.created_at).toISOString().split("T")[0]);

      const targetDeadlineDate = new Date(`${targetDeadlineStr}T23:59:59+08:00`);
      const sla = calculateBusinessDaysRemaining(referenceDate, targetDeadlineDate);

      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;

      return {
        id: row.id,
        jenisInformasi: row.jenis_informasi,
        deskripsi: row.deskripsi,
        status: row.status as "diajukan" | "diproses",
        pemohonNama: profile?.nama ?? "Pemohon Umum",
        pemohonNikMasked: maskNik(profile?.nik),
        pemohonTeleponMasked: maskPhone(profile?.telepon),
        diperpanjang: row.diperpanjang,
        alasanPerpanjangan: row.alasan_perpanjangan,
        targetDeadline: targetDeadlineStr,
        sla,
        createdAt: row.created_at,
      };
    });

    const severityOrder: Record<"OVERDUE" | "CRITICAL" | "WARNING" | "NORMAL", number> = {
      OVERDUE: 0,
      CRITICAL: 1,
      WARNING: 2,
      NORMAL: 3,
    };
    items.sort((a, b) => {
      const diff = severityOrder[a.sla.status] - severityOrder[b.sla.status];
      if (diff !== 0) return diff;
      return a.sla.daysRemaining - b.sla.daysRemaining;
    });

    return items;
  }

  public async getPermohonanById(id: number): Promise<PermohonanRow | null> {
    if (this.customGetById) {
      return this.customGetById(id);
    }

    if (!this.supabase) return null;

    const { data, error } = await this.supabase
      .from("permohonan")
      .select(`
        id,
        user_id,
        jenis_informasi,
        deskripsi,
        status,
        deadline_awal,
        diperpanjang,
        alasan_perpanjangan,
        deadline_akhir,
        created_at,
        profiles (
          nama,
          nik,
          telepon
        )
      `)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error(`Gagal mengambil detail tiket #${id}: ${error.message}`);
    }

    return (data as unknown as PermohonanRow) ?? null;
  }

  // UU KIP No 14/2008 Pasal 22 ayat (7): perpanjangan waktu layanan hanya 1 kali maksimal 7 hari kerja
  public async extendSla(id: number, alasan: string): Promise<ExtendSlaResult> {
    const existing = await this.getPermohonanById(id);
    if (!existing) {
      throw new Error(`Tiket permohonan #${id} tidak ditemukan.`);
    }

    if (existing.diperpanjang) {
      throw new Error(
        `Tiket #${id} sudah pernah diperpanjang sebelumnya (${existing.deadline_akhir}). Berdasarkan UU KIP No. 14/2008, perpanjangan waktu hanya dapat dilakukan satu kali.`
      );
    }

    const baseDeadlineStr = existing.deadline_awal ?? new Date().toISOString().split("T")[0];
    const baseDate = new Date(`${baseDeadlineStr}T00:00:00+08:00`);
    const newDeadlineDate = addBusinessDays(baseDate, 7);
    const deadlineBaru = newDeadlineDate.toISOString().split("T")[0];

    if (this.customUpdateExtend) {
      await this.customUpdateExtend(id, deadlineBaru, alasan);
    } else if (this.supabase) {
      const { error } = await this.supabase
        .from("permohonan")
        .update({
          diperpanjang: true,
          alasan_perpanjangan: alasan,
          deadline_akhir: deadlineBaru,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) {
        throw new Error(`Gagal memperbarui perpanjangan tiket #${id}: ${error.message}`);
      }
    }

    return {
      id,
      diperpanjang: true,
      deadlineSebelumnya: baseDeadlineStr,
      deadlineBaru,
      alasan,
    };
  }
}

export function formatPermohonanDigest(items: DigestItem[]): string {

  if (items.length === 0) {
    return "✅ <b>PPID Digital</b>: Tidak ada tiket permohonan informasi publik yang sedang aktif saat ini. Semua layanan tuntas!";
  }

  const lines: string[] = [
    "📋 <b>DAFTAR TIKET PERMOHONAN INFORMASI (PPID CIKASDA)</b>",
    `<i>Dipantau per ${new Date().toLocaleDateString("id-ID", { dateStyle: "full" })}</i>`,
    "",
  ];

  for (const item of items) {
    const icon =
      item.sla.status === "OVERDUE"
        ? "🛑 OVERDUE"
        : item.sla.status === "CRITICAL"
        ? "🚨 CRITICAL"
        : item.sla.status === "WARNING"
        ? "⚠️ WARNING"
        : "🟢 NORMAL";

    lines.push(`<b>[#${item.id}] ${item.jenisInformasi}</b>`);
    lines.push(`• Pemohon : ${item.pemohonNama} (NIK: ${item.pemohonNikMasked})`);
    lines.push(`• Status  : <code>${item.status}</code> ${item.diperpanjang ? "(+7 Hari Diperpanjang)" : ""}`);
    lines.push(`• Deadline: ${item.targetDeadline}`);
    lines.push(`• SLA     : <b>${icon}</b> (${item.sla.daysRemaining} hari kerja tersisa)`);
    lines.push("");
  }

  lines.push("💡 <i>Ketik 'perpanjang permohonan [ID] [alasan]' untuk menambah +7 hari kerja sesuai UU KIP No 14/2008.</i>");

  return lines.join("\n");
}

export const ppidClient = new PpidClient();
