import { searchFiles, SearchParams } from "../services/driveClient.js";

/**
 * Tool: search_archive — cari dokumen di Google Drive by metadata.
 * Ref: TDD §4.1
 */

/**
 * Handler eksekusi tool search_archive
 * @param args Argumen yang diberikan oleh LLM berdasarkan skema
 */
export async function executeSearchArchive(args: any) {
  try {
    const params: SearchParams = {
      keywords: args.keywords,
      date_from: args.date_from,
      date_to: args.date_to,
      doc_type: args.doc_type,
    };
    
    console.log("[Tool] Executing search_archive with params:", params);
    const results = await searchFiles(params);
    
    return {
      results
    };
  } catch (error: any) {
    console.error("[Tool] search_archive error:", error);
    return {
      error: error.message || "Gagal mengeksekusi pencarian."
    };
  }
}
