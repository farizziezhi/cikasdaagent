import fs from "fs";
import path from "path";

export interface LearnedFact {
  category: "project" | "team" | "glossary" | "preference";
  key: string;
  value: string;
  updatedAt: string;
}

export interface MeetingExample {
  id: string;
  title: string;
  summary: string;
}

export interface LearnedMemoryData {
  version: string;
  facts: LearnedFact[];
  examples: MeetingExample[];
}

const MEMORY_DIR = path.resolve(process.cwd(), "data");
const MEMORY_FILE = path.join(MEMORY_DIR, "learned_memory.json");

/**
 * Seed data awal khusus Dinas CIKASDA Sulteng
 */
const DEFAULT_MEMORY: LearnedMemoryData = {
  version: "1.0.0",
  facts: [
    {
      category: "glossary",
      key: "SDA",
      value: "Sumber Daya Air (Bidang keairan dan irigasi Dinas CIKASDA Sulteng)",
      updatedAt: new Date().toISOString()
    },
    {
      category: "glossary",
      key: "CIKASDA",
      value: "Dinas Cipta Karya dan Sumber Daya Air Provinsi Sulawesi Tengah",
      updatedAt: new Date().toISOString()
    },
    {
      category: "glossary",
      key: "PPID",
      value: "Pejabat Pengelola Informasi dan Dokumentasi",
      updatedAt: new Date().toISOString()
    },
    {
      category: "glossary",
      key: "BWS",
      value: "Balai Wilayah Sungai (BWS Sulawesi III Palu)",
      updatedAt: new Date().toISOString()
    },
    {
      category: "glossary",
      key: "DI",
      value: "Daerah Irigasi (misal: DI Gumbasa, DI Singgara, DI Sausu)",
      updatedAt: new Date().toISOString()
    },
    {
      category: "project",
      key: "Irigasi Gumbasa",
      value: "Daerah Irigasi kewenangan provinsi/nasional penopang ketahanan pangan Lembah Palu dan Sigi",
      updatedAt: new Date().toISOString()
    },
    {
      category: "preference",
      key: "Gaya Notulen",
      value: "To-the-point, poin-poin padat, fokus pada hasil keputusan rapat dan siapa penanggung jawabnya (PIC)",
      updatedAt: new Date().toISOString()
    }
  ],
  examples: [
    {
      id: "contoh_standar",
      title: "Rapat Koordinasi Pengendalian Banjir & Irigasi",
      summary: "Pembahasan kesiapan tanggap darurat banjir sungai Palu, peninjauan pintu air DI Gumbasa, dan alokasi anggaran pemeliharaan rutin."
    }
  ]
};

/**
 * Memastikan file data/learned_memory.json ada
 */
function ensureMemoryFile(): LearnedMemoryData {
  try {
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    if (!fs.existsSync(MEMORY_FILE)) {
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(DEFAULT_MEMORY, null, 2), "utf-8");
      return DEFAULT_MEMORY;
    }
    const raw = fs.readFileSync(MEMORY_FILE, "utf-8");
    return JSON.parse(raw) as LearnedMemoryData;
  } catch (err) {
    console.error("[LearnedMemory] Gagal membaca file memori:", err);
    return DEFAULT_MEMORY;
  }
}

/**
 * Menyimpan data memori ke disk
 */
function saveMemory(data: LearnedMemoryData): void {
  try {
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("[LearnedMemory] Gagal menulis memori:", err);
  }
}

/**
 * Mengajari bot fakta baru (proyek, tim, istilah, preferensi)
 */
export function learnFact(
  category: "project" | "team" | "glossary" | "preference",
  key: string,
  value: string
): { success: boolean; message: string } {
  const data = ensureMemoryFile();
  const existingIdx = data.facts.findIndex(
    f => f.key.toLowerCase().trim() === key.toLowerCase().trim()
  );

  const now = new Date().toISOString();
  if (existingIdx >= 0) {
    data.facts[existingIdx].value = value;
    data.facts[existingIdx].category = category;
    data.facts[existingIdx].updatedAt = now;
  } else {
    data.facts.push({
      category,
      key: key.trim(),
      value: value.trim(),
      updatedAt: now
    });
  }

  saveMemory(data);
  return {
    success: true,
    message: `Fakta baru berhasil dipelajari: [${category.toUpperCase()}] ${key} = ${value}`
  };
}

/**
 * Menghapus fakta yang sudah dipelajari jika diminta staf
 */
export function forgetFact(key: string): { success: boolean; message: string } {
  const data = ensureMemoryFile();
  const initialLen = data.facts.length;
  data.facts = data.facts.filter(f => f.key.toLowerCase() !== key.toLowerCase().trim());

  if (data.facts.length < initialLen) {
    saveMemory(data);
    return { success: true, message: `Fakta "${key}" berhasil dihapus dari memori bot.` };
  }
  return { success: false, message: `Fakta "${key}" tidak ditemukan di memori bot.` };
}

/**
 * Mendapatkan seluruh isi memori untuk ditampilkan ke staf
 */
export function listAllMemories(): string {
  const data = ensureMemoryFile();
  if (!data.facts || data.facts.length === 0) {
    return "Belum ada memori atau fakta khusus yang tersimpan.";
  }

  const grouped: Record<string, LearnedFact[]> = {
    project: [],
    team: [],
    glossary: [],
    preference: []
  };

  for (const f of data.facts) {
    if (grouped[f.category]) {
      grouped[f.category].push(f);
    } else {
      grouped.glossary.push(f);
    }
  }

  const lines: string[] = ["🧠 **Memori & Konteks Dinas yang Telah Dipelajari Bot:**\n"];

  if (grouped.project.length > 0) {
    lines.push("📌 **Proyek & Kegiatan:**");
    grouped.project.forEach(f => lines.push(`• **${f.key}**: ${f.value}`));
    lines.push("");
  }

  if (grouped.team.length > 0) {
    lines.push("👥 **Tim & Pejabat:**");
    grouped.team.forEach(f => lines.push(`• **${f.key}**: ${f.value}`));
    lines.push("");
  }

  if (grouped.glossary.length > 0) {
    lines.push("📖 **Glosarium & Singkatan Istilah:**");
    grouped.glossary.forEach(f => lines.push(`• **${f.key}**: ${f.value}`));
    lines.push("");
  }

  if (grouped.preference.length > 0) {
    lines.push("⚙️ **Preferensi Format:**");
    grouped.preference.forEach(f => lines.push(`• **${f.key}**: ${f.value}`));
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Menyusun konteks memori untuk disuntikkan langsung ke Prompt Gemini
 */
export function getMemoryForPrompt(): string {
  const data = ensureMemoryFile();
  if (!data.facts || data.facts.length === 0) return "";

  const items = data.facts.map(f => `- [${f.category.toUpperCase()}] ${f.key}: ${f.value}`).join("\n");
  return `\n## Pengetahuan & Konteks Dinas yang Telah Dipelajari (Gunakan sebagai Acuan):\n${items}\n`;
}

/**
 * Mengoreksi salah dengar umum transkrip berdasarkan glosarium
 */
export function applyGlossaryCorrections(rawText: string): string {
  const data = ensureMemoryFile();
  let corrected = rawText;

  // Koreksi salah dengar umum Whisper untuk istilah CIKASDA
  const defaultCorrections: [RegExp, string][] = [
    [/\bcik asda\b/gi, "CIKASDA"],
    [/\bcipta karya dan sumber daya alam\b/gi, "Cipta Karya dan Sumber Daya Air"],
    [/\bsumber daya alam\b/gi, "Sumber Daya Air"],
    [/\bdi gumbas\b/gi, "DI Gumbasa"],
    [/\bdaerah irigasi gumbas\b/gi, "Daerah Irigasi Gumbasa"],
    [/\bpp id\b/gi, "PPID"],
    [/\bbws sulawesi 3\b/gi, "BWS Sulawesi III"]
  ];

  for (const [pattern, replacement] of defaultCorrections) {
    corrected = corrected.replace(pattern, replacement);
  }

  return corrected;
}
