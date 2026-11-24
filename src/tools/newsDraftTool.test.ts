import test from "node:test";
import assert from "node:assert/strict";
import { generateNewsOnlyDocx } from "../services/docxGenerator.js";
import { executeCreateNewsDraft, formatNewsTelegramText } from "./newsDraftTool.js";

test("newsDraftTool: generateNewsOnlyDocx menghasilkan buffer .docx valid", async () => {
  const buf = await generateNewsOnlyDocx({
    headline: "Dinas CIKASDA Sulteng Gelar Rapat Koordinasi PPID",
    lead_paragraph:
      "CIKASDA NEWS – Dinas Cipta Karya dan Sumber Daya Air (CIKASDA) Provinsi Sulawesi Tengah menggelar rapat koordinasi PPID di Palu, Selasa (24/11/2026).",
    body_paragraphs: [
      "Rapat dihadiri oleh jajaran sekretariat dan tim PPID pelaksana untuk mengevaluasi keterbukaan informasi publik.",
    ],
    closing_paragraph:
      "Melalui kegiatan ini, Dinas CIKASDA berkomitmen terus meningkatkan kualitas layanan informasi publik.",
  });

  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 1000);
  // Signature ZIP/DOCX ('PK')
  assert.equal(buf[0], 0x50);
  assert.equal(buf[1], 0x4b);
});

test("newsDraftTool: executeCreateNewsDraft menyusun berita, unggah ke Drive, dan kirim Telegram", async () => {
  let sentMsg = "";
  let sentFileName = "";
  let uploadedName = "";

  const res = await executeCreateNewsDraft(
    {
      raw_notes: "Rapat koordinasi PPID di Aula CIKASDA, dihadiri Kabid dan staf PPID.",
      chat_id: "telegram:2100878150",
    },
    {
      synthesizeFn: async () => ({
        headline: "Dinas CIKASDA Sulteng Gelar Rapat Koordinasi PPID",
        lead_paragraph:
          "CIKASDA NEWS – Dinas Cipta Karya dan Sumber Daya Air (CIKASDA) Provinsi Sulawesi Tengah menggelar rapat koordinasi PPID di Aula CIKASDA, Palu.",
        body_paragraphs: [
          "Rapat ini membahas peningkatan standar layanan informasi publik di lingkungan perangkat daerah.",
        ],
        closing_paragraph:
          "Melalui kegiatan ini, Dinas CIKASDA berkomitmen menjaga keterbukaan informasi yang cepat dan akuntabel.",
      }),
      uploadDriveFn: async (fileName, fileStream) => {
        if (fileStream && typeof fileStream.destroy === "function") {
          await new Promise<void>((resolve) => {
            fileStream.on("error", () => resolve());
            fileStream.on("close", () => resolve());
            fileStream.destroy();
          });
        }
        uploadedName = fileName;
        return { id: "drive-123", webViewLink: "https://drive.google.com/file/d/drive-123/view" };
      },
      sendTelegramFn: async (_chatId, htmlText, _docPath, fileName) => {
        sentMsg = htmlText;
        sentFileName = fileName;
      },
      logActivityFn: async () => {},
    },
  );

  assert.equal(res.success, true);
  assert.ok(uploadedName.startsWith("CIKASDA_NEWS_"));
  assert.equal(sentFileName, uploadedName);
  assert.match(sentMsg, /DRAF BERITA CIKASDA NEWS/);
  assert.match(sentMsg, /https:\/\/drive\.google\.com\/file\/d\/drive-123\/view/);
});

test("newsDraftTool: formatNewsTelegramText menyertakan link Drive", () => {
  const text = formatNewsTelegramText(
    {
      headline: "Judul Uji",
      lead_paragraph: "CIKASDA NEWS – Lead uji.",
      body_paragraphs: ["Isi uji."],
      closing_paragraph: "Penutup uji.",
    },
    "https://drive.google.com/file/d/abc/view",
  );
  assert.match(text, /Judul Uji/);
  assert.match(text, /https:\/\/drive\.google\.com\/file\/d\/abc\/view/);
});
