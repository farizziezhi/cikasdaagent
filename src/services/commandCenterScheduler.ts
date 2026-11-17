// commandCenterScheduler.ts — VERSI PATCH GABUNGAN (v2).
// Ganti file lama di repo dengan file ini.
//
// Yang TIDAK diubah dari versi asli (commit bb2a522):
//   - isApelDay, buildApelReminder, buildMorningBriefing (isi + 3 pilar)
//   - Jam pemicu waktu: Senin 06:45 apel pagi, Senin-Jumat 08:00 morning
//     briefing, Kamis 15:45 apel sore (semua WITA)
//   - Ambang SLA di businessDays.ts: CRITICAL = 0-1 hari kerja tersisa,
//     WARNING = 2-3 hari, OVERDUE = sudah lewat deadline.
//   - Signature shouldTrigger / tick / start / stop dipertahankan,
//     hanya tick() mendapat parameter opsional kedua { ppidClient }.
//
// Yang DITAMBAH (inilah yang bikin bot proaktif):
//   1. Penanda "sudah terkirim" disimpan ke file
//      data/scheduler-sent.json (env SCHEDULER_STATE_PATH), bukan cuma
//      di memori. Jadi tidak dobel kirim dan tidak hilang saat restart.
//      Hanya marker 7 hari terakhir dipertahankan.
//   2. Pemicu SLA KRITIS (BARU): tiap jam kerja Senin-Jumat 08:00-16:00
//      WITA, sekali per jam (menit 00-05), bot mengecek tiket aktif
//      via ppidClient.getActivePermohonan(). Kalau ada tiket yang BARU
//      menjadi CRITICAL / OVERDUE (belum pernah dialert hari itu untuk
//      status itu), bot langsung broadcast peringatan — tidak menunggu
//      briefing 08:00 besok. Tiket yang sama tidak dialert ulang di
//      hari yang sama untuk status yang sama; kalau status memburuk
//      (WARNING -> CRITICAL, CRITICAL -> OVERDUE) dialert lagi sekali.
//      Bot HANYA memberitahu. Bot TIDAK otomatis memperpanjang SLA —
//      perpanjangan tetap manual lewat tool extend_ppid_sla oleh petugas.
//   3. tick() memberi peringatan kalau pesan dibuat tapi tidak ada
//      sendBroadcast (tanda wiring di plugin.ts belum benar).
//   4. Singleton di bawah tetap dibuat TANPA callback supaya test lama
//      tidak rusak. Yang dipakai produksi adalah instance baru di
//      plugin.ts (lihat plugin-wiring-snippet.ts).
import { ppidClient as defaultPpidClient, PpidClient } from "./ppidClient.js";
import { siveraClient as defaultSiveraClient, SiveraClient } from "./siveraClient.js";
import { apelinClient as defaultApelinClient, ApelinClient } from "./apelinClient.js";
import * as fs from "node:fs";
import * as path from "node:path";

export interface ApelDayInfo {
  isApel: boolean;
  type: "MORNING" | "AFTERNOON" | null;
  label: string;
}

export function isApelDay(date: Date = new Date()): ApelDayInfo {
  // Hitung hari berdasarkan zona waktu WITA (UTC+8)
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const witaTime = new Date(utc + 8 * 3600000);
  const day = witaTime.getDay();

  if (day === 1) {
    return {
      isApel: true,
      type: "MORNING",
      label: "Apel Senin Pagi (07:15 WITA)",
    };
  }

  if (day === 4) {
    return {
      isApel: true,
      type: "AFTERNOON",
      label: "Apel Kamis Sore (15:45 WITA)",
    };
  }

  return {
    isApel: false,
    type: null,
    label: "Bukan Hari Apel Rutin",
  };
}

export function buildApelReminder(type: "MORNING" | "AFTERNOON"): string {
  if (type === "MORNING") {
    return [
      "📢 <b>PENGINGAT APEL SENIN PAGI CIKASDA</b>",
      "Sesi apel kedinasan pagi akan dibuka pada pukul <b>07:15 WITA</b> di halaman kantor.",
      "",
      "• Petugas operator scanner harap segera mengaktifkan terminal presensi APEL-IN.",
      "• Seluruh ASN dan staf diharapkan hadir tepat waktu di barisan.",
      "",
      "<i>Semangat mengawali pekan kedinasan! 💪</i>",
    ].join("\n");
  }

  return [
    "📢 <b>PENGINGAT APEL KAMIS SORE CIKASDA</b>",
    "Sesi apel kedinasan sore akan dibuka pada pukul <b>15:45 WITA</b>.",
    "",
    "• Petugas operator scanner harap memastikan perangkat pemindai siap.",
    "• Rekapitulasi kehadiran akan langsung dilaporkan ke pimpinan setelah sesi ditutup.",
    "",
    "<i>Tertib presensi wujud integritas ASN CIKASDA. ✨</i>",
  ].join("\n");
}

export interface BuildBriefingOptions {
  ppidClient?: PpidClient;
  siveraClient?: SiveraClient;
  apelinClient?: ApelinClient;
  date?: Date;
}

export async function buildMorningBriefing(options: BuildBriefingOptions = {}): Promise<string> {
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

  // Eksekusi paralel dengan toleransi kegagalan (resilience)
  const [ppidResult, siveraResult, apelinResult] = await Promise.allSettled([
    ppid.getActivePermohonan(refDate),
    sivera.getPendingStats(),
    apelin.getSessionRecap(),
  ]);

  const lines: string[] = [
    `🌅 <b>MORNING COMMAND BRIEFING CIKASDA</b>`,
    `<i>${formattedDate} • 08:00 WITA</i>`,
    "",
  ];

  // Pilar 1: PPID-Digital (Layanan KIP)
  lines.push("📋 <b>Layanan KIP (PPID-Digital):</b>");
  if (ppidResult.status === "fulfilled") {
    const items = ppidResult.value;
    const criticals = items.filter((i) => i.sla.status === "CRITICAL" || i.sla.status === "OVERDUE");
    const warnings = items.filter((i) => i.sla.status === "WARNING");

    lines.push(`• Total Tiket Aktif : ${items.length} permohonan`);
    if (criticals.length > 0) {
      lines.push(`• 🚨 <b>PERHATIAN KRITIS:</b> ${criticals.length} tiket mendesak!`);
      for (const c of criticals.slice(0, 2)) {
        lines.push(`  - [#${c.id}] ${c.jenisInformasi} (${c.pemohonNama}) sisa ${c.sla.daysRemaining} hari kerja`);
      }
    } else if (warnings.length > 0) {
      lines.push(`• ⚠️ <b>Mendekati Batas:</b> ${warnings.length} tiket (H-2 / H-3)`);
    } else {
      lines.push(`• Status SLA : 🟢 Terkendali aman`);
    }
  } else {
    lines.push("• <i>(Koneksi PPID-Digital sedang offline)</i>");
  }

  lines.push("");

  // Pilar 2: SIVERA (Persuratan Dinas)
  lines.push("📬 <b>Persuratan Dinas (SIVERA):</b>");
  if (siveraResult.status === "fulfilled") {
    const stats = siveraResult.value;
    lines.push(`• Surat Masuk di Loket : ${stats.unverifiedCount} berkas menunggu verifikasi agenda`);
    lines.push(`• Menunggu Disposisi   : ${stats.undisposedCount} berkas di meja Kadis`);
    lines.push(`• Total Naskah Aktif   : ${stats.totalActiveCount} berkas berjalan`);
  } else {
    lines.push("• <i>(Koneksi SIVERA sedang offline)</i>");
  }

  lines.push("");

  // Pilar 3: APEL-IN (Presensi Kepegawaian)
  const apelInfo = isApelDay(refDate);
  lines.push("⏱️ <b>Presensi Kepegawaian (APEL-IN):</b>");
  if (apelInfo.isApel) {
    lines.push(`• <b>JADWAL HARI INI:</b> ${apelInfo.label.toUpperCase()}`);
    if (apelinResult.status === "fulfilled" && apelinResult.value) {
      const recap = apelinResult.value;
      lines.push(`• Status Sesi: ${recap.session.status} (${recap.summary.attendanceRate}% hadir)`);
    } else {
      lines.push(`• Terminal pemindai di halaman kantor siap menerima kehadiran pegawai.`);
    }
  } else {
    lines.push("• Tidak ada apel terjadwal hari ini (Apel rutin: Senin Pagi & Kamis Sore).");
  }

  lines.push("");
  lines.push("💡 <i>Ketik 'lacak surat [nomor]' atau 'cek apel' untuk info lebih detail. Selamat bertugas!</i>");

  return lines.join("\n");
}

// --- Peringatan SLA kritis (BARU) ---
// Hanya CRITICAL / OVERDUE yang dialert, maksimal 5 tiket per pesan,
// NIK + telepon tetap ter-masking (mengikuti ppidClient).
export function buildSlaAlertMessage(
  items: Array<{
    id: number;
    jenisInformasi: string;
    pemohonNama: string;
    pemohonNikMasked: string;
    targetDeadline: string;
    sla: { status: "CRITICAL" | "OVERDUE"; daysRemaining: number };
  }>,
  date: Date = new Date(),
): string {
  const formattedDate = date.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const lines: string[] = [
    `🚨 <b>PERINGATAN SLA PPID — TIKET MENDESAK</b>`,
    `<i>${formattedDate}</i>`,
    "",
  ];
  for (const item of items.slice(0, 5)) {
    const icon = item.sla.status === "OVERDUE" ? "🛑 OVERDUE" : "🚨 CRITICAL";
    const sisa =
      item.sla.status === "OVERDUE"
        ? `lewat ${Math.abs(item.sla.daysRemaining)} hari kerja`
        : item.sla.daysRemaining <= 0
          ? "jatuh tempo hari ini"
          : `sisa ${item.sla.daysRemaining} hari kerja`;
    lines.push(`<b>[#${item.id}] ${item.jenisInformasi}</b>`);
    lines.push(`• Pemohon : ${item.pemohonNama} (NIK: ${item.pemohonNikMasked})`);
    lines.push(`• Deadline: ${item.targetDeadline} — <b>${icon}</b> (${sisa})`);
    lines.push("");
  }
  if (items.length > 5) {
    lines.push(`• ... dan ${items.length - 5} tiket mendesak lainnya.`);
    lines.push("");
  }
  lines.push(
    "💡 <i>Bot hanya memberitahu. Perpanjangan +7 hari kerja tetap dilakukan petugas lewat 'perpanjang permohonan [ID] [alasan]' (maks. 1x, UU KIP No. 14/2008).</i>",
  );
  return lines.join("\n");
}

export interface SchedulerCallbacks {
  sendBroadcast: (message: string) => Promise<void>;
}

export interface TickOptions {
  ppidClient?: PpidClient;
}

// --- Penanda terkirim yang persisten (BARU di v1, dipakai juga v2) ---
// Format file: JSON array string.
//   briefing-2026-11-17, apel-pagi-2026-11-17, apel-sore-2026-11-17,
//   sla-check-2026-11-17-09, sla-alert-14-CRITICAL-2026-11-17
// Hanya marker 7 hari terakhir yang dipertahankan.
function defaultStatePath(): string {
  return (
    process.env.SCHEDULER_STATE_PATH ??
    path.join(process.cwd(), "data", "scheduler-sent.json")
  );
}

function extractMarkerDate(marker: string): string | null {
  const m = marker.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function loadMarkers(statePath: string): Set<string> {
  try {
    const raw = fs.readFileSync(statePath, "utf-8");
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    return new Set(
      arr.filter((m): m is string => {
        if (typeof m !== "string") return false;
        const d = extractMarkerDate(m);
        return d === null || d >= cutoffStr;
      }),
    );
  } catch {
    return new Set();
  }
}

function saveMarkers(statePath: string, markers: Set<string>): void {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify([...markers].sort(), null, 2));
  } catch (err) {
    console.error("[CommandCenterScheduler] gagal menyimpan penanda:", err);
  }
}

function toWita(date: Date): Date {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + 8 * 3600000);
}

export class CommandCenterScheduler {
  private timer: NodeJS.Timeout | null = null;
  private sentMarkers: Set<string>;
  private statePath: string;
  private callbacks?: SchedulerCallbacks;

  constructor(callbacks?: SchedulerCallbacks, statePath?: string) {
    this.callbacks = callbacks;
    this.statePath = statePath ?? defaultStatePath();
    this.sentMarkers = loadMarkers(this.statePath);
  }

  public shouldTrigger(now: Date = new Date()): "MORNING_BRIEFING" | "APEL_PAGI" | "APEL_SORE" | null {
    const wita = toWita(now);
    const day = wita.getDay();
    const hours = wita.getHours();
    const minutes = wita.getMinutes();
    const dateStr = wita.toISOString().split("T")[0];

    // Senin 06:45 WITA -> Pengingat Apel Pagi
    if (day === 1 && hours === 6 && minutes >= 45 && minutes <= 50) {
      const marker = `apel-pagi-${dateStr}`;
      if (!this.sentMarkers.has(marker)) {
        this.sentMarkers.add(marker);
        saveMarkers(this.statePath, this.sentMarkers);
        return "APEL_PAGI";
      }
    }

    // Hari kerja (Senin-Jumat) 08:00 WITA -> Morning Command Briefing
    if (day >= 1 && day <= 5 && hours === 8 && minutes >= 0 && minutes <= 5) {
      const marker = `briefing-${dateStr}`;
      if (!this.sentMarkers.has(marker)) {
        this.sentMarkers.add(marker);
        saveMarkers(this.statePath, this.sentMarkers);
        return "MORNING_BRIEFING";
      }
    }

    // Kamis 15:45 WITA -> Pengingat Apel Sore
    if (day === 4 && hours === 15 && minutes >= 45 && minutes <= 50) {
      const marker = `apel-sore-${dateStr}`;
      if (!this.sentMarkers.has(marker)) {
        this.sentMarkers.add(marker);
        saveMarkers(this.statePath, this.sentMarkers);
        return "APEL_SORE";
      }
    }

    return null;
  }

  /** Sekali per jam kerja (Senin-Jumat 08:00-16:00 WITA, menit 00-05)
   *  waktunya cek SLA. Di luar itu return false supaya Supabase tidak
   *  di-query tiap menit (1440x/hari -> ~9x/hari kerja). */
  public shouldCheckSla(now: Date = new Date()): boolean {
    const wita = toWita(now);
    const day = wita.getDay();
    const hours = wita.getHours();
    const minutes = wita.getMinutes();
    if (day < 1 || day > 5) return false;
    if (hours < 8 || hours > 16) return false;
    if (minutes < 0 || minutes > 5) return false;
    const dateStr = wita.toISOString().split("T")[0];
    const marker = `sla-check-${dateStr}-${String(hours).padStart(2, "0")}`;
    if (this.sentMarkers.has(marker)) return false;
    this.sentMarkers.add(marker);
    saveMarkers(this.statePath, this.sentMarkers);
    return true;
  }

  /** Cek tiket kritis. Return pesan alert kalau ada tiket yang baru
   *  menjadi CRITICAL/OVERDUE, null kalau tidak ada yang baru. */
  public async checkSlaAlerts(
    now: Date = new Date(),
    ppidClient?: PpidClient,
  ): Promise<string | null> {
    if (!this.shouldCheckSla(now)) return null;
    const ppid = ppidClient ?? defaultPpidClient;
    let items;
    try {
      items = await ppid.getActivePermohonan(now);
    } catch (err) {
      console.error("[CommandCenterScheduler] gagal cek SLA:", err);
      return null;
    }
    const wita = toWita(now);
    const dateStr = wita.toISOString().split("T")[0];
    const fresh = items.filter(
      (i) =>
        (i.sla.status === "CRITICAL" || i.sla.status === "OVERDUE") &&
        !this.sentMarkers.has(`sla-alert-${i.id}-${i.sla.status}-${dateStr}`),
    );
    if (fresh.length === 0) return null;
    for (const item of fresh) {
      this.sentMarkers.add(`sla-alert-${item.id}-${item.sla.status}-${dateStr}`);
    }
    saveMarkers(this.statePath, this.sentMarkers);
    return buildSlaAlertMessage(
      fresh.map((i) => ({
        id: i.id,
        jenisInformasi: i.jenisInformasi,
        pemohonNama: i.pemohonNama,
        pemohonNikMasked: i.pemohonNikMasked,
        targetDeadline: i.targetDeadline,
        sla: {
          status: i.sla.status as "CRITICAL" | "OVERDUE",
          daysRemaining: i.sla.daysRemaining,
        },
      })),
      now,
    );
  }

  public async tick(now: Date = new Date(), options: TickOptions = {}): Promise<string | null> {
    const trigger = this.shouldTrigger(now);
    let message: string | null = null;

    if (trigger === "MORNING_BRIEFING") {
      message = await buildMorningBriefing({ date: now });
    } else if (trigger === "APEL_PAGI") {
      message = buildApelReminder("MORNING");
    } else if (trigger === "APEL_SORE") {
      message = buildApelReminder("AFTERNOON");
    } else {
      // Tidak ada pemicu jam -> cek SLA kritis (sekali per jam kerja).
      message = await this.checkSlaAlerts(now, options.ppidClient);
    }

    if (!message) return null;

    if (this.callbacks?.sendBroadcast) {
      await this.callbacks.sendBroadcast(message);
    } else {
      // Jangan diam-diam hilang: kalau tidak ada callback, ini bug wiring.
      console.warn(
        "[CommandCenterScheduler] pesan dibuat tapi tidak ada sendBroadcast — cek wiring di plugin.ts",
      );
    }

    return message;
  }

  public start(intervalMs: number = 60000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        console.error("[CommandCenterScheduler] Error in background scheduler:", err);
      });
    }, intervalMs);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const commandCenterScheduler = new CommandCenterScheduler();
