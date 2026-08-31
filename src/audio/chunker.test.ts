import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { getDurationSeconds, splitIntoChunks, cleanupChunks, shouldChunk } from "./chunker.js";

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);
}

const TEMP_DIR = os.tmpdir();
const TEST_AUDIO_PATH = path.join(TEMP_DIR, "test_audio_180s.ogg");
const CHUNK_OUTPUT_DIR = path.join(TEMP_DIR, "ppid_test_chunks");

test("Audio Chunker Module", async (t) => {
  // Setup: Generate 3-minute silent audio file
  await t.test("setup - generate silent audio", async () => {
    await new Promise<void>((resolve, reject) => {
      console.log("Generating 3-minute silent audio for testing...");
      ffmpeg()
        .input("anullsrc=r=16000:cl=mono")
        .inputFormat("lavfi")
        .duration(180) // 180 seconds = 3 minutes
        .audioChannels(1)
        .audioFrequency(16000)
        .format("ogg")
        .output(TEST_AUDIO_PATH)
        .on("end", () => resolve())
        .on("error", (err) => reject(new Error(`Gagal membuat file test: ${err.message}`)))
        .run();
    });
    assert.strictEqual(fs.existsSync(TEST_AUDIO_PATH), true);
  });

  await t.test("getDurationSeconds - should return around 180 seconds", async () => {
    const duration = await getDurationSeconds(TEST_AUDIO_PATH);
    // FFmpeg duration might be slightly off due to encoding, so we check if it's close to 180
    assert.ok(duration >= 179 && duration <= 181, `Duration ${duration} is not around 180s`);
  });

  await t.test("shouldChunk - check file size limit", () => {
    // 3 menit audio silent ukurannya sangat kecil (<1MB),
    // jadi pastikan return false.
    const needsChunk = shouldChunk(TEST_AUDIO_PATH);
    assert.strictEqual(needsChunk, false);
  });

  let chunkPaths: string[] = [];

  await t.test("splitIntoChunks - should split 3-minute audio into 3 chunks of 1-minute each", async () => {
    // 1 menit = 60 detik
    chunkPaths = await splitIntoChunks(TEST_AUDIO_PATH, 1, CHUNK_OUTPUT_DIR);

    assert.strictEqual(chunkPaths.length, 3, "Harus menghasilkan tepat 3 chunk");

    // Verifikasi durasi masing-masing chunk
    for (const chunkPath of chunkPaths) {
      assert.strictEqual(fs.existsSync(chunkPath), true, "File chunk harus ada");
      const duration = await getDurationSeconds(chunkPath);
      assert.ok(duration >= 59 && duration <= 61, `Chunk duration ${duration} is not around 60s`);
    }
  });

  await t.test("cleanupChunks - should delete all chunk files", () => {
    cleanupChunks(chunkPaths);
    
    for (const chunkPath of chunkPaths) {
      assert.strictEqual(fs.existsSync(chunkPath), false, "File chunk seharusnya sudah terhapus");
    }
  });

  // Teardown: Hapus file audio asli dan direktori test
  await t.test("teardown - remove test artifacts", () => {
    if (fs.existsSync(TEST_AUDIO_PATH)) {
      fs.unlinkSync(TEST_AUDIO_PATH);
    }
    if (fs.existsSync(CHUNK_OUTPUT_DIR)) {
      fs.rmSync(CHUNK_OUTPUT_DIR, { recursive: true, force: true });
    }
  });
});
