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
import { getMinutesSynthesisPrompt } from "../prompts/minutesSynthesis.js";
import {
  generateMinutesDocx,
  ModernMinutesData,
  NewsArticleData,
  MeetingSynthesisResult
} from "../services/docxGenerator.js";
import { applyGlossaryCorrections } from "../services/learnedMemory.js";
import {
  extractTextFromPptx,
  preparePdfPart,
  prepareImagePart,
  detectMediaType
} from "../services/multimodalExtractor.js";

const groq = new Groq({ apiKey: env.GROQ_API_KEY });
const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

/**
 * Parameter input multimodal untuk Notulensi Rapat & Berita Acara
 */
export interface TranscribeParams {
  audioFilePath?: string;      // Audio / Voice note lokal
  driveLink?: string;          // Link Google Drive (Audio rapat panjang)
  documentFilePath?: string;   // Slide presentasi (PPTX / PDF)
  imageFilePath?: string;      // Foto slide / foto papan tulis rapat
  meetingNotesText?: string;   // Coretan catatan kasar dari staf
  chatId: string;
}

/**
 * Ekstrak ID file Google Drive dari berbagai format URL
 */
function extractDriveFileId(link: string): string | null {
  const match1 = link.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match1) return match1[1];
  const match2 = link.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match2) return match2[1];
  const match3 = link.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match3) return match3[1];
  return null;
}

/**
 * Format pesan Notulen Rapat untuk Telegram
 */
function formatMinutesTelegram(data: ModernMinutesData): string {
  const lines: string[] = [
    `📋 <b>NOTULEN & CATATAN RAPAT</b>`,
    `<b>${data.title}</b>`,
    `<i>📅 Waktu: ${data.date_info || "Sesuai Jadwal"}</i>\n`
  ];

  if (data.executive_summary) {
    lines.push(`📌 <b>Ringkasan Eksekutif:</b>\n${data.executive_summary}\n`);
  }

  if (data.key_points && data.key_points.length > 0) {
    lines.push(`💡 <b>Poin-Poin Penting Pembahasan:</b>`);
    data.key_points.forEach(p => lines.push(`• ${p}`));
    lines.push("");
  }

  if (data.decisions && data.decisions.length > 0) {
    lines.push(`✅ <b>Kesepakatan & Keputusan:</b>`);
    data.decisions.forEach((d, i) => lines.push(`<b>${i + 1}.</b> ${d}`));
    lines.push("");
  }

  if (data.action_items && data.action_items.length > 0) {
    lines.push(`🎯 <b>Tindak Lanjut (Action Items):</b>`);
    data.action_items.forEach(item => {
      if (typeof item === "string") {
        lines.push(`▫️ ${item}`);
      } else {
        const pic = item.pic ? ` [PIC: <b>${item.pic}</b>]` : "";
        const deadline = item.deadline ? ` (Target: ${item.deadline})` : "";
        lines.push(`▫️ ${item.task}${pic}${deadline}`);
      }
    });
  }

  return lines.join("\n");
}

/**
 * Format pesan Berita Acara / CIKASDA NEWS untuk Telegram
 */
function formatNewsTelegram(news: NewsArticleData): string {
  const lines: string[] = [
    `📰 <b>CIKASDA NEWS — BERITA ACARA KEGIATAN</b>`,
    `<b>${news.headline}</b>\n`,
    `${news.lead_paragraph}\n`
  ];

  news.body_paragraphs.forEach(p => {
    lines.push(`${p}\n`);
  });

  lines.push(`<i>${news.closing_paragraph}</i>`);
  return lines.join("\n");
}

/**
 * Kirim pesan teks ke Telegram
 */
async function sendTelegramText(chatId: string, htmlText: string): Promise<void> {
  const msgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(msgUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: htmlText,
      parse_mode: "HTML"
    })
  });
}

/**
 * Eksekusi sintesis multimodal (Notulen Rapat + Berita Acara CIKASDA NEWS)
 */
export async function executeTranscribeMinutes(params: TranscribeParams) {
  const {
    audioFilePath,
    driveLink,
    documentFilePath,
    imageFilePath,
    meetingNotesText,
    chatId
  } = params;

  let chunkPaths: string[] = [];
  let localAudioPath = audioFilePath || "";
  let downloadedFromDrive = false;
  const tempFilesToClean: string[] = [];

  try {
    // 1. Validasi minimal satu sumber materi rapat tersedia
    if (!localAudioPath && !driveLink && !documentFilePath && !imageFilePath && !meetingNotesText) {
      throw new Error(
        "Harus menyertakan minimal salah satu materi rapat: Voice note/audio, link Google Drive, file PPTX/PDF materi, foto slide/papan tulis, atau catatan teks."
      );
    }

    const contextParts: string[] = [];
    const geminiInlineParts: any[] = [];

    // === SUMBER 1: AUDIO / VOICE NOTE ===
    if (driveLink && !localAudioPath) {
      console.log(`[TranscribeMinutes] Mengunduh audio dari Drive: ${driveLink}`);
      const fileId = extractDriveFileId(driveLink);
      if (!fileId) {
        throw new Error("Format link Google Drive tidak valid. Gunakan format file Drive biasa.");
      }
      localAudioPath = path.join(os.tmpdir(), `${crypto.randomUUID()}_drive_audio`);
      await downloadFile(fileId, localAudioPath);
      downloadedFromDrive = true;
    }

    if (localAudioPath && fs.existsSync(localAudioPath)) {
      console.log("[TranscribeMinutes] Memproses audio rapat dengan Groq Whisper...");
      let rawTranscript = "";
      const needsChunking = shouldChunk(localAudioPath);

      if (needsChunking) {
        console.log("[TranscribeMinutes] File audio besar, membagi chunk...");
        chunkPaths = await splitIntoChunks(localAudioPath, 20, os.tmpdir());
        for (let i = 0; i < chunkPaths.length; i++) {
          const res = await groq.audio.transcriptions.create({
            file: fs.createReadStream(chunkPaths[i]),
            model: "whisper-large-v3-turbo",
            language: "id"
          });
          rawTranscript += res.text + " ";
        }
      } else {
        const res = await groq.audio.transcriptions.create({
          file: fs.createReadStream(localAudioPath),
          model: "whisper-large-v3-turbo",
          language: "id"
        });
        rawTranscript = res.text;
      }

      // Bersihkan dan koreksi istilah berdasarkan memori dinas CIKASDA
      const cleanTranscript = applyGlossaryCorrections(rawTranscript);
      contextParts.push(`### Transkripsi Rekaman Suara Rapat:\n${cleanTranscript}`);
    }

    // === SUMBER 2: DOKUMEN PRESENTASI (PPTX / PDF) ===
    if (documentFilePath && fs.existsSync(documentFilePath)) {
      const mediaType = detectMediaType(documentFilePath);
      console.log(`[TranscribeMinutes] Memproses dokumen pendukung: ${documentFilePath} (${mediaType})`);

      if (mediaType === "pptx") {
        const pptxText = await extractTextFromPptx(documentFilePath);
        contextParts.push(`### Isi Materi Slide Presentasi (PowerPoint):\n${pptxText}`);
      } else if (mediaType === "pdf") {
        const pdfPart = preparePdfPart(documentFilePath);
        geminiInlineParts.push(pdfPart.inlineData);
        contextParts.push(`(File PDF materi presentasi terlampir dalam input visual)`);
      }
    }

    // === SUMBER 3: FOTO GAMBAR (PAPAN TULIS / SLIDE PROYEKTOR) ===
    if (imageFilePath && fs.existsSync(imageFilePath)) {
      console.log(`[TranscribeMinutes] Memproses gambar papan tulis/slide rapat: ${imageFilePath}`);
      const imgPart = prepareImagePart(imageFilePath);
      geminiInlineParts.push(imgPart.inlineData);
      contextParts.push(`(Foto papan tulis / slide proyektor terlampir dalam input visual)`);
    }

    // === SUMBER 4: CATATAN KASAR TEKS STAF ===
    if (meetingNotesText && meetingNotesText.trim()) {
      contextParts.push(`### Catatan Tambahan dari Staf Rapat:\n${meetingNotesText.trim()}`);
    }

    const combinedTextPrompt = contextParts.join("\n\n---\n\n");
    if (!combinedTextPrompt.trim() && geminiInlineParts.length === 0) {
      throw new Error("Tidak ada materi rapat yang dapat diproses.");
    }

    console.log("[TranscribeMinutes] Mengirim materi multimodal ke Gemini (Dual Synthesis)...");

    // 2. Kirim ke Gemini dengan System Prompt terintegrasi Memori Dinas
    const systemPrompt = getMinutesSynthesisPrompt();
    const geminiModel = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: systemPrompt,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            minutes: {
              type: SchemaType.OBJECT,
              properties: {
                title: { type: SchemaType.STRING },
                date_info: { type: SchemaType.STRING },
                executive_summary: { type: SchemaType.STRING },
                key_points: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                decisions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                action_items: {
                  type: SchemaType.ARRAY,
                  items: {
                    type: SchemaType.OBJECT,
                    properties: {
                      task: { type: SchemaType.STRING },
                      pic: { type: SchemaType.STRING },
                      deadline: { type: SchemaType.STRING }
                    },
                    required: ["task", "pic", "deadline"]
                  }
                }
              },
              required: ["title", "key_points", "decisions", "action_items"]
            },
            news_article: {
              type: SchemaType.OBJECT,
              properties: {
                headline: { type: SchemaType.STRING },
                lead_paragraph: { type: SchemaType.STRING },
                body_paragraphs: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                closing_paragraph: { type: SchemaType.STRING }
              },
              required: ["headline", "lead_paragraph", "body_paragraphs", "closing_paragraph"]
            }
          },
          required: ["minutes", "news_article"]
        }
      }
    });

    const contentInput: any[] = [];
    if (geminiInlineParts.length > 0) {
      geminiInlineParts.forEach(part => contentInput.push({ inlineData: part }));
    }
    contentInput.push(`Berikut adalah materi kegiatan/rapat untuk disintesis:\n\n${combinedTextPrompt}`);

    const geminiResult = await geminiModel.generateContent(contentInput);
    const parsed = JSON.parse(geminiResult.response.text());

    // Normalisasi struktur output
    const synthesisResult: MeetingSynthesisResult = {
      minutes: parsed.minutes || parsed,
      news_article: parsed.news_article
    };

    // 3. Generate Dokumen Word (.docx) Berisi Notulen + Berita Acara CIKASDA NEWS
    console.log("[TranscribeMinutes] Membuat dokumen Word (.docx) lengkap (Notulen + CIKASDA NEWS)...");
    const docxBuffer = await generateMinutesDocx(synthesisResult);

    const safeTitle = synthesisResult.minutes.title.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const dateStr = new Date().toISOString().split("T")[0];
    const fileName = `Notulen_dan_Berita_${safeTitle}_${dateStr}.docx`;

    const tempDocxPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.docx`);
    fs.writeFileSync(tempDocxPath, docxBuffer);
    tempFilesToClean.push(tempDocxPath);

    // 4. Upload ke Google Drive
    console.log("[TranscribeMinutes] Mengunggah dokumen ke Google Drive...");
    const driveResult = await uploadFile(
      fileName,
      fs.createReadStream(tempDocxPath) as any,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      env.DRIVE_MINUTES_FOLDER_ID
    );

    // 5. Kirim Hasil Langsung ke Chat Telegram
    console.log("[TranscribeMinutes] Mengirim notulen dan berita acara ke Telegram...");

    try {
      // 5a. Kirim Notulen Rapat
      const minutesMsg = formatMinutesTelegram(synthesisResult.minutes);
      await sendTelegramText(chatId, minutesMsg);

      // 5b. Kirim Berita Acara (CIKASDA NEWS) jika ada
      if (synthesisResult.news_article) {
        const newsMsg = formatNewsTelegram(synthesisResult.news_article);
        await sendTelegramText(chatId, newsMsg);
      }

      // 5c. Kirim File Dokumen .docx
      const docUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`;
      const fileBuffer = fs.readFileSync(tempDocxPath);
      const blob = new Blob([fileBuffer]);
      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append("document", blob, fileName);
      formData.append(
        "caption",
        `📄 <b>Dokumen Lengkap:</b> ${fileName}\n(Berisi Notulen Rapat & Naskah Berita Acara CIKASDA NEWS)`
      );

      await fetch(docUrl, { method: "POST", body: formData as any });
    } catch (telegramErr: any) {
      console.error("[TranscribeMinutes] Error kirim ke Telegram:", telegramErr.message);
    }

    // 6. Logging Audit
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
      data: synthesisResult,
      driveLink: driveResult.webViewLink,
      message: `Notulen & Berita Acara "${synthesisResult.minutes.title}" berhasil dibuat dan dikirim ke Telegram.`
    };

  } catch (error: any) {
    console.error("[TranscribeMinutes] Error:", error);

    await logActivity({
      timestamp: new Date().toISOString(),
      chat_id: chatId.toString(),
      staff_name: "Staff",
      mode: "minutes",
      query_or_filename: driveLink || path.basename(localAudioPath || "materi_rapat"),
      result_document: "-",
      status: "error"
    });

    return {
      success: false,
      error: error.message || "Gagal menyusun notulen dan berita acara rapat."
    };

  } finally {
    // 7. Cleanup
    cleanupChunks(chunkPaths);
    tempFilesToClean.forEach(f => {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch (_) {}
      }
    });

    if (downloadedFromDrive && localAudioPath && fs.existsSync(localAudioPath)) {
      try { fs.unlinkSync(localAudioPath); } catch (_) {}
    }
  }
}
