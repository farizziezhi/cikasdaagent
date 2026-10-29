import {
  buildMorningBriefing,
  type BuildBriefingOptions,
} from "../services/commandCenterScheduler.js";

export interface TriggerMorningDigestParams {
  chat_id?: string;
}

export type TriggerMorningDigestResponse =
  | {
      success: true;
      message: string;
    }
  | {
      success: false;
      error: string;
    };

export async function executeTriggerMorningDigest(
  _params: TriggerMorningDigestParams = {},
  options?: BuildBriefingOptions
): Promise<TriggerMorningDigestResponse> {
  try {
    const briefing = await buildMorningBriefing(options);
    return {
      success: true,
      message: briefing,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Gagal menyusun morning briefing CIKASDA: ${err?.message || "Kesalahan internal"}`,
    };
  }
}
