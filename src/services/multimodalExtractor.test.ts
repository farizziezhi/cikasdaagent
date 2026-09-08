import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";
import AdmZip from "adm-zip";
import {
  extractTextFromPptx,
  detectMediaType
} from "./multimodalExtractor.js";

test("Multimodal Extractor Service", async (t) => {
  await t.test("detectMediaType - recognizes audio, pptx, pdf, and image formats", () => {
    assert.strictEqual(detectMediaType("materi.pptx"), "pptx");
    assert.strictEqual(detectMediaType("laporan.pdf"), "pdf");
    assert.strictEqual(detectMediaType("foto_papan_tulis.jpg"), "image");
    assert.strictEqual(detectMediaType("slide.png"), "image");
    assert.strictEqual(detectMediaType("suara_rapat.mp3"), "audio");
    assert.strictEqual(detectMediaType("voicenote.ogg"), "audio");
    assert.strictEqual(detectMediaType("arsip.zip"), "unknown");
  });

  await t.test("extractTextFromPptx - parses slide XML text correctly", async () => {
    const tempPptx = path.join(os.tmpdir(), `test_presentation_${Date.now()}.pptx`);
    const zip = new AdmZip();

    // Buat mock slide XML seperti struktur PowerPoint asli
    const mockSlideXml1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld>
          <p:spTree>
            <p:sp>
              <p:txBody>
                <a:p><a:r><a:t>Rapat Koordinasi Irigasi CIKASDA</a:t></a:r></a:p>
                <a:p><a:r><a:t>Pembahasan Alokasi Anggaran DI Gumbasa</a:t></a:r></a:p>
              </p:txBody>
            </p:sp>
          </p:spTree>
        </p:cSld>
      </p:sld>`;

    zip.addFile("ppt/slides/slide1.xml", Buffer.from(mockSlideXml1, "utf-8"));
    zip.writeZip(tempPptx);

    try {
      const extracted = await extractTextFromPptx(tempPptx);
      assert.ok(extracted.includes("Rapat Koordinasi Irigasi CIKASDA"));
      assert.ok(extracted.includes("Pembahasan Alokasi Anggaran DI Gumbasa"));
      assert.ok(extracted.includes("[Slide 1]"));
    } finally {
      if (fs.existsSync(tempPptx)) fs.unlinkSync(tempPptx);
    }
  });
});
