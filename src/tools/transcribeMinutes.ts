import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import Groq from "groq-sdk";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { env } from "../config/env.js";
import { shouldChunk, splitIntoChunks, cleanupChunks } from "../audio/chunker.js";
import { uploadFile, downloadFile } from "../services/driveClient.js";
import { logActivity } from "../services/auditLog.js";
import { minutesSynthesisPrompt } from "../prompts/minutesSynthesis.js";
import { generateMinutesDocx } from "../services/docxGenerator.js";

const groq = new Groq({ apiKey: env.GROQ_API_KEY });
const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

/**
 * Interface untuk struktur Notulen (sesuai Gemini JSON Mode)
 */
export interface MinutesData {
  title: string;
  agenda_points: string[];
  decisions: string[];
  action_items: string[];
}

/**
 * Input parameter untuk executeTranscribeMinutes
 */
export interface TranscribeParams {
  audioFilePath?: string;   // Path lokal (dari Telegram upload)
  driveLink?: string;       // Link Google Drive
  chatId: string;
}

/**
 * Extract file ID dari berbagai format link Google Drive:
 * - https://drive.google.com/file/d/FILE_ID/view
 * - https://drive.google.com/open?id=FILE_ID
 * - https://docs.google.com/.../.../d/FILE_ID/...
 */
function extractDriveFileId(link: string): string | null {
  // Format: /file/d/FILE_ID/
  const match1 = link.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match1) return match1[1];

  // Format: /d/FILE_ID/
  const match2 = link.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match2) return match2[1];

  // Format: ?id=FILE_ID
  const match3 = link.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match3) return match3[1];

  return null;
}

/**
 * Eksekusi transkripsi dan pembuatan notulen (Mode 2)
 * Mendukung dua sumber audio:
 * 1. File lokal (dari Telegram upload) → audioFilePath
 * 2. Link Google Drive → driveLink (untuk file besar / rapat panjang)
 */
export async function executeTranscribeMinutes(params: TranscribeParams) {
  const { audioFilePath, driveLink, chatId } = params;
  let chunkPaths: string[] = [];
  let fullTranscript = "";
  let localAudioPath = audioFilePath || "";
  let downloadedFromDrive = false;
  
  try {
    // === STEP 0: Resolve audio source ===
    if (!localAudioPath && !driveLink) {
      throw new Error("Harus menyediakan file audio (path lokal atau link Google Drive).");
    }

    // Jika user memberikan link Google Drive, download dulu ke lokal
    if (driveLink && !localAudioPath) {
      console.log(`[TranscribeMinutes] Menerima link Google Drive: ${driveLink}`);
      
      const fileId = extractDriveFileId(driveLink);
      if (!fileId) {
        throw new Error("Format link Google Drive tidak dikenali. Gunakan format: https://drive.google.com/file/d/FILE_ID/view");
      }

      // Buat path sementara untuk menyimpan file audio
      const tempId = crypto.randomUUID();
      localAudioPath = path.join(os.tmpdir(), `${tempId}_drive_audio`);
      
      console.log(`[TranscribeMinutes] Mengunduh audio dari Drive (ID: ${fileId})...`);
      await downloadFile(fileId, localAudioPath);
      downloadedFromDrive = true;
      
      console.log(`[TranscribeMinutes] Audio berhasil diunduh (${(fs.statSync(localAudioPath).size / (1024 * 1024)).toFixed(1)} MB)`);
    }

    // === STEP 1: Cek apakah perlu di-chunk ===
    const needsChunking = shouldChunk(localAudioPath);
    
    if (needsChunking) {
      console.log("[TranscribeMinutes] File terlalu besar. Memulai proses chunking...");
      chunkPaths = await splitIntoChunks(localAudioPath, 20, os.tmpdir());
      
      console.log(`[TranscribeMinutes] Terdapat ${chunkPaths.length} chunk untuk ditranskripsi.`);
      
      for (let i = 0; i < chunkPaths.length; i++) {
        console.log(`[TranscribeMinutes] Mentranskripsi chunk ${i + 1}/${chunkPaths.length}...`);
        const transcription = await groq.audio.transcriptions.create({
          file: fs.createReadStream(chunkPaths[i]),
          model: "whisper-large-v3-turbo",
          language: "id"
        });
        fullTranscript += transcription.text + " ";
      }
    } else {
      console.log("[TranscribeMinutes] Ukuran aman, mentranskripsi file secara langsung...");
      const transcription = await groq.audio.transcriptions.create({
        file: fs.createReadStream(localAudioPath),
        model: "whisper-large-v3-turbo",
        language: "id"
      });
      fullTranscript = transcription.text;
    }
    
    if (!fullTranscript.trim()) {
      throw new Error("Transkripsi kosong. Audio mungkin tidak bersuara.");
    }

    console.log("[TranscribeMinutes] Transkripsi selesai. Meminta Gemini merangkum notulen...");

    // === STEP 2: Kirim transkrip ke Gemini ===
    const geminiModel = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: minutesSynthesisPrompt,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            title: { type: SchemaType.STRING },
            agenda_points: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
            decisions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
            action_items: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
          },
          required: ["title", "agenda_points", "decisions", "action_items"]
        }
      }
    });

    const geminiResult = await geminiModel.generateContent(`Transkrip Rapat:\n\n${fullTranscript}`);
    const minutesData: MinutesData = JSON.parse(geminiResult.response.text());

    // === STEP 3: Generate dokumen Word (.docx) yang rapi ===
    console.log("[TranscribeMinutes] Membuat dokumen Word (.docx)...");
    const docxBuffer = await generateMinutesDocx(minutesData);

    const safeTitle = minutesData.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const dateStr = new Date().toISOString().split("T")[0];
    const fileName = `Notulen_${safeTitle}_${dateStr}.docx`;
    
    // Simpan sementara ke disk untuk dikirim
    const tempDocxPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.docx`);
    fs.writeFileSync(tempDocxPath, docxBuffer);

    // === STEP 3a: Upload ke Google Drive ===
    console.log("[TranscribeMinutes] Mengunggah dokumen ke Google Drive...");
    const driveResult = await uploadFile(
      fileName,
      fs.createReadStream(tempDocxPath) as any,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      env.DRIVE_MINUTES_FOLDER_ID
    );

    // === STEP 3b: Kirim langsung ke chat Telegram ===
    console.log("[TranscribeMinutes] Mengirim dokumen ke Telegram...");
    try {
      const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`;
      const fileBuffer = fs.readFileSync(tempDocxPath);
      const blob = new Blob([fileBuffer]);
      
      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append("document", blob, fileName);
      formData.append("caption", `📋 Notulen Rapat: ${minutesData.title}\n\n📁 Backup tersimpan di Google Drive.`);
      
      await fetch(url, { method: "POST", body: formData as any });
    } catch (telegramErr: any) {
      console.error("[TranscribeMinutes] Gagal kirim ke Telegram, tapi dokumen tetap ada di Drive:", telegramErr.message);
    }

    // Hapus file temp docx
    if (fs.existsSync(tempDocxPath)) fs.unlinkSync(tempDocxPath);

    // === STEP 4: Logging Audit ===
    await logActivity({
      timestamp: new Date().toISOString(),
      chat_id: chatId.toString(),
      staff_name: "Staff", 
      mode: "minutes",
      query_or_filename: fileName,
      result_document: driveResult.webViewLink,
      status: "success"
    });

    return {
      success: true,
      data: minutesData,
      driveLink: driveResult.webViewLink,
      message: `Notulen "${minutesData.title}" berhasil dibuat dan dikirim sebagai dokumen Word (.docx).`
    };
    
  } catch (error: any) {
    console.error("[TranscribeMinutes] Error:", error);
    
    await logActivity({
      timestamp: new Date().toISOString(),
      chat_id: chatId.toString(),
      staff_name: "Staff", 
      mode: "minutes",
      query_or_filename: driveLink || path.basename(localAudioPath || "unknown"),
      result_document: "-",
      status: "error"
    });

    return {
      success: false,
      error: error.message || "Gagal memproses notulen rapat."
    };
    
  } finally {
    // === STEP 5: Cleanup ===
    console.log("[TranscribeMinutes] Membersihkan file sementara...");
    cleanupChunks(chunkPaths);
    
    // Hapus file yang didownload dari Drive
    if (downloadedFromDrive && localAudioPath && fs.existsSync(localAudioPath)) {
      try {
        fs.unlinkSync(localAudioPath);
      } catch (err: any) {
        console.error(`[TranscribeMinutes] Gagal menghapus file Drive temp:`, err.message);
      }
    }

    // Hapus file upload asli dari Telegram
    if (!downloadedFromDrive && localAudioPath && fs.existsSync(localAudioPath)) {
      try {
        fs.unlinkSync(localAudioPath);
      } catch (err: any) {
        console.error(`[TranscribeMinutes] Gagal menghapus file asli ${localAudioPath}:`, err.message);
      }
    }
  }
}
