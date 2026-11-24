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
import { getNewsOnlyPrompt } from "../prompts/minutesSynthesis.js";
import { generateNewsOnlyDocx, NewsArticleData } from "../services/docxGenerator.js";
import { applyGlossaryCorrections } from "../services/learnedMemory.js";
import {
  extractTextFromPptx,
  preparePdfPart,
  prepareImagePart,
  detectMediaType,
} from "../services/multimodalExtractor.js";
import { normalizeChatId } from "../services/broadcast.js";

export interface CreateNewsDraftParams {
  audio_file_path?: string;
  drive_link?: string;
  document_file_path?: string;
  image_file_path?: string;
  raw_notes?: string;
  headline?: string;
  lead_paragraph?: string;
  body_paragraphs?: string[];
  closing_paragraph?: string;
  chat_id: string;
}

export interface NewsDraftDeps {
  synthesizeFn?: (textPrompt: string, inlineParts: any[]) => Promise<NewsArticleData>;
  uploadDriveFn?: (
    fileName: string,
    fileStream: any,
    mimeType: string,
    folderId: string,
  ) => Promise<{ id: string; webViewLink: string }>;
  sendTelegramFn?: (chatId: string, htmlText: string, docPath: string, fileName: string) => Promise<void>;
  logActivityFn?: typeof logActivity;
}

function extractDriveFileId(link: string): string | null {
  const match1 = link.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match1) return match1[1];
  const match2 = link.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match2) return match2[1];
  const match3 = link.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match3) return match3[1];
  return null;
}

export function formatNewsTelegramText(news: NewsArticleData, driveLink?: string): string {
  const lines: string[] = [
    `📰 <b>DRAF BERITA CIKASDA NEWS</b>`,
    `<b>${news.headline}</b>`,
    "",
    news.lead_paragraph,
    "",
  ];

  for (const p of news.body_paragraphs || []) {
    if (p && p.trim()) {
      lines.push(p.trim());
      lines.push("");
    }
  }

  if (news.closing_paragraph && news.closing_paragraph.trim()) {
    lines.push(`<i>${news.closing_paragraph.trim()}</i>`);
  }

  if (driveLink) {
    lines.push("");
    lines.push(`🔗 <b>Buka di Google Drive / Docs:</b> ${driveLink}`);
  }

  lines.push("");
  lines.push(
    `💡 <i>Mohon Petugas Kehumasan memeriksa fakta (nama, gelar, tanggal, angka, dan tanda [PERLU DICEK]) sebelum ditayangkan di portal.</i>`,
  );

  return lines.join("\n");
}

async function defaultSynthesizeNews(
  combinedTextPrompt: string,
  geminiInlineParts: any[],
): Promise<NewsArticleData> {
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  const systemPrompt = getNewsOnlyPrompt();
  const generationConfig = {
    responseMimeType: "application/json",
    responseSchema: {
      type: SchemaType.OBJECT,
      properties: {
        news_article: {
          type: SchemaType.OBJECT,
          properties: {
            headline: { type: SchemaType.STRING },
            lead_paragraph: { type: SchemaType.STRING },
            body_paragraphs: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
            closing_paragraph: { type: SchemaType.STRING },
          },
          required: ["headline", "lead_paragraph", "body_paragraphs", "closing_paragraph"],
        },
      },
      required: ["news_article"],
    },
  } as const;

  const contentInput: any[] = [];
  if (geminiInlineParts.length > 0) {
    geminiInlineParts.forEach((part) => contentInput.push({ inlineData: part }));
  }
  contentInput.push(
    `Berikut adalah bahan mentah kegiatan untuk disusun menjadi draf berita CIKASDA NEWS:\n\n${combinedTextPrompt}`,
  );

  const modelCandidates = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];
  let geminiResult: any = null;
  let lastErr: any = null;

  for (const modelName of modelCandidates) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt,
        generationConfig: generationConfig as any,
      });
      geminiResult = await model.generateContent(contentInput);
      break;
    } catch (err: any) {
      lastErr = err;
      console.warn(`[NewsDraftTool] Model ${modelName} gagal (${err?.message || err}), mencoba fallback...`);
    }
  }

  if (!geminiResult) {
    throw lastErr || new Error("Gagal menyusun draf berita dengan model Gemini.");
  }

  const parsed = JSON.parse(geminiResult.response.text());
  return parsed.news_article || parsed;
}

async function defaultSendTelegram(
  chatId: string,
  htmlText: string,
  docPath: string,
  fileName: string,
): Promise<void> {
  const cleanChatId = normalizeChatId(chatId);
  const msgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(msgUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: cleanChatId,
      text: htmlText,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  const docUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`;
  const fileBuffer = fs.readFileSync(docPath);
  const blob = new Blob([fileBuffer]);
  const formData = new FormData();
  formData.append("chat_id", cleanChatId);
  formData.append("document", blob, fileName);
  formData.append(
    "caption",
    `📄 <b>Draf Berita CIKASDA NEWS:</b> ${fileName}\n(Siap dibuka di Google Docs / disalin ke WP Admin)`,
  );
  await fetch(docUrl, { method: "POST", body: formData as any });
}

/**
 * Eksekutor tool create_news_draft:
 * Menyusun draf berita CIKASDA NEWS (tanpa notulen), membuat file .docx,
 * mengunggah ke Google Drive (siap dibuka sebagai Google Docs), dan mengirim ke Telegram.
 */
export async function executeCreateNewsDraft(
  params: CreateNewsDraftParams,
  deps: NewsDraftDeps = {},
) {
  const {
    audio_file_path,
    drive_link,
    document_file_path,
    image_file_path,
    raw_notes,
    headline,
    lead_paragraph,
    body_paragraphs,
    closing_paragraph,
    chat_id,
  } = params;

  const synthesizeFn = deps.synthesizeFn ?? defaultSynthesizeNews;
  const uploadDriveFn = deps.uploadDriveFn ?? uploadFile;
  const sendTelegramFn = deps.sendTelegramFn ?? defaultSendTelegram;
  const logActivityFn = deps.logActivityFn ?? logActivity;

  let chunkPaths: string[] = [];
  let localAudioPath = audio_file_path || "";
  let downloadedFromDrive = false;
  const tempFilesToClean: string[] = [];

  try {
    let newsArticle: NewsArticleData;

    const hasDirectArticle =
      Boolean(headline?.trim()) &&
      Boolean(lead_paragraph?.trim()) &&
      Array.isArray(body_paragraphs) &&
      body_paragraphs.length > 0;

    if (hasDirectArticle) {
      newsArticle = {
        headline: headline!.trim(),
        lead_paragraph: lead_paragraph!.trim(),
        body_paragraphs: body_paragraphs!.map((p) => p.trim()).filter(Boolean),
        closing_paragraph: (closing_paragraph || "").trim(),
      };
    } else {
      if (
        !localAudioPath &&
        !drive_link &&
        !document_file_path &&
        !image_file_path &&
        !raw_notes
      ) {
        return {
          success: false,
          error:
            "Harus menyertakan minimal satu bahan berita: catatan teks, voice note/audio, link Drive, slide PPTX/PDF, atau foto kegiatan.",
        };
      }

      const contextParts: string[] = [];
      const geminiInlineParts: any[] = [];

      if (drive_link && !localAudioPath) {
        const fileId = extractDriveFileId(drive_link);
        if (!fileId) {
          throw new Error("Format link Google Drive tidak valid.");
        }
        localAudioPath = path.join(os.tmpdir(), `${crypto.randomUUID()}_news_audio`);
        await downloadFile(fileId, localAudioPath);
        downloadedFromDrive = true;
      }

      if (localAudioPath && fs.existsSync(localAudioPath)) {
        const groq = new Groq({ apiKey: env.GROQ_API_KEY });
        let rawTranscript = "";
        if (shouldChunk(localAudioPath)) {
          chunkPaths = await splitIntoChunks(localAudioPath, 20, os.tmpdir());
          for (const chunk of chunkPaths) {
            const res = await groq.audio.transcriptions.create({
              file: fs.createReadStream(chunk),
              model: "whisper-large-v3-turbo",
              language: "id",
            });
            rawTranscript += res.text + " ";
          }
        } else {
          const res = await groq.audio.transcriptions.create({
            file: fs.createReadStream(localAudioPath),
            model: "whisper-large-v3-turbo",
            language: "id",
          });
          rawTranscript = res.text;
        }
        contextParts.push(
          `### Transkripsi Rekaman Suara Kegiatan:\n${applyGlossaryCorrections(rawTranscript)}`,
        );
      }

      if (document_file_path && fs.existsSync(document_file_path)) {
        const mediaType = detectMediaType(document_file_path);
        if (mediaType === "pptx") {
          const pptxText = await extractTextFromPptx(document_file_path);
          contextParts.push(`### Isi Slide Presentasi:\n${pptxText}`);
        } else if (mediaType === "pdf") {
          geminiInlineParts.push(preparePdfPart(document_file_path).inlineData);
          contextParts.push(`(File PDF materi terlampir)`);
        }
      }

      if (image_file_path && fs.existsSync(image_file_path)) {
        geminiInlineParts.push(prepareImagePart(image_file_path).inlineData);
        contextParts.push(`(Foto kegiatan terlampir)`);
      }

      if (raw_notes && raw_notes.trim()) {
        contextParts.push(`### Catatan Bahan Berita dari Staf:\n${raw_notes.trim()}`);
      }

      const combinedTextPrompt = contextParts.join("\n\n---\n\n");
      newsArticle = await synthesizeFn(combinedTextPrompt, geminiInlineParts);
    }

    const docxBuffer = await generateNewsOnlyDocx(newsArticle);
    const safeTitle = newsArticle.headline.replace(/[^a-z0-9]/gi, "_").toLowerCase().slice(0, 60);
    const dateStr = new Date().toISOString().split("T")[0];
    const fileName = `CIKASDA_NEWS_${safeTitle}_${dateStr}.docx`;

    const tempDocxPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.docx`);
    fs.writeFileSync(tempDocxPath, docxBuffer);
    tempFilesToClean.push(tempDocxPath);

    const driveResult = await uploadDriveFn(
      fileName,
      fs.createReadStream(tempDocxPath),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      env.DRIVE_MINUTES_FOLDER_ID,
    );

    const telegramMsg = formatNewsTelegramText(newsArticle, driveResult.webViewLink);
    try {
      await sendTelegramFn(chat_id, telegramMsg, tempDocxPath, fileName);
    } catch (tgErr: any) {
      console.error("[NewsDraftTool] Error kirim ke Telegram:", tgErr?.message || tgErr);
    }

    await logActivityFn({
      timestamp: new Date().toISOString(),
      chat_id: normalizeChatId(chat_id),
      staff_name: "Staff",
      mode: "minutes",
      query_or_filename: fileName,
      result_document: driveResult.webViewLink,
      status: "success",
    });

    return {
      success: true,
      news_article: newsArticle,
      driveLink: driveResult.webViewLink,
      fileName,
      message: `Draf berita "${newsArticle.headline}" berhasil dibuat, disimpan ke Google Drive (${driveResult.webViewLink}), dan dikirim ke Telegram.`,
    };
  } catch (err: any) {
    console.error("[NewsDraftTool] Error:", err);
    return {
      success: false,
      error: err?.message || "Gagal menyusun draf berita CIKASDA NEWS.",
    };
  } finally {
    cleanupChunks(chunkPaths);
    for (const f of tempFilesToClean) {
      if (fs.existsSync(f)) {
        try {
          fs.unlinkSync(f);
        } catch {
          // abaikan error cleanup
        }
      }
    }
    if (downloadedFromDrive && localAudioPath && fs.existsSync(localAudioPath)) {
      try {
        fs.unlinkSync(localAudioPath);
      } catch {
        // abaikan error cleanup
      }
    }
  }
}
