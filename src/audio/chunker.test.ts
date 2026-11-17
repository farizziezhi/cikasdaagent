import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { getDurationSeconds, splitIntoChunks, cleanupChunks, shouldChunk } from "./chunker.js";

const TEMP_DIR = os.tmpdir();
const TEST_AUDIO_PATH = path.join(TEMP_DIR, "test_audio_180s.wav");
const CHUNK_OUTPUT_DIR = path.join(TEMP_DIR, "ppid_test_chunks");

/**
 * Buat file audio WAV hening (silent PCM) murni di Node.js tanpa ffmpeg lavfi.
 * Ini memastikan test dapat berjalan di semua OS/environment (termasuk Oracle Micro
 * di mana ffmpeg-static tidak memiliki input format lavfi).
 */
function createSilentWavFile(filePath: string, durationSeconds: number): void {
  const sampleRate = 8000;
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = durationSeconds * byteRate;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  // fmt subchunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  fs.writeFileSync(filePath, buffer);
}

test("Audio Chunker Module", async (t) => {
  // Setup: Generate 3-minute silent WAV audio file directly in Node
  await t.test("setup - generate silent audio", async () => {
    console.log("Generating 3-minute silent audio for testing...");
    createSilentWavFile(TEST_AUDIO_PATH, 180);
    assert.strictEqual(fs.existsSync(TEST_AUDIO_PATH), true);
  });

  await t.test("getDurationSeconds - should return around 180 seconds", async () => {
    const duration = await getDurationSeconds(TEST_AUDIO_PATH);
    assert.ok(duration >= 179 && duration <= 181, `Duration ${duration} is not around 180s`);
  });

  await t.test("shouldChunk - check file size limit", () => {
    // 3 menit audio silent 8kHz 16-bit ukurannya ~2.8MB (<25MB),
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
