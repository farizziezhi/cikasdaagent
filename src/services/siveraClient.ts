import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

export type SiveraStatusSurat =
  | "DIDAFTARKAN_PPID"
  | "DITERIMA_KEARSIPAN"
  | "TERDISPOSISI"
  | "DITERIMA_BIDANG"
  | "DIPROSES"
  | "ARSIP";

export interface SuratRow {
  id: string;
  nomorSurat: string;
  nomorAgenda: string | null;
  pengirim: string;
  perihal: string;
  tanggalSurat: Date | null;
  tanggalDiterima: Date;
  statusSaatIni: SiveraStatusSurat;
  fileUrl: string;
}

export interface DisposisiRow {
  id: string;
  catatan: string | null;
  createdAt: Date;
  bidangTujuanNama: string;
}

export interface AuditLogRow {
  id: string;
  checkpoint: string;
  aktorNip: string;
  timestamp: Date;
}

export interface SuratTrackDetail {
  id: string;
  nomorSurat: string;
  nomorAgenda: string | null;
  pengirim: string;
  perihal: string;
  tanggalSurat: string;
  tanggalDiterima: string;
  statusSaatIni: SiveraStatusSurat;
  checkpointIndex: number;
  checkpointLabel: string;
  fileUrl: string;
  disposisi: Array<{
    id: string;
    catatan: string | null;
    createdAt: string;
    bidangTujuanNama: string;
  }>;
  auditLogs: Array<{
    checkpoint: string;
    aktorNip: string;
    timestamp: string;
  }>;
}

export interface SiveraClientOptions {
  connectionString?: string;
  customSearchSurat?: (keyword: string) => Promise<SuratRow[]>;
  customGetDisposisi?: (suratId: string) => Promise<DisposisiRow[]>;
  customGetAuditLogs?: (suratId: string) => Promise<AuditLogRow[]>;
}

export function mapStatusToCheckpoint(status: SiveraStatusSurat): {
  checkpointIndex: number;
  label: string;
} {
  switch (status) {
    case "DIDAFTARKAN_PPID":
      return { checkpointIndex: 1, label: "Registrasi Loket PPID" };
    case "DITERIMA_KEARSIPAN":
      return { checkpointIndex: 2, label: "Agenda Kearsipan" };
    case "TERDISPOSISI":
      return { checkpointIndex: 3, label: "Disposisi Kepala Dinas" };
    case "DITERIMA_BIDANG":
    case "DIPROSES":
      return { checkpointIndex: 4, label: "Tanda Terima Bidang" };
    case "ARSIP":
      return { checkpointIndex: 5, label: "Berkas Arsip Permanen" };
    default:
      return { checkpointIndex: 1, label: "Registrasi Loket PPID" };
  }
}

export class SiveraClient {
  private pool: pg.Pool | null = null;
  private customSearchSurat?: (keyword: string) => Promise<SuratRow[]>;
  private customGetDisposisi?: (suratId: string) => Promise<DisposisiRow[]>;
  private customGetAuditLogs?: (suratId: string) => Promise<AuditLogRow[]>;

  constructor(options: SiveraClientOptions = {}) {
    this.customSearchSurat = options.customSearchSurat;
    this.customGetDisposisi = options.customGetDisposisi;
    this.customGetAuditLogs = options.customGetAuditLogs;

    const connectionString = options.connectionString ?? env.SIVERA_DATABASE_URL;

    if (connectionString && !this.customSearchSurat) {
      this.pool = new Pool({
        connectionString,
        max: 5,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000,
        ssl: { rejectUnauthorized: false },
      });
    }
  }

  public isConnected(): boolean {
    return Boolean(this.pool || this.customSearchSurat);
  }

  public async searchSurat(keyword: string): Promise<SuratTrackDetail[]> {
    const cleanKeyword = keyword.trim();
    if (!cleanKeyword) return [];

    let rows: SuratRow[] = [];

    if (this.customSearchSurat) {
      rows = await this.customSearchSurat(cleanKeyword);
    } else if (this.pool) {
      const searchPattern = `%${cleanKeyword}%`;
      const query = `
        SELECT 
          s.id, 
          s."nomorSurat", 
          s."nomorAgenda", 
          s.pengirim, 
          s.perihal, 
          s."tanggalSurat", 
          s."tanggalDiterima", 
          s."statusSaatIni", 
          s."fileUrl"
        FROM "Surat" s
        WHERE 
          s."nomorSurat" ILIKE $1 
          OR s."nomorAgenda" ILIKE $1 
          OR s.pengirim ILIKE $1 
          OR s.perihal ILIKE $1
        ORDER BY s."tanggalDiterima" DESC
        LIMIT 5;
      `;
      const res = await this.pool.query(query, [searchPattern]);
      rows = res.rows;
    } else {
      return [];
    }

    const results: SuratTrackDetail[] = [];

    for (const row of rows) {
      const { checkpointIndex, label } = mapStatusToCheckpoint(row.statusSaatIni);

      let disposisiRows: DisposisiRow[] = [];
      let auditLogRows: AuditLogRow[] = [];

      if (this.customGetDisposisi) {
        disposisiRows = await this.customGetDisposisi(row.id);
      } else if (this.pool) {
        const dQuery = `
          SELECT 
            d.id, 
            d.catatan, 
            d."createdAt", 
            COALESCE(b.nama, 'Bidang Teknis') AS "bidangTujuanNama"
          FROM "Disposisi" d
          LEFT JOIN "Bidang" b ON d."keBidangId" = b.id
          WHERE d."suratId" = $1
          ORDER BY d."createdAt" ASC;
        `;
        const dRes = await this.pool.query(dQuery, [row.id]);
        disposisiRows = dRes.rows;
      }

      if (this.customGetAuditLogs) {
        auditLogRows = await this.customGetAuditLogs(row.id);
      } else if (this.pool) {
        const aQuery = `
          SELECT 
            a.id, 
            a.checkpoint, 
            a."aktorNip", 
            a.timestamp
          FROM "AuditLog" a
          WHERE a."suratId" = $1
          ORDER BY a.timestamp ASC;
        `;
        const aRes = await this.pool.query(aQuery, [row.id]);
        auditLogRows = aRes.rows;
      }

      results.push({
        id: row.id,
        nomorSurat: row.nomorSurat,
        nomorAgenda: row.nomorAgenda,
        pengirim: row.pengirim,
        perihal: row.perihal,
        tanggalSurat: row.tanggalSurat
          ? new Date(row.tanggalSurat).toLocaleDateString("id-ID", { dateStyle: "long" })
          : "-",
        tanggalDiterima: new Date(row.tanggalDiterima).toLocaleDateString("id-ID", { dateStyle: "long" }),
        statusSaatIni: row.statusSaatIni,
        checkpointIndex,
        checkpointLabel: label,
        fileUrl: row.fileUrl,
        disposisi: disposisiRows.map((d) => ({
          id: d.id,
          catatan: d.catatan,
          createdAt: new Date(d.createdAt).toLocaleString("id-ID", {
            dateStyle: "medium",
            timeStyle: "short",
          }),
          bidangTujuanNama: d.bidangTujuanNama,
        })),
        auditLogs: auditLogRows.map((a) => ({
          checkpoint: a.checkpoint,
          aktorNip: a.aktorNip,
          timestamp: new Date(a.timestamp).toLocaleString("id-ID", {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        })),

      });
    }

    return results;
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

export function formatSiveraTrackingMessage(results: SuratTrackDetail[]): string {
  if (results.length === 0) {
    return [
      "🔍 <b>Pelacakan Naskah Dinas SIVERA</b>",
      "Tidak ditemukan naskah dinas yang sesuai dengan kata kunci pencarian Anda.",
      "",
      "💡 <i>Tips: Pastikan nomor surat, nomor agenda, atau kata kunci instansi pengirim sudah tepat. Contoh: '600/124/BWS' atau 'Balai Wilayah Sungai'.</i>",
    ].join("\n");
  }

  const lines: string[] = [
    `📬 <b>PELACAKAN NASKAH DINAS SIVERA (${results.length} ditemukan)</b>`,
    "",
  ];

  for (const item of results) {
    const cp = item.checkpointIndex;
    const s1 = cp >= 1 ? "[✓]" : "[ ]";
    const s2 = cp >= 2 ? "[✓]" : "[ ]";
    const s3 = cp >= 3 ? "[✓]" : "[ ]";
    const s4 = cp >= 4 ? "[✓]" : "[ ]";
    const s5 = cp >= 5 ? "[✓]" : "[ ]";

    lines.push(`📄 <b>Nomor Surat:</b> <code>${item.nomorSurat}</code>`);
    lines.push(`• <b>No. Agenda :</b> ${item.nomorAgenda ? `<b>#${item.nomorAgenda}</b>` : "<i>(Belum diagendakan)</i>"}`);
    lines.push(`• <b>Pengirim    :</b> ${item.pengirim}`);
    lines.push(`• <b>Perihal     :</b> ${item.perihal}`);
    lines.push(`• <b>Tgl Masuk   :</b> ${item.tanggalDiterima}`);
    lines.push("");
    lines.push(`📍 <b>Posisi Alur (Checkpoint ${cp} dari 5):</b>`);
    lines.push(`${s1} 1. Registrasi Loket PPID`);
    lines.push(`${s2} 2. Agenda Kearsipan`);
    lines.push(`${s3} 3. Disposisi Kepala Dinas`);
    lines.push(`${s4} 4. Tanda Terima Bidang`);
    lines.push(`${s5} 5. Berkas Arsip Permanen`);

    if (item.disposisi.length > 0) {
      lines.push("");
      lines.push("📝 <b>Instruksi Lembar Disposisi:</b>");
      for (const d of item.disposisi) {
        lines.push(`• <b>Tujuan:</b> ${d.bidangTujuanNama}`);
        if (d.catatan) {
          lines.push(`  <i>"${d.catatan}"</i>`);
        }
        lines.push(`  <small>Waktu: ${d.createdAt}</small>`);
      }
    } else if (cp >= 3) {
      lines.push("");
      lines.push("<i>(Naskah telah melewati disposisi Kadis, menunggu pencatatan detail lembar disposisi).</i>");
    }

    lines.push("----------------------------------------");
  }

  return lines.join("\n");
}

export const siveraClient = new SiveraClient();
