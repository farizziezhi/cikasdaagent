import {
  siveraClient,
  formatSiveraTrackingMessage,
  SiveraClient,
  type SuratTrackDetail,
} from "../services/siveraClient.js";

export interface TrackSiveraParams {
  keyword: string;
  chat_id?: string;
}

export type TrackSiveraResponse =
  | {
      success: true;
      message: string;
      totalFound: number;
      items: SuratTrackDetail[];
    }
  | {
      success: false;
      error: string;
    };

export async function executeTrackSiveraSurat(
  params: TrackSiveraParams,
  clientInstance: SiveraClient = siveraClient
): Promise<TrackSiveraResponse> {
  const rawKeyword = params.keyword ?? "";
  const cleanKeyword = rawKeyword.trim();

  if (cleanKeyword.length < 2) {
    return {
      success: false,
      error: "Kata kunci pelacakan surat dinas minimal 2 karakter (misal nomor surat, nomor agenda, atau nama pengirim).",
    };
  }

  try {
    const results = await clientInstance.searchSurat(cleanKeyword);
    const formattedMessage = formatSiveraTrackingMessage(results);

    return {
      success: true,
      message: formattedMessage,
      totalFound: results.length,
      items: results,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Gagal melacak naskah dinas di SIVERA: ${err?.message || "Kesalahan internal basis data"}`,
    };
  }
}
