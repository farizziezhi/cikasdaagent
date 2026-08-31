import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { env } from "../config/env.js";

// Setup path binary FFmpeg dan FFprobe secara eksplisit
// Ini memastikan fluent-ffmpeg menggunakan binary bawaan package, bukan yang ada di host OS.
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);
}
if (ffprobeStatic.path) {
  ffmpeg.setFfprobePath(ffprobeStatic.path as unknown as string);
}

/**
 * Mengecek apakah file audio perlu dipecah (di-chunk) berdasarkan ukuran maksimal yang diizinkan Groq.
 * @param filePath Path file audio
 * @returns boolean true jika ukuran file >= batas maksimal
 */
export function shouldChunk(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File tidak ditemukan: ${filePath}`);
  }
  const stats = fs.statSync(filePath);
  const sizeMb = stats.size / (1024 * 1024);
  const maxMb = Number(env.GROQ_MAX_UPLOAD_MB) || 25;
  
  return sizeMb >= maxMb;
}

/**
 * Mendapatkan durasi file audio dalam detik menggunakan ffprobe.
 * @param filePath Path file audio
 * @returns Promise berisi durasi dalam detik (number)
 */
export async function getDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        return reject(new Error(`Gagal membaca metadata audio: ${err.message}`));
      }
      const duration = metadata.format.duration;
      if (duration === undefined) {
        return reject(new Error("Durasi audio tidak diketahui."));
      }
      resolve(Number(duration));
    });
  });
}

/**
 * Memecah file audio menjadi beberapa segmen (chunk) secara sekuensial.
 * Dieksekusi satu-persatu untuk menghemat RAM/CPU (Penting untuk Render Free Tier).
 * Format output: OGG, 16kHz, Mono.
 *
 * @param filePath Path file audio asli
 * @param chunkMinutes Durasi per chunk dalam menit
 * @param outputDir Direktori untuk menyimpan file hasil pecahan
 * @returns Array path dari file chunk yang dihasilkan
 */
export async function splitIntoChunks(
  filePath: string,
  chunkMinutes: number,
  outputDir: string
): Promise<string[]> {
  
  const durationSeconds = await getDurationSeconds(filePath);
  const chunkSeconds = chunkMinutes * 60;
  const chunkPaths: string[] = [];
  
  const ext = path.extname(filePath) || ".ogg";
  const baseName = path.basename(filePath, ext);

  // Jika outputDir belum ada, buat direktorinya
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let currentTime = 0;
  let chunkIndex = 0;

  // Lakukan pemrosesan secara SEKUENSIAL (loop berurutan) menggunakan await
  while (currentTime < durationSeconds) {
    // Sisa waktu untuk segmen terakhir
    const remainingTime = durationSeconds - currentTime;
    const durationToProcess = remainingTime < chunkSeconds ? remainingTime : chunkSeconds;

    const chunkFileName = `${baseName}_chunk_${String(chunkIndex).padStart(3, "0")}.ogg`;
    const chunkPath = path.join(outputDir, chunkFileName);
    
    console.log(`[AudioChunker] Processing chunk ${chunkIndex} (Start: ${currentTime}s, Duration: ${durationToProcess}s)...`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(filePath)
        .setStartTime(currentTime)
        .setDuration(durationToProcess)
        .audioChannels(1) // Mono
        .audioFrequency(16000) // 16 kHz
        .format('ogg') // OGG Format (optimal dan didukung Groq)
        .output(chunkPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(`Gagal memproses chunk ${chunkIndex}: ${err.message}`)))
        .run();
    });

    chunkPaths.push(chunkPath);
    currentTime += chunkSeconds;
    chunkIndex++;
  }

  console.log(`[AudioChunker] Selesai memecah audio menjadi ${chunkPaths.length} segmen.`);
  return chunkPaths;
}

/**
 * Membersihkan file-file sementara (chunk) setelah berhasil dikirim ke Groq.
 * @param chunkPaths Array path file chunk
 */
export function cleanupChunks(chunkPaths: string[]): void {
  for (const chunkPath of chunkPaths) {
    if (fs.existsSync(chunkPath)) {
      try {
        fs.unlinkSync(chunkPath);
      } catch (err: any) {
        console.error(`[AudioChunker] Gagal menghapus file ${chunkPath}:`, err.message);
      }
    }
  }
}
