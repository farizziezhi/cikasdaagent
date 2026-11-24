import { ppidClient as defaultPpidClient, PpidClient } from "./ppidClient.js";
import { siveraClient as defaultSiveraClient, SiveraClient, StalledSuratItem } from "./siveraClient.js";
import { apelinClient as defaultApelinClient, ApelinClient } from "./apelinClient.js";

export type MonitoredService = "ppid-digital" | "sivera" | "apelin" | "wordpress";

const SERVICE_LABELS: Record<MonitoredService, string> = {
  "ppid-digital": "PPID-Digital (Supabase)",
  sivera: "SIVERA (Database Persuratan)",
  apelin: "APEL-IN (Database Presensi)",
  wordpress: "WordPress CIKASDA NEWS",
};

/**
 * Penjaga Kesehatan Koneksi (Health Watchdog).
 * Mengirim peringatan teknis ke admin hanya setelah kegagalan beruntun >= threshold (default 3x)
 * agar tidak spam saat gangguan sesaat, serta mengirim notif pemulihan saat normal kembali.
 */
export class HealthWatchdog {
  private failureCounts: Map<MonitoredService, number> = new Map();
  private alertedServices: Set<MonitoredService> = new Set();
  private threshold: number;

  constructor(threshold: number = 3) {
    this.threshold = threshold;
  }

  public recordSuccess(service: MonitoredService): string | null {
    this.failureCounts.set(service, 0);
    if (this.alertedServices.has(service)) {
      this.alertedServices.delete(service);
      return `✅ <b>HEALTH WATCHDOG:</b> Koneksi <b>${SERVICE_LABELS[service]}</b> telah kembali normal.`;
    }
    return null;
  }

  public recordFailure(service: MonitoredService, reason: string): string | null {
    const next = (this.failureCounts.get(service) ?? 0) + 1;
    this.failureCounts.set(service, next);

    if (next >= this.threshold && !this.alertedServices.has(service)) {
      this.alertedServices.add(service);
      const safeReason = reason.slice(0, 180);
      return [
        `🩺 <b>PERINGATAN HEALTH WATCHDOG</b>`,
        `• <b>Layanan :</b> ${SERVICE_LABELS[service]}`,
        `• <b>Status  :</b> Gagal terhubung ${next}× berturut-turut`,
        `• <b>Detail  :</b> <code>${safeReason}</code>`,
        "",
        `<i>Mohon admin teknis memeriksa koneksi/kredensial layanan terkait.</i>`,
      ].join("\n");
    }
    return null;
  }
}

export interface StaleDraftItem {
  id: number;
  title: string;
  ageHours: number;
  editLink: string;
}

export interface StaleDraftDeps {
  fetchFn?: typeof fetch;
  envSource?: Record<string, string | undefined>;
  now?: Date;
}

/**
 * Cek draf berita CIKASDA NEWS di WordPress yang sudah mengendap > 24 jam dan belum ditayangkan.
 */
export async function checkStaleWordpressDrafts(
  deps: StaleDraftDeps = {},
): Promise<{ message: string | null; count: number; error?: string }> {
  const envSource = deps.envSource ?? process.env;
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = deps.now ?? new Date();

  const baseUrl = (envSource.WP_BASE_URL || "https://cikasda.sultengprov.go.id")
    .trim()
    .replace(/\/+$/, "");
  const wpUser = (envSource.WP_USER || "").trim();
  const wpAppPassword = (envSource.WP_APP_PASSWORD || "").trim();

  if (!wpUser || !wpAppPassword) {
    return { message: null, count: 0 };
  }

  const authHeader = "Basic " + Buffer.from(`${wpUser}:${wpAppPassword}`, "utf8").toString("base64");

  try {
    const res = await fetchFn(
      `${baseUrl}/wp-json/wp/v2/posts?status=draft&per_page=20&_fields=id,title,date_gmt,modified_gmt`,
      {
        method: "GET",
        headers: {
          Authorization: authHeader,
          "User-Agent": "CIKASDA-PPID-Bot/1.0",
        },
      },
    );

    if (!res.ok) {
      return { message: null, count: 0, error: `HTTP ${res.status}` };
    }

    const posts = (await res.json()) as Array<{
      id: number;
      title?: { rendered?: string };
      date_gmt?: string;
      modified_gmt?: string;
    }>;

    if (!Array.isArray(posts)) {
      return { message: null, count: 0, error: "Respons bukan array" };
    }

    const stale: StaleDraftItem[] = [];
    for (const p of posts) {
      const refIso = p.modified_gmt || p.date_gmt;
      if (!refIso) continue;
      const utcDate = new Date(refIso.endsWith("Z") ? refIso : `${refIso}Z`);
      if (Number.isNaN(utcDate.getTime())) continue;

      const ageHours = Math.floor((now.getTime() - utcDate.getTime()) / 3600000);
      if (ageHours >= 24) {
        stale.push({
          id: p.id,
          title: (p.title?.rendered || `Draf #${p.id}`).replace(/<[^>]+>/g, ""),
          ageHours,
          editLink: `${baseUrl}/wp-admin/post.php?post=${p.id}&action=edit`,
        });
      }
    }

    if (stale.length === 0) {
      return { message: null, count: 0 };
    }

    const lines: string[] = [
      `📰 <b>PENGINGAT DRAF BERITA CIKASDA NEWS (&gt; 24 JAM)</b>`,
      `Terdapat <b>${stale.length} draf berita</b> di WordPress yang belum ditayangkan:`,
      "",
    ];

    for (const item of stale.slice(0, 5)) {
      const days = Math.floor(item.ageHours / 24);
      const ageLabel = days >= 1 ? `${days} hari` : `${item.ageHours} jam`;
      lines.push(`• <b>[#${item.id}] ${item.title}</b> (mengendap ${ageLabel})`);
      lines.push(`  🔗 Edit WP: ${item.editLink}`);
    }

    if (stale.length > 5) {
      lines.push(`• ... dan ${stale.length - 5} draf lainnya.`);
    }

    lines.push("");
    lines.push(
      `💡 <i>Mohon Tim PPID / Kehumasan memeriksa fakta draf di atas dan menayangkan manual di WP Admin jika sudah sesuai.</i>`,
    );

    return { message: lines.join("\n"), count: stale.length };
  } catch (err: any) {
    return { message: null, count: 0, error: err?.message || "Kesalahan jaringan" };
  }
}

/**
 * Format pesan peringatan surat macet (> 2 hari kerja) di SIVERA.
 */
export function buildSiveraBottleneckMessage(items: StalledSuratItem[]): string | null {
  if (items.length === 0) return null;

  const lines: string[] = [
    `⚠️ <b>PERINGATAN SURAT TERTAHAN SIVERA (&gt; 2 HARI KERJA)</b>`,
    `Terdapat <b>${items.length} naskah dinas</b> yang belum bergerak melewati batas 2 hari kerja:`,
    "",
  ];

  for (const item of items.slice(0, 5)) {
    const stage =
      item.statusSaatIni === "DIDAFTARKAN_PPID"
        ? "Menunggu Verifikasi Loket"
        : "Menunggu Disposisi Kadis";
    lines.push(`• <b><code>${item.nomorSurat}</code></b> — ${item.pengirim}`);
    lines.push(`  Perihal: ${item.perihal}`);
    lines.push(`  Tahap: <i>${stage}</i> (tertahan ${item.businessDaysStalled} hari kerja)`);
  }

  if (items.length > 5) {
    lines.push(`• ... dan ${items.length - 5} surat tertahan lainnya.`);
  }

  lines.push("");
  lines.push(`💡 <i>Ketik 'lacak surat [nomor]' untuk memeriksa detail posisi naskah.</i>`);

  return lines.join("\n");
}

export interface WeeklyDigestOptions {
  ppidClient?: PpidClient;
  siveraClient?: SiveraClient;
  apelinClient?: ApelinClient;
  fetchFn?: typeof fetch;
  envSource?: Record<string, string | undefined>;
  date?: Date;
}

/**
 * Menyusun Laporan Ringkasan Mingguan (Weekly Executive Digest — Jumat 17:00 WITA).
 */
export async function buildWeeklyExecutiveDigest(
  options: WeeklyDigestOptions = {},
): Promise<string> {
  const ppid = options.ppidClient ?? defaultPpidClient;
  const sivera = options.siveraClient ?? defaultSiveraClient;
  const apelin = options.apelinClient ?? defaultApelinClient;
  const refDate = options.date ?? new Date();

  const formattedDate = refDate.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const [ppidRes, siveraRes, apelinRes, wpDraftRes] = await Promise.allSettled([
    ppid.getActivePermohonan(refDate),
    sivera.getPendingStats(),
    apelin.getSessionRecap(),
    checkStaleWordpressDrafts({
      fetchFn: options.fetchFn,
      envSource: options.envSource,
      now: refDate,
    }),
  ]);

  const lines: string[] = [
    `📊 <b>RINGKASAN MINGGUAN EKSEKUTIF PPID CIKASDA</b>`,
    `<i>${formattedDate} • 17:00 WITA</i>`,
    "",
  ];

  // 1. PPID-Digital
  lines.push(`📋 <b>1. Layanan Informasi Publik (PPID-Digital):</b>`);
  if (ppidRes.status === "fulfilled") {
    const items = ppidRes.value;
    const criticalCount = items.filter(
      (i) => i.sla.status === "CRITICAL" || i.sla.status === "OVERDUE",
    ).length;
    const warningCount = items.filter((i) => i.sla.status === "WARNING").length;
    lines.push(`• Tiket Aktif Akhir Pekan : ${items.length} permohonan`);
    lines.push(`• Status Mendesak (H-1/Lewat): ${criticalCount} tiket`);
    lines.push(`• Mendekati Batas (H-2/H-3): ${warningCount} tiket`);
  } else {
    lines.push(`• <i>(Data PPID-Digital tidak dapat diakses saat ini)</i>`);
  }

  lines.push("");

  // 2. SIVERA
  lines.push(`📬 <b>2. Persuratan Dinas (SIVERA):</b>`);
  if (siveraRes.status === "fulfilled") {
    const s = siveraRes.value;
    lines.push(`• Menunggu Verifikasi Loket : ${s.unverifiedCount} berkas`);
    lines.push(`• Menunggu Disposisi Kadis  : ${s.undisposedCount} berkas`);
    lines.push(`• Total Naskah Aktif        : ${s.totalActiveCount} berkas`);
  } else {
    lines.push(`• <i>(Data SIVERA tidak dapat diakses saat ini)</i>`);
  }

  lines.push("");

  // 3. APEL-IN
  lines.push(`⏱️ <b>3. Kedisiplinan Apel (APEL-IN):</b>`);
  if (apelinRes.status === "fulfilled" && apelinRes.value) {
    const recap = apelinRes.value;
    lines.push(
      `• Sesi Terakhir (${recap.session.localDate}): <b>${recap.summary.attendanceRate}%</b> hadir (${recap.summary.presentCount + recap.summary.lateCount}/${recap.summary.totalEmployees} pegawai)`,
    );
  } else {
    lines.push(`• <i>(Belum ada rekap apel terbaru minggu ini)</i>`);
  }

  // 4. WordPress CIKASDA NEWS
  if (wpDraftRes.status === "fulfilled" && !wpDraftRes.value.error) {
    lines.push("");
    lines.push(`📰 <b>4. Portal Berita CIKASDA NEWS:</b>`);
    lines.push(`• Draf Mengendap (> 24 jam): ${wpDraftRes.value.count} draf menunggu tinjauan`);
  }

  lines.push("");
  lines.push(
    `💡 <i>Draf laporan mingguan ini disusun otomatis untuk ditinjau Tim PPID sebelum diteruskan kepada Pimpinan.</i>`,
  );

  return lines.join("\n");
}
