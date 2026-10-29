import { ppidClient as defaultPpidClient, PpidClient } from "./ppidClient.js";
import { siveraClient as defaultSiveraClient, SiveraClient } from "./siveraClient.js";
import { apelinClient as defaultApelinClient, ApelinClient } from "./apelinClient.js";

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

export interface SchedulerCallbacks {
  sendBroadcast: (message: string) => Promise<void>;
}

export class CommandCenterScheduler {
  private timer: NodeJS.Timeout | null = null;
  private sentMarkers: Set<string> = new Set();
  private callbacks?: SchedulerCallbacks;

  constructor(callbacks?: SchedulerCallbacks) {
    this.callbacks = callbacks;
  }

  public shouldTrigger(now: Date = new Date()): "MORNING_BRIEFING" | "APEL_PAGI" | "APEL_SORE" | null {
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const wita = new Date(utc + 8 * 3600000);
    const day = wita.getDay();
    const hours = wita.getHours();
    const minutes = wita.getMinutes();
    const dateStr = wita.toISOString().split("T")[0];

    // Senin 06:45 WITA -> Pengingat Apel Pagi
    if (day === 1 && hours === 6 && minutes >= 45 && minutes <= 50) {
      const marker = `apel-pagi-${dateStr}`;
      if (!this.sentMarkers.has(marker)) {
        this.sentMarkers.add(marker);
        return "APEL_PAGI";
      }
    }

    // Hari kerja (Senin-Jumat) 08:00 WITA -> Morning Command Briefing
    if (day >= 1 && day <= 5 && hours === 8 && minutes >= 0 && minutes <= 5) {
      const marker = `briefing-${dateStr}`;
      if (!this.sentMarkers.has(marker)) {
        this.sentMarkers.add(marker);
        return "MORNING_BRIEFING";
      }
    }

    // Kamis 15:45 WITA -> Pengingat Apel Sore
    if (day === 4 && hours === 15 && minutes >= 45 && minutes <= 50) {
      const marker = `apel-sore-${dateStr}`;
      if (!this.sentMarkers.has(marker)) {
        this.sentMarkers.add(marker);
        return "APEL_SORE";
      }
    }

    return null;
  }

  public async tick(now: Date = new Date()): Promise<string | null> {
    const trigger = this.shouldTrigger(now);
    if (!trigger) return null;

    let message: string | null = null;
    if (trigger === "MORNING_BRIEFING") {
      message = await buildMorningBriefing({ date: now });
    } else if (trigger === "APEL_PAGI") {
      message = buildApelReminder("MORNING");
    } else if (trigger === "APEL_SORE") {
      message = buildApelReminder("AFTERNOON");
    }

    if (message && this.callbacks?.sendBroadcast) {
      await this.callbacks.sendBroadcast(message);
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

