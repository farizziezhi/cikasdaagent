import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  convertInchesToTwip,
  ShadingType,
  PageBreak
} from "docx";

export interface ActionItemDetail {
  task: string;
  pic?: string;
  deadline?: string;
}

export interface ModernMinutesData {
  title: string;
  date_info?: string;
  executive_summary?: string;
  key_points: string[];
  decisions: string[];
  action_items: (ActionItemDetail | string)[];
}

export interface NewsArticleData {
  headline: string;
  lead_paragraph: string;
  body_paragraphs: string[];
  closing_paragraph: string;
}

export interface MeetingSynthesisResult {
  minutes: ModernMinutesData;
  news_article?: NewsArticleData;
}

/**
 * Membuat dokumen Word (.docx) yang berisi:
 * 1. Notulen Rapat Modern (Catatan kerja ringkas to-the-point)
 * 2. Berita Acara / Siaran Pers "CIKASDA NEWS" (Narasi jurnalistik resmi siap publikasi)
 */
export async function generateMinutesDocx(data: ModernMinutesData | MeetingSynthesisResult): Promise<Buffer> {
  const currentDate = new Date().toLocaleDateString("id-ID", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Normalisasi input jika berupa MeetingSynthesisResult atau ModernMinutesData langsung
  const minutes = "minutes" in data ? data.minutes : data;
  const news = "news_article" in data ? data.news_article : undefined;

  const displayDate = minutes.date_info || currentDate;

  const docChildren: any[] = [
    // =========================================================================
    // BAGIAN 1: NOTULEN & CATATAN RAPAT
    // =========================================================================
    new Paragraph({
      spacing: { before: 0, after: 60 },
      children: [
        new TextRun({
          text: "BAGIAN 1: NOTULEN & CATATAN RAPAT",
          size: 20, // 10pt
          bold: true,
          color: "2563EB", // Royal Blue
        }),
      ],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: minutes.title,
          size: 32, // 16pt
          bold: true,
          color: "0F172A",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({ text: "Waktu / Pelaksanaan: ", bold: true, color: "64748B" }),
        new TextRun({ text: displayDate, color: "334155" }),
      ],
    }),

    // Garis pemisah minimalis
    new Paragraph({
      border: {
        bottom: {
          color: "E2E8F0",
          space: 1,
          style: BorderStyle.SINGLE,
          size: 4,
        },
      },
      spacing: { after: 240 },
      children: [],
    }),

    // Ringkasan Eksekutif (jika ada)
    ...(minutes.executive_summary
      ? [
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 100, after: 100 },
            children: [
              new TextRun({
                text: "📌 Ringkasan Eksekutif",
                bold: true,
                size: 26,
                color: "0F172A",
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 240 },
            shading: {
              type: ShadingType.CLEAR,
              fill: "F8FAFC",
            },
            indent: { left: convertInchesToTwip(0.15), right: convertInchesToTwip(0.15) },
            children: [
              new TextRun({
                text: minutes.executive_summary,
                size: 23,
                color: "334155",
              }),
            ],
          }),
        ]
      : []),

    // Poin-Poin Penting Pembahasan
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 160, after: 120 },
      children: [
        new TextRun({
          text: "💡 Poin-Poin Penting Pembahasan",
          bold: true,
          size: 26,
          color: "0F172A",
        }),
      ],
    }),
    ...minutes.key_points.map(
      (point) =>
        new Paragraph({
          spacing: { after: 100 },
          indent: { left: convertInchesToTwip(0.25) },
          children: [
            new TextRun({ text: "•  ", bold: true, color: "2563EB" }),
            new TextRun({ text: point }),
          ],
        })
    ),

    // Kesepakatan & Keputusan Rapat
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 120 },
      children: [
        new TextRun({
          text: "✅ Kesepakatan & Keputusan Rapat",
          bold: true,
          size: 26,
          color: "0F172A",
        }),
      ],
    }),
    ...minutes.decisions.map(
      (decision, i) =>
        new Paragraph({
          spacing: { after: 100 },
          indent: { left: convertInchesToTwip(0.25) },
          children: [
            new TextRun({ text: `${i + 1}. `, bold: true, color: "16A34A" }),
            new TextRun({ text: decision }),
          ],
        })
    ),

    // Tindak Lanjut / Action Items
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 120 },
      children: [
        new TextRun({
          text: "🎯 Tindak Lanjut & Action Items",
          bold: true,
          size: 26,
          color: "0F172A",
        }),
      ],
    }),
    ...minutes.action_items.map((item) => {
      if (typeof item === "string") {
        return new Paragraph({
          spacing: { after: 100 },
          indent: { left: convertInchesToTwip(0.25) },
          children: [
            new TextRun({ text: "[  ] ", bold: true, color: "64748B" }),
            new TextRun({ text: item }),
          ],
        });
      }

      const picText = item.pic ? ` [PIC: ${item.pic}]` : "";
      const deadlineText = item.deadline ? ` (Target: ${item.deadline})` : "";

      return new Paragraph({
        spacing: { after: 100 },
        indent: { left: convertInchesToTwip(0.25) },
        children: [
          new TextRun({ text: "[  ] ", bold: true, color: "64748B" }),
          new TextRun({ text: item.task, bold: true }),
          new TextRun({ text: picText, color: "2563EB" }),
          new TextRun({ text: deadlineText, color: "E11D48" }),
        ],
      });
    }),
  ];

  // =========================================================================
  // BAGIAN 2: BERITA ACARA / SIARAN PERS (CIKASDA NEWS)
  // =========================================================================
  if (news && news.headline) {
    docChildren.push(
      // Pemisah Halaman
      new Paragraph({
        children: [new PageBreak()],
      }),

      // Banner CIKASDA NEWS
      new Paragraph({
        spacing: { before: 200, after: 80 },
        children: [
          new TextRun({
            text: "BAGIAN 2: BERITA ACARA & RILIS KEGIATAN",
            size: 20,
            bold: true,
            color: "0284C7", // Cyan/Blue
          }),
        ],
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 160 },
        children: [
          new TextRun({
            text: news.headline,
            size: 32,
            bold: true,
            color: "0F172A",
          }),
        ],
      }),

      // Garis Aksen
      new Paragraph({
        border: {
          bottom: {
            color: "0284C7",
            space: 1,
            style: BorderStyle.SINGLE,
            size: 6,
          },
        },
        spacing: { after: 240 },
        children: [],
      }),

      // Paragraf Pembuka / Lead
      new Paragraph({
        spacing: { after: 160, line: 360 },
        children: [
          new TextRun({
            text: news.lead_paragraph,
            size: 23,
            bold: false,
          }),
        ],
      }),

      // Paragraf Isi / Body
      ...news.body_paragraphs.map(
        (p) =>
          new Paragraph({
            spacing: { after: 160, line: 360 },
            children: [
              new TextRun({
                text: p,
                size: 23,
              }),
            ],
          })
      ),

      // Paragraf Penutup / Closing
      new Paragraph({
        spacing: { before: 100, after: 200, line: 360 },
        children: [
          new TextRun({
            text: news.closing_paragraph,
            size: 23,
            italics: false,
          }),
        ],
      })
    );
  }

  // Footer Dokumen
  docChildren.push(
    new Paragraph({
      spacing: { before: 400 },
      border: {
        top: {
          color: "E2E8F0",
          space: 1,
          style: BorderStyle.SINGLE,
          size: 2,
        },
      },
      children: [],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 100 },
      children: [
        new TextRun({
          text: `Dihasilkan otomatis oleh AI Agent PPID CIKASDA Sulteng • ${currentDate}`,
          italics: true,
          size: 18,
          color: "94A3B8",
        }),
      ],
    })
  );

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "Segoe UI",
            size: 23,
            color: "1E293B",
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.9),
              bottom: convertInchesToTwip(0.9),
              left: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
            },
          },
        },
        children: docChildren,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer as Buffer;
}
