import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  convertInchesToTwip,
} from "docx";
import { MinutesData } from "../tools/transcribeMinutes.js";

/**
 * Membuat dokumen Word (.docx) notulen rapat yang rapi dan profesional.
 * Format: Kop header PPID, judul rapat, agenda, keputusan, action items.
 *
 * @param data Struktur notulen dari Gemini
 * @returns Buffer dokumen .docx
 */
export async function generateMinutesDocx(data: MinutesData): Promise<Buffer> {
  const dateStr = new Date().toLocaleDateString("id-ID", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "Calibri",
            size: 24, // 12pt
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.25),
              right: convertInchesToTwip(1),
            },
          },
        },
        children: [
          // === KOP SURAT ===
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 0 },
            children: [
              new TextRun({
                text: "PEJABAT PENGELOLA INFORMASI DAN DOKUMENTASI",
                bold: true,
                size: 28, // 14pt
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 0 },
            children: [
              new TextRun({
                text: "KABUPATEN MOROWALI UTARA",
                bold: true,
                size: 28,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: "Kesekretariatan PPID",
                italics: true,
                size: 22,
                color: "666666",
              }),
            ],
          }),

          // Garis pemisah
          new Paragraph({
            border: {
              bottom: {
                color: "000000",
                space: 1,
                style: BorderStyle.SINGLE,
                size: 6,
              },
            },
            spacing: { after: 300 },
            children: [],
          }),

          // === JUDUL NOTULEN ===
          new Paragraph({
            alignment: AlignmentType.CENTER,
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 200, after: 100 },
            children: [
              new TextRun({
                text: "NOTULEN RAPAT",
                bold: true,
                size: 32, // 16pt
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
            children: [
              new TextRun({
                text: data.title,
                bold: true,
                size: 26, // 13pt
              }),
            ],
          }),

          // === TANGGAL ===
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({ text: "Tanggal: ", bold: true }),
              new TextRun({ text: dateStr }),
            ],
          }),

          // === GARIS TIPIS ===
          new Paragraph({
            border: {
              bottom: {
                color: "CCCCCC",
                space: 1,
                style: BorderStyle.SINGLE,
                size: 2,
              },
            },
            spacing: { after: 200 },
            children: [],
          }),

          // === AGENDA ===
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 },
            children: [
              new TextRun({
                text: "I. AGENDA RAPAT",
                bold: true,
                size: 26,
              }),
            ],
          }),
          ...data.agenda_points.map(
            (point, i) =>
              new Paragraph({
                spacing: { after: 80 },
                indent: { left: convertInchesToTwip(0.3) },
                children: [
                  new TextRun({
                    text: `${i + 1}. ${point}`,
                    size: 24,
                  }),
                ],
              })
          ),

          // === KEPUTUSAN ===
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 100 },
            children: [
              new TextRun({
                text: "II. KEPUTUSAN RAPAT",
                bold: true,
                size: 26,
              }),
            ],
          }),
          ...data.decisions.map(
            (point, i) =>
              new Paragraph({
                spacing: { after: 80 },
                indent: { left: convertInchesToTwip(0.3) },
                children: [
                  new TextRun({
                    text: `${i + 1}. ${point}`,
                    size: 24,
                  }),
                ],
              })
          ),

          // === ACTION ITEMS ===
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 100 },
            children: [
              new TextRun({
                text: "III. TINDAK LANJUT (ACTION ITEMS)",
                bold: true,
                size: 26,
              }),
            ],
          }),
          ...data.action_items.map(
            (point, i) =>
              new Paragraph({
                spacing: { after: 80 },
                indent: { left: convertInchesToTwip(0.3) },
                children: [
                  new TextRun({
                    text: `${i + 1}. ${point}`,
                    size: 24,
                  }),
                ],
              })
          ),

          // === FOOTER ===
          new Paragraph({
            spacing: { before: 600 },
            border: {
              top: {
                color: "CCCCCC",
                space: 1,
                style: BorderStyle.SINGLE,
                size: 2,
              },
            },
            children: [],
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { before: 200 },
            children: [
              new TextRun({
                text: `Dokumen ini dihasilkan secara otomatis oleh AI Agent PPID`,
                italics: true,
                size: 18,
                color: "999999",
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: `pada ${dateStr}`,
                italics: true,
                size: 18,
                color: "999999",
              }),
            ],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer as Buffer;
}
