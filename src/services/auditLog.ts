import { ensureTabExists, appendRow } from "./sheetsClient.js";
import { AuditLogEntry } from "../types/index.js";

const TAB_NAME = "AuditLog";
const HEADERS = [
  "timestamp",
  "chat_id",
  "staff_name",
  "mode",
  "query_or_filename",
  "result_document",
  "status",
];

let tabEnsured = false;

/**
 * Service: auditLog — Tulis baris log ke Google Sheets.
 * Menulis satu baris log aktivitas ke tab AuditLog.
 * Tab akan di-auto-create jika belum ada.
 * Ref: TDD §3.2
 */
export async function logActivity(entry: AuditLogEntry): Promise<void> {
  try {
    // Pastikan tab ada (hanya dicek sekali per sesi)
    if (!tabEnsured) {
      await ensureTabExists(TAB_NAME, HEADERS);
      tabEnsured = true;
    }

    await appendRow(TAB_NAME, [
      entry.timestamp,
      entry.chat_id,
      entry.staff_name || "",
      entry.mode,
      entry.query_or_filename,
      entry.result_document,
      entry.status,
    ]);

    console.log(
      `[AuditLog] Logged activity for chat_id ${entry.chat_id} (status: ${entry.status})`
    );
  } catch (error) {
    console.error("[AuditLog] Error writing to Google Sheets:", error);
    // Kita biarkan error tertangkap di sini agar kegagalan log tidak membuat bot crash
  }
}
