import {
  ppidClient,
  formatPermohonanDigest,
  maskNik,
  maskPhone,
  PpidClient,
  type ExtendSlaResult,
} from "../services/ppidClient.js";
import { calculateBusinessDaysRemaining } from "../services/businessDays.js";

export interface CheckPpidSlaParams {
  id?: number;
  chat_id?: string;
}

export interface ExtendPpidSlaParams {
  id: number;
  alasan: string;
  chat_id: string;
}

export type CheckPpidSlaResponse =
  | {
      success: true;
      message: string;
      data?: {
        id: number;
        status: string;
        targetDeadline: string;
        daysRemaining: number;
        slaStatus: string;
        diperpanjang: boolean;
      };
      totalActive?: number;
      items?: Array<{
        id: number;
        jenisInformasi: string;
        pemohon: string;
        status: string;
        deadline: string;
        daysRemaining: number;
        slaStatus: string;
      }>;
    }
  | {
      success: false;
      error: string;
    };

export type ExtendPpidSlaResponse =
  | {
      success: true;
      message: string;
      data: ExtendSlaResult;
    }
  | {
      success: false;
      error: string;
    };

export async function executeCheckPpidSla(
  params: CheckPpidSlaParams,
  clientInstance: PpidClient = ppidClient
): Promise<CheckPpidSlaResponse> {

  try {
    if (params.id) {
      const ticket = await clientInstance.getPermohonanById(params.id);
      if (!ticket) {
        return {
          success: false,
          error: `Tiket permohonan #${params.id} tidak ditemukan di basis data PPID Digital.`,
        };
      }

      const targetDeadlineStr = (ticket.diperpanjang && ticket.deadline_akhir)
        ? ticket.deadline_akhir
        : (ticket.deadline_awal ?? new Date(ticket.created_at).toISOString().split("T")[0]);

      const targetDate = new Date(`${targetDeadlineStr}T23:59:59+08:00`);
      const sla = calculateBusinessDaysRemaining(new Date(), targetDate);

      const profile = Array.isArray(ticket.profiles) ? ticket.profiles[0] : ticket.profiles;
      const pemohonNama = profile?.nama ?? "Pemohon Umum";
      const pemohonNik = maskNik(profile?.nik);
      const pemohonPhone = maskPhone(profile?.telepon);

      const statusIcon =
        sla.status === "OVERDUE"
          ? "🛑 MELEWATI BATAS (OVERDUE)"
          : sla.status === "CRITICAL"
          ? "🚨 SANGAT KRITIS (H-1)"
          : sla.status === "WARNING"
          ? "⚠️ MENDEKATI BATAS (H-2 / H-3)"
          : "🟢 AMAN (NORMAL)";

      const message = [
        `📄 <b>DETAIL TIKET PERMOHONAN #${ticket.id}</b>`,
        `• <b>Informasi yang Diminta:</b> ${ticket.jenis_informasi}`,
        `• <b>Deskripsi Kebutuhan:</b> ${ticket.deskripsi}`,
        `• <b>Pemohon:</b> ${pemohonNama} (NIK: ${pemohonNik}, Telp: ${pemohonPhone})`,
        `• <b>Status Alur:</b> <code>${ticket.status.toUpperCase()}</code>`,
        `• <b>Tanggal Masuk:</b> ${new Date(ticket.created_at).toLocaleDateString("id-ID")}`,
        `• <b>Batas Waktu (SLA):</b> ${targetDeadlineStr}`,
        `• <b>Status Kepatuhan:</b> ${statusIcon} (Tersisa ${sla.daysRemaining} hari kerja)`,
        ticket.diperpanjang
          ? `• <b>Catatan Perpanjangan:</b> Sudah diperpanjang (+7 hari kerja). Alasan: <i>${ticket.alasan_perpanjangan ?? "-"}</i>`
          : `• <b>Perpanjangan Waktu:</b> Belum pernah diperpanjang.`,
      ].join("\n");

      return {
        success: true,
        message,
        data: {
          id: ticket.id,
          status: ticket.status,
          targetDeadline: targetDeadlineStr,
          daysRemaining: sla.daysRemaining,
          slaStatus: sla.status,
          diperpanjang: ticket.diperpanjang,
        },
      };
    }

    const items = await clientInstance.getActivePermohonan();
    const digestMessage = formatPermohonanDigest(items);

    return {
      success: true,
      message: digestMessage,
      totalActive: items.length,
      items: items.map((i) => ({
        id: i.id,
        jenisInformasi: i.jenisInformasi,
        pemohon: i.pemohonNama,
        status: i.status,
        deadline: i.targetDeadline,
        daysRemaining: i.sla.daysRemaining,
        slaStatus: i.sla.status,
      })),
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Gagal memantau SLA PPID: ${err?.message || "Kesalahan internal"}`,
    };
  }
}

export async function executeExtendPpidSla(
  params: ExtendPpidSlaParams,
  clientInstance: PpidClient = ppidClient
): Promise<ExtendPpidSlaResponse> {

  const { id, alasan, chat_id } = params;

  if (!id || typeof id !== "number" || id <= 0) {
    return {
      success: false,
      error: "ID tiket permohonan harus berupa angka bilangan bulat positif yang valid.",
    };
  }

  const cleanAlasan = (alasan || "").trim();
  if (cleanAlasan.length < 5) {
    return {
      success: false,
      error: "Alasan perpanjangan waktu layanan wajib diisi minimal 5 karakter demi akuntabilitas birokrasi.",
    };
  }

  try {
    const result = await clientInstance.extendSla(id, cleanAlasan);

    const message = [
      `✅ <b>PERPANJANGAN WAKTU SLA BERHASIL</b>`,
      `• <b>Nomor Tiket:</b> #${result.id}`,
      `• <b>Tenggat Awal:</b> ${result.deadlineSebelumnya}`,
      `• <b>Tenggat Baru (+7 Hari Kerja):</b> <b>${result.deadlineBaru}</b>`,
      `• <b>Alasan Resmi:</b> <i>"${result.alasan}"</i>`,
      `• <b>Petugas Penanggung Jawab:</b> Chat ID <code>${chat_id}</code>`,
      ``,
      `<i>Pembaruan telah tersinkronisasi ke basis data PPID Digital sesuai UU KIP No. 14/2008 Pasal 22 ayat (7).</i>`,
    ].join("\n");

    return {
      success: true,
      message,
      data: result,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "Gagal memproses perpanjangan waktu SLA permohonan.",
    };
  }
}
