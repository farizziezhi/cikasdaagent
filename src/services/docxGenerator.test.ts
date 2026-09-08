import test from "node:test";
import assert from "node:assert";
import {
  generateMinutesDocx,
  ModernMinutesData,
  MeetingSynthesisResult
} from "./docxGenerator.js";

test("DOCX Generator Service", async (t) => {
  await t.test("generateMinutesDocx - creates clean modern docx buffer for minutes alone", async () => {
    const sampleData: ModernMinutesData = {
      title: "Rapat Teknis Percepatan Irigasi",
      date_info: "Selasa, 8 September 2026",
      executive_summary: "Pembahasan kesiapan logistik dan alat berat.",
      key_points: [
        "Saluran primer mengalami sedimentasi 40 cm",
        "Dibutuhkan koordinasi lintas sektor dengan BWS"
      ],
      decisions: [
        "Pembersihan saluran dimulai pekan ini",
        "Sosialisasi ke kelompok tani dilakukan besok"
      ],
      action_items: [
        {
          task: "Pengangkutan alat berat",
          pic: "Pak Budi",
          deadline: "Rabu sore"
        },
        "Koordinasi surat izin masuk ke balai"
      ]
    };

    const buffer = await generateMinutesDocx(sampleData);
    assert.ok(buffer instanceof Buffer, "Should return a Buffer");
    assert.ok(buffer.length > 1000, "DOCX buffer should have valid size");

    // Pastikan magic header file DOCX (ZIP format: PK\x03\x04)
    assert.strictEqual(buffer[0], 0x50); // 'P'
    assert.strictEqual(buffer[1], 0x4B); // 'K'
  });

  await t.test("generateMinutesDocx - creates dual document (Notulen + CIKASDA NEWS)", async () => {
    const dualData: MeetingSynthesisResult = {
      minutes: {
        title: "Kunjungan Lapangan Huntap Talise",
        date_info: "Rabu, 2 September 2026",
        key_points: ["Pemanfaatan TPS3R", "Penyediaan fasilitas PSU"],
        decisions: ["Penguatan sinergi lintas balai"],
        action_items: [{ task: "Pemeriksaan sanitasi", pic: "Tim Teknis", deadline: "Segera" }]
      },
      news_article: {
        headline: "Kadis CIKASDA Dampingi Kunjungan ke Huntap Talise",
        lead_paragraph: "CIKASDA NEWS — Kepala Dinas CIKASDA Dr. Andi Ruly Djanggola, SE., M.Si mendampingi kunjungan ke Huntap Talise, Rabu (2/9/2026).",
        body_paragraphs: [
          "Kegiatan ini menjadi momentum untuk melihat fasilitas pendukung di kawasan hunian tetap.",
          "Kepala Dinas menegaskan pembangunan harus diikuti dengan infrastruktur dasar yang layak."
        ],
        closing_paragraph: "Melalui kunjungan ini diharapkan sinergi terus diperkuat bagi masyarakat terdampak."
      }
    };

    const buffer = await generateMinutesDocx(dualData);
    assert.ok(buffer instanceof Buffer);
    assert.ok(buffer.length > 2000, "Dual document should be larger with news article");
    assert.strictEqual(buffer[0], 0x50);
    assert.strictEqual(buffer[1], 0x4B);
  });
});
