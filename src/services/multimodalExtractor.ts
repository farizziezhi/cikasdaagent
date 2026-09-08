import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";

export interface ExtractedMedia {
  type: "text" | "pdf_part" | "image_part";
  textContent?: string;
  inlineData?: {
    mimeType: string;
    data: string; // Base64
  };
}

/**
 * Ekstraksi teks dari file presentasi PowerPoint (.pptx)
 * Membaca slide secara berurutan dari paket ZIP PPTX tanpa dependensi eksternal.
 */
export async function extractTextFromPptx(filePath: string): Promise<string> {
  try {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();
    
    // Temukan slide dan urutkan slide1.xml, slide2.xml, dst.
    const slideEntries = entries
      .filter(e => e.entryName.startsWith("ppt/slides/slide") && e.entryName.endsWith(".xml"))
      .sort((a, b) => {
        const numA = parseInt(a.entryName.replace(/\D/g, "") || "0", 10);
        const numB = parseInt(b.entryName.replace(/\D/g, "") || "0", 10);
        return numA - numB;
      });

    if (slideEntries.length === 0) {
      return "File PowerPoint tidak berisi slide teks yang dapat dibaca.";
    }

    const slideOutputs: string[] = [];
    slideEntries.forEach((entry, idx) => {
      const xml = entry.getData().toString("utf-8");
      // Cocokkan tag teks pada OpenXML DrawingML: <a:t>teks</a:t>
      const matches = xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi);
      if (matches && matches.length > 0) {
        const cleanTexts = matches
          .map(m => m.replace(/<[^>]+>/g, "").trim())
          .filter(t => t.length > 0);
        if (cleanTexts.length > 0) {
          slideOutputs.push(`[Slide ${idx + 1}]:\n${cleanTexts.join(" | ")}`);
        }
      }
    });

    return slideOutputs.join("\n\n");
  } catch (err: any) {
    console.error("[MultimodalExtractor] Gagal ekstrak PPTX:", err.message);
    throw new Error(`Gagal membaca file presentasi PPTX: ${err.message}`);
  }
}

/**
 * Mengubah file PDF menjadi Gemini Multimodal Part
 */
export function preparePdfPart(filePath: string): ExtractedMedia {
  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString("base64");
  return {
    type: "pdf_part",
    inlineData: {
      mimeType: "application/pdf",
      data: base64Data
    }
  };
}

/**
 * Mengubah file Gambar (Slide foto / Papan tulis) menjadi Gemini Multimodal Part
 */
export function prepareImagePart(filePath: string): ExtractedMedia {
  const ext = path.extname(filePath).toLowerCase();
  let mimeType = "image/jpeg";
  if (ext === ".png") mimeType = "image/png";
  if (ext === ".webp") mimeType = "image/webp";

  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString("base64");
  return {
    type: "image_part",
    inlineData: {
      mimeType,
      data: base64Data
    }
  };
}

/**
 * Mendeteksi kategori file dari ekstensi
 */
export function detectMediaType(filePath: string): "audio" | "pptx" | "pdf" | "image" | "unknown" {
  const ext = path.extname(filePath).toLowerCase();
  if ([".mp3", ".wav", ".m4a", ".ogg", ".opus", ".flac", ".webm", ".aac"].includes(ext)) {
    return "audio";
  }
  if ([".pptx", ".ppt"].includes(ext)) {
    return "pptx";
  }
  if (ext === ".pdf") {
    return "pdf";
  }
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
    return "image";
  }
  return "unknown";
}
