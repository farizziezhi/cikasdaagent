import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { env } from "../config/env.js";
import { getGoogleAccessToken } from "./googleAuth.js";
import { downloadFile } from "./driveClient.js";
import { detectMediaType } from "./multimodalExtractor.js";
import type { SendBroadcastOptions } from "./broadcast.js";

export interface DriveWatchedFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
}

export interface DriveWatcherCallbacks {
  sendBroadcast: (message: string, options?: SendBroadcastOptions) => Promise<void>;
}

export interface DriveWatcherDeps {
  folderId?: string;
  statePath?: string;
  listFilesFn?: (folderId: string) => Promise<DriveWatchedFile[]>;
  downloadFileFn?: (fileId: string, destPath: string) => Promise<void>;
  processNewsDraftFn?: (localPath: string, fileName: string) => Promise<{
    success: boolean;
    driveLink?: string;
    headline?: string;
    error?: string;
  }>;
  seedOnEmptyState?: boolean;
}

function defaultStatePath(): string {
  return (
    process.env.DRIVE_WATCHER_STATE_PATH ??
    path.join(process.cwd(), "data", "drive-watcher-processed.json")
  );
}

function loadProcessedIds(statePath: string): { ids: Set<string>; existed: boolean } {
  try {
    if (!fs.existsSync(statePath)) {
      return { ids: new Set(), existed: false };
    }
    const raw = fs.readFileSync(statePath, "utf-8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return { ids: new Set(), existed: true };
    return {
      ids: new Set(arr.filter((v): v is string => typeof v === "string")),
      existed: true,
    };
  } catch {
    return { ids: new Set(), existed: false };
  }
}

function saveProcessedIds(statePath: string, ids: Set<string>): void {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    // Simpan maks 500 ID terakhir agar file state tetap kecil
    const list = [...ids].slice(-500);
    fs.writeFileSync(statePath, JSON.stringify(list, null, 2));
  } catch (err) {
    console.error("[DriveWatcher] Gagal menyimpan state:", err);
  }
}

async function defaultListFolderFiles(folderId: string): Promise<DriveWatchedFile[]> {
  const token = await getGoogleAccessToken();
  const q = `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
  const params = new URLSearchParams({
    q,
    fields: "files(id, name, mimeType, webViewLink)",
    orderBy: "createdTime desc",
    pageSize: "10",
  });

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Drive list failed (${res.status})`);
  }

  const data = (await res.json()) as { files?: DriveWatchedFile[] };
  return data.files ?? [];
}

async function defaultProcessNewsDraft(localPath: string, fileName: string) {
  const mediaType = detectMediaType(localPath);
  const { executeCreateNewsDraft } = await import("../tools/newsDraftTool.js");

  const params: any = {
    chat_id: "", // notifikasi dikirim lewat sendBroadcast DriveWatcher agar tidak dobel
    raw_notes: `Bahan otomatis dari file Google Drive: ${fileName}`,
  };
  if (mediaType === "audio") params.audio_file_path = localPath;
  else if (mediaType === "pptx" || mediaType === "pdf") params.document_file_path = localPath;
  else if (mediaType === "image") params.image_file_path = localPath;

  const result = await executeCreateNewsDraft(params, {
    sendTelegramFn: async () => {}, // ditangani oleh DriveWatcher.sendBroadcast
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }
  return {
    success: true,
    driveLink: result.driveLink,
    headline: result.news_article?.headline,
  };
}

/**
 * Drive Folder Watcher:
 * Memantau folder Google Drive masuk (DRIVE_WATCH_FOLDER_ID) secara berkala.
 * Begitu ada file audio/PPTX/PDF/foto baru, otomatis menyusun draf berita CIKASDA NEWS (.docx)
 * ke folder tujuan (DRIVE_MINUTES_FOLDER_ID) dan mengirim tautan Google Docs ke Telegram.
 */
export class DriveWatcher {
  private callbacks: DriveWatcherCallbacks;
  private folderId: string;
  private statePath: string;
  private listFilesFn: (folderId: string) => Promise<DriveWatchedFile[]>;
  private downloadFileFn: (fileId: string, destPath: string) => Promise<void>;
  private processNewsDraftFn: NonNullable<DriveWatcherDeps["processNewsDraftFn"]>;
  private seedOnEmptyState: boolean;

  private processedIds: Set<string>;
  private stateExisted: boolean;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(callbacks: DriveWatcherCallbacks, deps: DriveWatcherDeps = {}) {
    this.callbacks = callbacks;
    this.folderId = (deps.folderId ?? env.DRIVE_WATCH_FOLDER_ID ?? "").trim();
    this.statePath = deps.statePath ?? defaultStatePath();
    this.listFilesFn = deps.listFilesFn ?? defaultListFolderFiles;
    this.downloadFileFn = deps.downloadFileFn ?? downloadFile;
    this.processNewsDraftFn = deps.processNewsDraftFn ?? defaultProcessNewsDraft;
    this.seedOnEmptyState = deps.seedOnEmptyState ?? true;

    const loaded = loadProcessedIds(this.statePath);
    this.processedIds = loaded.ids;
    this.stateExisted = loaded.existed;
  }

  public async pollOnce(): Promise<number> {
    if (!this.folderId || this.running) return 0;
    this.running = true;

    let processedCount = 0;
    try {
      const files = await this.listFilesFn(this.folderId);

      // Pada startup pertama kali, tandai file lama sebagai sudah dilihat agar tidak membanjiri Telegram
      if (!this.stateExisted && this.seedOnEmptyState) {
        for (const f of files) {
          this.processedIds.add(f.id);
        }
        this.stateExisted = true;
        saveProcessedIds(this.statePath, this.processedIds);
        console.log(`[DriveWatcher] Seeded ${files.length} file lama di folder pantauan.`);
        return 0;
      }

      for (const file of files) {
        if (this.processedIds.has(file.id)) continue;

        const mediaType = detectMediaType(file.name);
        if (mediaType === "unknown") {
          // Abaikan .docx hasil keluaran atau file tidak didukung
          this.processedIds.add(file.id);
          saveProcessedIds(this.statePath, this.processedIds);
          continue;
        }

        const ext = path.extname(file.name) || ".bin";
        const tempPath = path.join(os.tmpdir(), `${crypto.randomUUID()}${ext}`);

        try {
          console.log(`[DriveWatcher] File baru terdeteksi: ${file.name} (${mediaType})`);
          await this.downloadFileFn(file.id, tempPath);
          const result = await this.processNewsDraftFn(tempPath, file.name);

          this.processedIds.add(file.id);
          saveProcessedIds(this.statePath, this.processedIds);

          if (result.success && result.driveLink) {
            const msg = [
              `🤖 <b>AUTO-DRAF BERITA DARI GOOGLE DRIVE</b>`,
              `• <b>File Sumber :</b> ${file.name}`,
              `• <b>Judul Berita:</b> ${result.headline || "Draf CIKASDA NEWS"}`,
              `• <b>Status      :</b> Tersimpan di Google Drive (siap dibuka di Google Docs)`,
              "",
              `💡 <i>Silakan tinjau fakta draf berita sebelum ditayangkan di portal CIKASDA.</i>`,
            ].join("\n");

            await this.callbacks.sendBroadcast(msg, {
              replyMarkup: {
                inline_keyboard: [
                  [{ text: "📄 Buka Draf di Google Docs", url: result.driveLink }],
                ],
              },
            });
            processedCount++;
          }
        } catch (fileErr) {
          console.error(`[DriveWatcher] Gagal memproses ${file.name}:`, fileErr);
        } finally {
          if (fs.existsSync(tempPath)) {
            try {
              fs.unlinkSync(tempPath);
            } catch {
              // abaikan
            }
          }
        }
      }
    } catch (err) {
      console.error("[DriveWatcher] Gagal memeriksa folder Drive:", err);
    } finally {
      this.running = false;
    }

    return processedCount;
  }

  public start(intervalMs: number = 300_000): void {
    if (!this.folderId) {
      console.log("[DriveWatcher] DRIVE_WATCH_FOLDER_ID belum diisi — folder watcher dilewati.");
      return;
    }
    if (this.timer) return;

    // Jalankan seed/poll awal
    this.pollOnce().catch((err) => console.error("[DriveWatcher] Initial poll error:", err));

    this.timer = setInterval(() => {
      this.pollOnce().catch((err) => console.error("[DriveWatcher] Poll error:", err));
    }, intervalMs);
    this.timer.unref();
    console.log(`[DriveWatcher] Aktif memantau folder Drive tiap ${Math.round(intervalMs / 1000)} detik.`);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
