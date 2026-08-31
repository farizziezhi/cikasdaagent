import { google } from "googleapis";
import { env } from "../config/env.js";
import { ArchiveSearchResult } from "../types/index.js";
import fs from "fs";

// Initialize Google Auth using the service account credentials from env
const getAuth = () => {
  const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"],
  });
};

const getDrive = () => {
  const auth = getAuth();
  return google.drive({ version: "v3", auth });
};

export interface SearchParams {
  keywords: string;
  date_from?: string;
  date_to?: string;
  doc_type?: string; // "pdf", "doc", "any"
}

export interface FileMetadata {
  id: string;
  name: string;
  size_mb: number;
  webViewLink: string;
}

/**
 * Menerjemahkan parameter menjadi query string Google Drive API (q)
 */
function buildDriveQuery(params: SearchParams): string {
  const conditions: string[] = [];
  
  // Hapus batasan 'in parents' agar bot bisa mencari hingga ke dalam sub-folder.
  // Karena bot menggunakan Service Account, bot secara otomatis HANYA akan 
  // mencari di dalam folder-folder yang sudah di-share kepadanya.
  // Kita tambahkan filter agar folder tidak ikut muncul sebagai hasil pencarian.
  conditions.push(`mimeType != 'application/vnd.google-apps.folder'`);

  // Keyword pada nama file
  if (params.keywords) {
    // Escaping single quotes untuk keamanan query
    const safeKeyword = params.keywords.replace(/'/g, "\\'");
    conditions.push(`name contains '${safeKeyword}'`);
  }

  // Filter tanggal (modifiedTime)
  if (params.date_from) {
    conditions.push(`modifiedTime >= '${params.date_from}'`);
  }
  if (params.date_to) {
    conditions.push(`modifiedTime <= '${params.date_to}'`);
  }

  // Filter jenis dokumen (MIME type)
  if (params.doc_type && params.doc_type !== "any") {
    if (params.doc_type === "pdf") {
      conditions.push(`mimeType = 'application/pdf'`);
    } else if (params.doc_type === "doc") {
      // Mencakup doc dan docx
      conditions.push(`(mimeType = 'application/msword' or mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')`);
    }
  }

  return conditions.join(" and ");
}

/**
 * Mencari file arsip di Google Drive berdasarkan metadata.
 */
export async function searchFiles(params: SearchParams): Promise<ArchiveSearchResult[]> {
  const drive = getDrive();
  const query = buildDriveQuery(params);

  try {
    const response = await drive.files.list({
      q: query,
      fields: "files(id, name, size, modifiedTime)",
      spaces: "drive",
      pageSize: 10,
      orderBy: "modifiedTime desc"
    });

    const files = response.data.files || [];
    
    return files.map(file => {
      // Konversi ukuran bytes ke MB
      const sizeBytes = parseInt(file.size || "0", 10);
      const size_mb = Number((sizeBytes / (1024 * 1024)).toFixed(2));

      return {
        file_id: file.id || "",
        name: file.name || "Untitled",
        size_mb: size_mb,
        modified: file.modifiedTime?.split("T")[0] || "" // Ambil YYYY-MM-DD
      };
    });
  } catch (error) {
    console.error("[DriveClient] Error searching files:", error);
    throw new Error("Gagal melakukan pencarian arsip di Google Drive.");
  }
}

/**
 * Mengambil detail metadata dari satu file.
 */
export async function getFileMetadata(fileId: string): Promise<FileMetadata> {
  const drive = getDrive();
  try {
    const response = await drive.files.get({
      fileId: fileId,
      fields: "id, name, size, webViewLink",
    });

    const sizeBytes = parseInt(response.data.size || "0", 10);
    const size_mb = Number((sizeBytes / (1024 * 1024)).toFixed(2));

    return {
      id: response.data.id || fileId,
      name: response.data.name || "Unknown",
      size_mb: size_mb,
      webViewLink: response.data.webViewLink || "",
    };
  } catch (error) {
    console.error(`[DriveClient] Error getting metadata for file ${fileId}:`, error);
    throw new Error("Gagal mengambil metadata file dari Google Drive.");
  }
}

/**
 * Mengunduh file dari Google Drive dan menyimpannya secara lokal (untuk file kecil).
 */
export async function downloadFile(fileId: string, destPath: string): Promise<void> {
  const drive = getDrive();
  try {
    // 1. Cek tipe file terlebih dahulu
    const meta = await drive.files.get({ fileId, fields: "mimeType" });
    const mimeType = meta.data.mimeType || "";

    let response;
    
    // Tipe Google Workspace yang bisa di-export
    const exportableTypes = [
      "application/vnd.google-apps.document",
      "application/vnd.google-apps.spreadsheet",
      "application/vnd.google-apps.presentation"
    ];

    if (exportableTypes.includes(mimeType)) {
      // Kita export ke PDF agar bisa diunduh
      const exportMimeType = "application/pdf";
      response = await drive.files.export(
        { fileId: fileId, mimeType: exportMimeType },
        { responseType: "stream" }
      );
    } else if (mimeType.startsWith("application/vnd.google-apps.")) {
      // File jenis lain seperti Folder, Form, Shortcut tidak bisa didownload
      throw new Error(`File ini memiliki format ${mimeType} yang tidak bisa diunduh langsung.`);
    } else {
      // 3. Jika file biner biasa (PDF, Word, JPG, dll)
      response = await drive.files.get(
        { fileId: fileId, alt: "media" },
        { responseType: "stream" }
      );
    }

    return new Promise((resolve, reject) => {
      const dest = fs.createWriteStream(destPath);
      response.data
        .on("end", () => {
          resolve();
        })
        .on("error", (err: any) => {
          reject(err);
        })
        .pipe(dest);
    });
  } catch (error) {
    console.error(`[DriveClient] Error downloading file ${fileId}:`, error);
    throw new Error("Gagal mengunduh file dari Google Drive.");
  }
}

/**
 * Mengunggah file baru ke Google Drive (contoh: untuk notulen).
 */
export async function uploadFile(
  fileName: string,
  contentStream: fs.ReadStream | string,
  mimeType: string,
  parentFolderId: string
): Promise<{ file_id: string; webViewLink: string }> {
  const drive = getDrive();
  try {
    const fileMetadata = {
      name: fileName,
      parents: [parentFolderId],
    };
    
    let media: any = { mimeType };
    if (typeof contentStream === "string") {
      media.body = contentStream;
    } else {
      media.body = contentStream;
    }

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: "id, webViewLink",
    });

    return {
      file_id: response.data.id || "",
      webViewLink: response.data.webViewLink || "",
    };
  } catch (error) {
    console.error("[DriveClient] Error uploading file:", error);
    throw new Error("Gagal mengunggah file ke Google Drive.");
  }
}
