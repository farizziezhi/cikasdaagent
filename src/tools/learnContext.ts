import { learnFact, forgetFact, listAllMemories } from "../services/learnedMemory.js";

export interface LearnContextParams {
  action: "learn" | "forget" | "list";
  category?: "project" | "team" | "glossary" | "preference";
  key?: string;
  value?: string;
}

/**
 * Eksekutor tool pembelajaran memori konteks rapat
 */
export async function executeLearnContext(params: LearnContextParams) {
  const { action, category = "glossary", key = "", value = "" } = params;

  if (action === "list") {
    const list = listAllMemories();
    return {
      success: true,
      message: list
    };
  }

  if (action === "forget") {
    if (!key) {
      return { success: false, error: "Harap tentukan kata kunci (key) yang ingin dilupakan." };
    }
    return forgetFact(key);
  }

  if (action === "learn") {
    if (!key || !value) {
      return { success: false, error: "Harap berikan kata kunci (key) dan penjelasannya (value)." };
    }
    return learnFact(category, key, value);
  }

  return { success: false, error: `Aksi "${action}" tidak dikenali.` };
}
