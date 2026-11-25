import fs from "fs";
import path from "path";
import { env } from "../config/env.js";
import { uploadFile } from "../services/driveClient.js";
import { getPpidDriveAccessToken } from "../services/googleAuth.js";
import { ensureTabExists, appendRow } from "../services/sheetsClient.js";
import { ppidClient as defaultPpidClient, PpidClient, PermohonanRow } from "../services/ppidClient.js";
import { normalizeChatId } from "../services/broadcast.js";

export type KipCategory = "Berkala" | "Serta Merta" | "Setiap Saat";

export interface ResolveAndArchiveParams {
  ticket_id?: number;
  new_status?: PermohonanRow["status"];
  file_path?: string;
  document_title?: string;
  kip_category?: KipCategory;
  notes?: string;
  chat_id: string;
}

export interface ResolveAndArchiveDeps {
  ppidClient?: PpidClient;
  uploadDriveFn?: typeof uploadFile;
  ensureTabFn?: typeof ensureTabExists;
  appendRowFn?: typeof appendRow;
  targetFolderId?: string;
}

const DIP_TAB = "DaftarInformasiPublik";
const DIP_HEADERS = [
  "tanggal_arsip",
  "klasifikasi_kip",
  "nama_file_standar",
  "judul_dokumen",
  "id_tiket_ppid",
  "link_drive",
  "petugas_chat_id",
];

/**
 * Klasifikasikan dokumen ke kategori UU KIP berdasarkan judul/catatan bila tidak diisi eksplisit.
 */
export function inferKipCategory(text: string): KipCategory {
  const lower = text.toLowerCase();
  if (
    lower.includes("bencana") ||
    lower.includes("darurat") ||
    lower.includes("banjir") ||
    lower.includes("peringatan dini") ||
    lower.includes("wabah")
  ) {
    return "Serta Merta";
  }
  if (
    lower.includes("lra") ||
    lower.includes("realisasi") ||
    lower.includes("lakip") ||
    lower.includes("renja") ||
    lower.includes("dpa") ||
    lower.includes("profil") ||
    lower.includes("tahunan") ||
    lower.includes("laporan keuangan")
  ) {
    return "Berkala";
  }
  return "Setiap Saat";
}

/**
 * Bangun nama file standar arsip dinas: [Klasifikasi]_[YYYY-MM-DD]_[Slug].[ext]
 */
export function buildArchiveFileName(
  category: KipCategory,
  title: string,
  originalPath: string,
  date: Date = new Date(),
): string {
  const tag = category.replace(/\s+/g, "");
  const dateStr = date.toISOString().split("T")[0];
  const slug =
    title
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "Dokumen_PPID";
  const ext = path.extname(originalPath) || ".pdf";
  return `${tag}_${dateStr}_${slug}${ext}`;
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
}

async function ensurePpidFolderPath(
  oauthToken: string,
  rootFolderId: string,
  segments: string[],
): Promise<string> {
  let currentParentId = rootFolderId;
  for (const folderName of segments) {
    const escapedName = folderName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const parentFilter = currentParentId ? ` and '${currentParentId}' in parents` : "";
    const q = `mimeType = 'application/vnd.google-apps.folder' and name = '${escapedName}' and trashed = false${parentFilter}`;

    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
      { headers: { Authorization: `Bearer ${oauthToken}` } },
    );
    if (searchRes.ok) {
      const searchData = (await searchRes.json()) as { files?: Array<{ id: string }> };
      if (searchData.files?.[0]?.id) {
        currentParentId = searchData.files[0].id;
        continue;
      }
    }

    const createRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${oauthToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        ...(currentParentId ? { parents: [currentParentId] } : {}),
      }),
    });
    if (!createRes.ok) {
      return currentParentId;
    }
    const created = (await createRes.json()) as { id?: string };
    if (created.id) {
      currentParentId = created.id;
    }
  }
  return currentParentId;
}

async function uploadWithPpidOAuthOrServiceAccount(
  fileName: string,
  filePath: string,
  mimeType: string,
  folderId: string,
  folderSegments: string[],
) {
  const oauthToken = await getPpidDriveAccessToken();
  if (!oauthToken) {
    return uploadFile(fileName, fs.createReadStream(filePath) as any, mimeType, folderId);
  }

  const targetParentId = await ensurePpidFolderPath(oauthToken, folderId, folderSegments);
  const boundary = `ppid_boundary_${Date.now()}`;
  const metadata = JSON.stringify({
    name: fileName,
    ...(targetParentId ? { parents: [targetParentId] } : {}),
  });
  const fileBuffer = fs.readFileSync(filePath);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${oauthToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Upload Drive OAuth2 PPID gagal (${res.status}): ${errText.slice(0, 150)}`);
  }

  return (await res.json()) as { id: string; name: string; webViewLink: string };
}

/**
 * Eksekutor tool resolve_and_archive_ppid (#2 Two-Way Sync + #3 Zero-Touch Auto-Filing).
 */
export async function executeResolveAndArchivePpid(
  params: ResolveAndArchiveParams,
  deps: ResolveAndArchiveDeps = {},
) {
  const ppid = deps.ppidClient ?? defaultPpidClient;
  const ensureTabFn = deps.ensureTabFn ?? ensureTabExists;
  const appendRowFn = deps.appendRowFn ?? appendRow;
  const folderId =
    deps.targetFolderId ?? (env.PPID_DRIVE_FOLDER_ID || env.DRIVE_ARCHIVE_FOLDER_ID);

  const cleanChatId = normalizeChatId(params.chat_id || "");
  const hasFile = Boolean(params.file_path && params.file_path.trim());
  const hasTicket = typeof params.ticket_id === "number" && params.ticket_id > 0;

  if (!hasFile && !hasTicket) {
    return {
      success: false,
      error: "Harap sertakan minimal file dokumen untuk diarsipkan atau nomor ticket_id PPID yang ingin diperbarui.",
    };
  }

  let archiveInfo: {
    fileName: string;
    category: KipCategory;
    driveLink: string;
  } | null = null;

  let ticketInfo: {
    id: number;
    status: PermohonanRow["status"];
  } | null = null;

  try {
    // 1. Zero-Touch Auto-Filing ke Google Drive + Daftar Informasi Publik (Sheets)
    if (hasFile) {
      const filePath = params.file_path!.trim();
      if (!fs.existsSync(filePath)) {
        return { success: false, error: `File tidak ditemukan di server: ${filePath}` };
      }

      const rawTitle =
        params.document_title?.trim() ||
        path.basename(filePath, path.extname(filePath));
      const category =
        params.kip_category ??
        inferKipCategory(`${rawTitle} ${params.notes || ""}`);
      const standardName = buildArchiveFileName(category, rawTitle, filePath);

      const witaYear = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Makassar",
        year: "numeric",
      }).format(new Date());
      const folderSegments = hasTicket
        ? ["Jawaban Permohonan", witaYear, `Tiket #${params.ticket_id}`]
        : ["Daftar Informasi Publik", category];

      const driveRes = deps.uploadDriveFn
        ? await deps.uploadDriveFn(
            standardName,
            fs.createReadStream(filePath) as any,
            getMimeType(filePath),
            folderId,
          )
        : await uploadWithPpidOAuthOrServiceAccount(
            standardName,
            filePath,
            getMimeType(filePath),
            folderId,
            folderSegments,
          );

      await ensureTabFn(DIP_TAB, DIP_HEADERS);
      await appendRowFn(DIP_TAB, [
        new Date().toISOString(),
        category,
        standardName,
        rawTitle,
        hasTicket ? `#${params.ticket_id}` : "-",
        driveRes.webViewLink,
        cleanChatId,
      ]);

      archiveInfo = {
        fileName: standardName,
        category,
        driveLink: driveRes.webViewLink,
      };
    }

    // 2. Two-Way Sync status tiket ke Supabase PPID-Digital
    if (hasTicket) {
      const targetStatus: PermohonanRow["status"] = params.new_status ?? "dijawab";
      ticketInfo = await ppid.updatePermohonanStatus(params.ticket_id!, targetStatus);
    }

    const lines: string[] = [`✅ <b>PROSES ARSIP & SINKRONISASI PPID SELESAI</b>`];
    if (archiveInfo) {
      lines.push(`📁 <b>Arsip Standar:</b> <code>${archiveInfo.fileName}</code>`);
      lines.push(`🏷️ <b>Klasifikasi KIP:</b> ${archiveInfo.category}`);
      lines.push(`🔗 <b>Tautan Drive:</b> ${archiveInfo.driveLink}`);
      lines.push(`📊 <b>Indeks DIP:</b> Tercatat otomatis di Google Sheets (${DIP_TAB})`);
    }
    if (ticketInfo) {
      lines.push(
        `🎫 <b>Tiket PPID #${ticketInfo.id}:</b> Status diperbarui ke <code>${ticketInfo.status.toUpperCase()}</code>`,
      );
    }

    return {
      success: true,
      archive: archiveInfo,
      ticket: ticketInfo,
      message: lines.join("\n"),
    };
  } catch (err: any) {
    console.error("[PpidAutoFileTool] Error:", err);
    return {
      success: false,
      error: err?.message || "Gagal memproses pengarsipan dan sinkronisasi tiket PPID.",
    };
  }
}
