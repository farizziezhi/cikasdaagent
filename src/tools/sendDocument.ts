import { env } from "../config/env.js";
import { getFileMetadata, downloadFile } from "../services/driveClient.js";
import { logActivity } from "../services/auditLog.js";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

/**
 * Tool: send_document — Mengirim file langsung atau via link
 * Ref: TDD §4.2
 */

/**
 * Mengirim pesan teks ke Telegram
 */
async function sendTelegramMessage(chatId: string, text: string) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text })
  });

  if (!response.ok) {
    throw new Error(`Telegram API Error: ${response.statusText}`);
  }
}

/**
 * Mengirim dokumen (file) ke Telegram
 */
async function sendTelegramDocument(chatId: string, filePath: string, fileName: string) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`;
  
  const buffer = fs.readFileSync(filePath);
  const blob = new Blob([buffer]);
  
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("document", blob, fileName);

  const response = await fetch(url, {
    method: "POST",
    body: formData as any
  });

  if (!response.ok) {
    throw new Error(`Telegram API Error: ${response.statusText}`);
  }
}

/**
 * Eksekutor untuk tool send_document
 */
export async function executeSendDocument(args: any) {
  const { file_id, chat_id } = args;
  
  if (!file_id || !chat_id) {
    return { error: "file_id dan chat_id wajib diisi." };
  }

  let metadata;
  try {
    metadata = await getFileMetadata(file_id);
  } catch (error) {
    console.error("[Tool] getFileMetadata error:", error);
    await logActivity({
      timestamp: new Date().toISOString(),
      chat_id: chat_id.toString(),
      staff_name: "Unknown", // Bisa dienhance dengan mengambil info user Telegram
      mode: "search",
      query_or_filename: `file_id: ${file_id}`,
      result_document: "-",
      status: "not_found"
    });
    return { error: "File tidak ditemukan atau akses ditolak." };
  }

  const maxMb = Number(env.MAX_DIRECT_SEND_MB) || 50;
  
  try {
    if (metadata.size_mb < maxMb) {
      // 1. Ukuran kecil: Download dan kirim langsung
      const tempId = crypto.randomUUID();
      // Pastikan ada ekstensi jika memungkinkan, atau aman tanpa ekstensi
      const ext = path.extname(metadata.name) || ".pdf"; 
      const tempPath = path.join(os.tmpdir(), `${tempId}${ext}`);
      
      console.log(`[Tool] Downloading ${metadata.name} to ${tempPath}`);
      await downloadFile(file_id, tempPath);
      
      console.log(`[Tool] Sending document to Telegram...`);
      await sendTelegramDocument(chat_id, tempPath, metadata.name);
      
      // Hapus file sementara secepatnya
      fs.unlinkSync(tempPath);
      console.log(`[Tool] Temp file deleted.`);
      
    } else {
      // 2. Ukuran besar: Kirim link webViewLink
      console.log(`[Tool] File too large (${metadata.size_mb} MB). Sending link instead.`);
      const text = `📁 *${metadata.name}*\n\nUkuran file (${metadata.size_mb} MB) melebihi batas pengiriman langsung (${maxMb} MB). Silakan unduh melalui tautan berikut:\n\n🔗 ${metadata.webViewLink}`;
      await sendTelegramMessage(chat_id, text);
    }

    // Logging aktivitas sukses
    await logActivity({
      timestamp: new Date().toISOString(),
      chat_id: chat_id.toString(),
      staff_name: "Staff", 
      mode: "search",
      query_or_filename: metadata.name,
      result_document: metadata.webViewLink,
      status: "success"
    });

    return { success: true, message: "Dokumen berhasil dikirim ke pengguna." };
  } catch (error: any) {
    console.error("[Tool] send_document error:", error);
    await logActivity({
      timestamp: new Date().toISOString(),
      chat_id: chat_id.toString(),
      staff_name: "Staff",
      mode: "search",
      query_or_filename: metadata.name,
      result_document: "-",
      status: "error"
    });
    return { error: error.message || "Gagal mengirim dokumen." };
  }
}

