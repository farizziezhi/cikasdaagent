import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DriveWatcher } from "./driveWatcher.js";
import type { SendBroadcastOptions } from "./broadcast.js";

test("DriveWatcher: seed file lama pada run pertama, lalu proses file baru dan abaikan .docx", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drive-watch-"));
  const statePath = join(dir, "drive-watcher-processed.json");
  const broadcasts: Array<{ msg: string; opts?: SendBroadcastOptions }> = [];

  let mockFiles = [
    { id: "old-1", name: "rekaman_lama.mp3", mimeType: "audio/mpeg" },
  ];

  const watcher = new DriveWatcher(
    {
      sendBroadcast: async (msg, opts) => {
        broadcasts.push({ msg, opts });
      },
    },
    {
      folderId: "folder-watch-123",
      statePath,
      listFilesFn: async () => mockFiles,
      downloadFileFn: async (_id, dest) => {
        fs.writeFileSync(dest, Buffer.from("dummy-media"));
      },
      processNewsDraftFn: async (_localPath, fileName) => ({
        success: true,
        driveLink: "https://drive.google.com/file/d/doc-999/view",
        headline: `Berita Otomatis dari ${fileName}`,
      }),
    },
  );

  // Run 1: seed file lama -> 0 diproses, tidak spam Telegram
  const count1 = await watcher.pollOnce();
  assert.equal(count1, 0);
  assert.equal(broadcasts.length, 0);

  // Run 2: ada 1 file baru .pdf dan 1 file .docx (yang harus diabaikan)
  mockFiles = [
    { id: "new-pdf", name: "materi_rapat_eppra.pdf", mimeType: "application/pdf" },
    { id: "ignore-docx", name: "hasil_notulen.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { id: "old-1", name: "rekaman_lama.mp3", mimeType: "audio/mpeg" },
  ];

  const count2 = await watcher.pollOnce();
  assert.equal(count2, 1);
  assert.equal(broadcasts.length, 1);
  assert.match(broadcasts[0].msg, /AUTO-DRAF BERITA DARI GOOGLE DRIVE/);
  assert.match(broadcasts[0].msg, /materi_rapat_eppra\.pdf/);
  assert.equal(
    broadcasts[0].opts?.replyMarkup?.inline_keyboard[0][0].url,
    "https://drive.google.com/file/d/doc-999/view",
  );

  // Run 3: file yang sama tidak diproses ulang
  const count3 = await watcher.pollOnce();
  assert.equal(count3, 0);
  assert.equal(broadcasts.length, 1);
});
