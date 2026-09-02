import { env } from "../config/env.js";
import { ArchiveSearchResult } from "../types/index.js";
import { getGoogleAccessToken } from "./googleAuth.js";
import fs from "fs";
import { Readable } from "stream";
import { finished } from "stream/promises";

async function getAuthHeader(): Promise<string> {
  const token = await getGoogleAccessToken();
  return `Bearer ${token}`;
}

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
  
  conditions.push(`mimeType != 'application/vnd.google-apps.folder'`);

  if (params.keywords) {
    const safeKeyword = params.keywords.replace(/'/g, "\\'");
    conditions.push(`name contains '${safeKeyword}'`);
  }

  if (params.date_from) {
    conditions.push(`modifiedTime >= '${params.date_from}'`);
  }
  if (params.date_to) {
    conditions.push(`modifiedTime <= '${params.date_to}'`);
  }

  if (params.doc_type && params.doc_type !== "any") {
    if (params.doc_type === "pdf") {
      conditions.push(`mimeType = 'application/pdf'`);
    } else if (params.doc_type === "doc") {
      conditions.push(`(mimeType = 'application/msword' or mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')`);
    }
  }

  return conditions.join(" and ");
}

/**
 * Mencari file arsip di Google Drive berdasarkan metadata (REST API).
 */
export async function searchFiles(params: SearchParams): Promise<ArchiveSearchResult[]> {
  const query = buildDriveQuery(params);
  const authHeader = await getAuthHeader();

  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", query);
  url.searchParams.set("fields", "files(id, name, size, modifiedTime)");
  url.searchParams.set("spaces", "drive");
  url.searchParams.set("pageSize", "10");
  url.searchParams.set("orderBy", "modifiedTime desc");

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: authHeader },
    });

    if (!res.ok) {
      throw new Error(`[DriveClient] Gagal mencari file: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      files?: Array<{ id?: string; name?: string; size?: string; modifiedTime?: string }>;
    };

    const files = data.files || [];

    return files.map((file) => {
      const sizeBytes = parseInt(file.size || "0", 10);
      const size_mb = Number((sizeBytes / (1024 * 1024)).toFixed(2));

      return {
        file_id: file.id || "",
        name: file.name || "Untitled",
        size_mb: size_mb,
        modified: file.modifiedTime?.split("T")[0] || "",
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
  const authHeader = await getAuthHeader();
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,size,webViewLink`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: authHeader },
    });

    if (!res.ok) {
      throw new Error(`[DriveClient] Gagal mengambil metadata: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      id?: string;
      name?: string;
      size?: string;
      webViewLink?: string;
    };

    const sizeBytes = parseInt(data.size || "0", 10);
    const size_mb = Number((sizeBytes / (1024 * 1024)).toFixed(2));

    return {
      id: data.id || fileId,
      name: data.name || "Unknown",
      size_mb: size_mb,
      webViewLink: data.webViewLink || "",
    };
  } catch (error) {
    console.error(`[DriveClient] Error getting metadata for file ${fileId}:`, error);
    throw new Error("Gagal mengambil metadata file dari Google Drive.");
  }
}

/**
 * Mengunduh file dari Google Drive dan menyimpannya secara lokal.
 */
export async function downloadFile(fileId: string, destPath: string): Promise<void> {
  const authHeader = await getAuthHeader();

  try {
    // 1. Cek MIME type
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType`,
      { headers: { Authorization: authHeader } }
    );
    if (!metaRes.ok) {
      throw new Error(`Gagal membaca tipe file: ${await metaRes.text()}`);
    }

    const meta = (await metaRes.json()) as { mimeType?: string };
    const mimeType = meta.mimeType || "";

    let downloadUrl: string;

    const exportableTypes = [
      "application/vnd.google-apps.document",
      "application/vnd.google-apps.spreadsheet",
      "application/vnd.google-apps.presentation",
    ];

    if (exportableTypes.includes(mimeType)) {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`;
    } else if (mimeType.startsWith("application/vnd.google-apps.")) {
      throw new Error(`File berformat ${mimeType} tidak bisa diunduh langsung.`);
    } else {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    }

    const res = await fetch(downloadUrl, {
      headers: { Authorization: authHeader },
    });

    if (!res.ok || !res.body) {
      throw new Error(`Gagal download konten file: ${await res.text()}`);
    }

    const fileStream = fs.createWriteStream(destPath);
    // @ts-ignore
    await finished(Readable.fromWeb(res.body).pipe(fileStream));
  } catch (error) {
    console.error(`[DriveClient] Error downloading file ${fileId}:`, error);
    throw new Error("Gagal mengunduh file dari Google Drive.");
  }
}

/**
 * Mengunggah file baru ke Google Drive (Multipart Upload).
 */
export async function uploadFile(
  fileName: string,
  contentStream: fs.ReadStream | string | Buffer,
  mimeType: string,
  parentFolderId: string
): Promise<{ file_id: string; webViewLink: string }> {
  const authHeader = await getAuthHeader();

  try {
    let fileBuffer: Buffer;
    if (typeof contentStream === "string") {
      fileBuffer = Buffer.from(contentStream, "utf-8");
    } else if (Buffer.isBuffer(contentStream)) {
      fileBuffer = contentStream;
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of contentStream) {
        chunks.push(Buffer.from(chunk));
      }
      fileBuffer = Buffer.concat(chunks);
    }

    const metadata = {
      name: fileName,
      parents: [parentFolderId],
    };

    const boundary = "-------314159265358979323846";
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartRequestBody = Buffer.concat([
      Buffer.from(
        delimiter +
          "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
          JSON.stringify(metadata) +
          delimiter +
          `Content-Type: ${mimeType}\r\n\r\n`
      ),
      fileBuffer,
      Buffer.from(closeDelimiter),
    ]);

    const res = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: multipartRequestBody,
      }
    );

    if (!res.ok) {
      throw new Error(`[DriveClient] Upload gagal: ${await res.text()}`);
    }

    const data = (await res.json()) as { id?: string; webViewLink?: string };

    return {
      file_id: data.id || "",
      webViewLink: data.webViewLink || "",
    };
  } catch (error) {
    console.error("[DriveClient] Error uploading file:", error);
    throw new Error("Gagal mengunggah file ke Google Drive.");
  }
}
