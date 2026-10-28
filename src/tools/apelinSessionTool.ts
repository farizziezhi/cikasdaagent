import {
  apelinClient,
  formatApelinReportMessage,
  ApelinClient,
  type ApelinReportData,
} from "../services/apelinClient.js";

export interface CheckApelinParams {
  date?: string;
  chat_id?: string;
}

export type CheckApelinResponse =
  | {
      success: true;
      message: string;
      data: ApelinReportData | null;
    }
  | {
      success: false;
      error: string;
    };

export async function executeCheckApelinSession(
  params: CheckApelinParams,
  clientInstance: ApelinClient = apelinClient
): Promise<CheckApelinResponse> {
  const cleanDate = params.date ? params.date.trim() : undefined;

  // Validasi format tanggal YYYY-MM-DD jika disediakan
  if (cleanDate && !/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    return {
      success: false,
      error: "Format tanggal tidak valid. Harap gunakan format YYYY-MM-DD (contoh: 2026-10-26).",
    };
  }

  try {
    const report = await clientInstance.getSessionRecap(cleanDate);
    const message = formatApelinReportMessage(report);

    return {
      success: true,
      message,
      data: report,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Gagal memantau sesi apel kedinasan APEL-IN: ${err?.message || "Kesalahan internal basis data"}`,
    };
  }
}
