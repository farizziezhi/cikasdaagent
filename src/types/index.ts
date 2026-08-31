/**
 * Shared TypeScript * Types untuk integrasi OpenClaw plugins
 * Ref: TDD §3, §4
 */

/** Mode operasi agent */
export type AgentMode = "search" | "minutes";

/** Status audit log */
export type AuditStatus = "success" | "not_found" | "rejected_whitelist" | "error";

/** Baris audit log (Google Sheets) — Ref: TDD §3.2 */
export interface AuditLogEntry {
  timestamp: string;
  chat_id: string;
  staff_name?: string;
  mode: AgentMode;
  query_or_filename: string;
  result_document: string;
  status: AuditStatus;
}

/** Hasil pencarian arsip — Ref: TDD §4.1 */
export interface ArchiveSearchResult {
  file_id: string;
  name: string;
  size_mb: number;
  modified: string;
}

/** Draf notulen terstruktur — Ref: TDD §4.3 */
export interface MinutesDraft {
  title: string;
  agenda_points: string[];
  decisions: string[];
  action_items: Array<{ task: string; owner: string }>;
}
