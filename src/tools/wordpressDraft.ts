import fs from "fs";
import path from "path";
import { normalizeChatId } from "../services/broadcast.js";

/**
 * Status draf dikunci permanen — bot TIDAK pernah menayangkan berita otomatis.
 * Penayangan ke portal hanya dilakukan manual oleh petugas Kehumasan di WP Admin.
 */
export const DRAFT_STATUS = "draft" as const;

const DEFAULT_WP_BASE_URL = "https://cikasda.sultengprov.go.id";
const DEFAULT_CATEGORY_IDS = [3, 7] as const;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const SUPPORTED_IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export interface CreateWordpressDraftParams {
  headline: string;
  lead_paragraph: string;
  body_paragraphs: string[];
  closing_paragraph: string;
  image_file_path?: string;
  categories?: number[];
  chat_id: string;
}

export type CreateWordpressDraftResponse =
  | {
      success: true;
      post_id: number;
      edit_link: string;
      preview_link: string;
      featured_media_id?: number;
      warning?: string;
      message: string;
    }
  | {
      success: false;
      error: string;
    };

export interface WordpressDraftDeps {
  fetchFn?: typeof fetch;
  envSource?: Record<string, string | undefined>;
}

/**
 * Escape karakter HTML agar teks bebas dari input tidak merusak markup paragraf WordPress.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Susun HTML paragraf Gutenberg-friendly untuk WordPress REST API.
 */
export function buildWordpressContentHtml(
  lead: string,
  bodyParagraphs: string[],
  closing: string,
): string {
  const safeBody = Array.isArray(bodyParagraphs) ? bodyParagraphs : [];
  const paragraphs = [lead, ...safeBody, closing]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean);

  return paragraphs
    .map((p) => `<p style="text-align: justify;">${escapeHtml(p)}</p>`)
    .join("\n");
}

/**
 * Parse ID kategori WordPress dari array override atau env string dipisah koma (mis. "3,7").
 */
export function parseCategoryIds(raw?: string, override?: number[]): number[] {
  if (Array.isArray(override) && override.length > 0) {
    const validOverride = override.filter((n) => Number.isInteger(n) && n > 0);
    if (validOverride.length > 0) {
      return [...new Set(validOverride)];
    }
  }

  if (typeof raw === "string" && raw.trim()) {
    const parsed = raw
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (parsed.length > 0) {
      return [...new Set(parsed)];
    }
  }

  return [...DEFAULT_CATEGORY_IDS];
}

function tryParseJson(rawText: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(rawText);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("[REDACTED]");
}

interface MediaUploadResult {
  mediaId?: number;
  warning?: string;
  fatalError?: string;
}

async function uploadFeaturedMedia(
  imagePath: string,
  baseUrl: string,
  authHeader: string,
  userAgent: string,
  secret: string,
  fetchFn: typeof fetch,
): Promise<MediaUploadResult> {
  if (!fs.existsSync(imagePath)) {
    return {
      warning: "File foto utama tidak ditemukan di server; draf dibuat tanpa foto utama.",
    };
  }

  const ext = path.extname(imagePath).toLowerCase();
  if (ext === ".heic" || ext === ".heif") {
    return {
      warning:
        "Format foto HEIC/HEIF tidak didukung WordPress — konversi dulu ke JPEG lalu unggah manual di WP admin.",
    };
  }

  const mimeType = SUPPORTED_IMAGE_MIME[ext];
  if (!mimeType) {
    return {
      warning: `Format foto (${ext || "tidak dikenal"}) tidak didukung WordPress (gunakan JPEG/PNG/WebP/GIF) — unggah manual di WP admin.`,
    };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(imagePath);
  } catch (err: any) {
    return {
      warning: `Gagal membaca metadata foto (${redactSecret(err?.message || "stat error", secret)}) — draf dibuat tanpa foto utama.`,
    };
  }

  if (!stat.isFile()) {
    return {
      warning: "Path foto utama bukan berkas yang valid — draf dibuat tanpa foto utama.",
    };
  }

  if (stat.size > MAX_UPLOAD_BYTES) {
    return {
      warning:
        "Ukuran foto melebihi batas 10 MB — kompres dulu (maks. lebar 1920 px) lalu unggah manual di WP admin.",
    };
  }

  const safeName =
    path.basename(imagePath).replace(/[^a-zA-Z0-9._-]/g, "_") || `foto-kegiatan${ext}`;
  const fileBuffer = fs.readFileSync(imagePath);

  try {
    const res = await fetchFn(`${baseUrl}/wp-json/wp/v2/media`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "User-Agent": userAgent,
      },
      body: fileBuffer,
    });

    const rawText = await res.text();
    const json = tryParseJson(rawText);
    const wpCode = typeof json?.code === "string" ? json.code : "";

    if (res.status === 401) {
      console.error(`[WordpressDraft] Upload media ditolak (HTTP 401, code: ${wpCode || "-"})`);
      return {
        fatalError:
          "Autentikasi WordPress gagal (HTTP 401) — cek WP_USER dan Application Password di .env, serta pastikan header Authorization tidak dibuang server. Tidak dilakukan percobaan ulang otomatis.",
      };
    }

    if (!res.ok || typeof json?.id !== "number") {
      console.warn(
        `[WordpressDraft] Upload media gagal (HTTP ${res.status}, code: ${wpCode || "-"}), lanjut membuat draf tanpa foto utama.`,
      );
      if (res.status === 403) {
        return {
          warning:
            "Upload foto ditolak (HTTP 403) — pastikan user bot memiliki izin unggah berkas (role Editor/Author) atau cek aturan WAF; draf dibuat tanpa foto utama.",
        };
      }
      if (res.status === 413) {
        return {
          warning:
            "Ukuran foto ditolak server (HTTP 413 Payload Too Large) — unggah versi terkompres manual di WP admin.",
        };
      }
      if (!json) {
        return {
          warning: `Upload foto mengembalikan respons non-JSON (HTTP ${res.status}) — draf dibuat tanpa foto utama, silakan unggah manual di WP admin.`,
        };
      }
      return {
        warning: `Upload foto gagal (HTTP ${res.status}${wpCode ? `: ${wpCode}` : ""}) — draf tetap dibuat tanpa foto utama, silakan unggah manual di WP admin.`,
      };
    }

    return { mediaId: json.id };
  } catch (err: any) {
    const safeMsg = redactSecret(err?.message || "kesalahan jaringan", secret);
    console.warn(`[WordpressDraft] Upload media error: ${safeMsg}`);
    return {
      warning: `Upload foto utama gagal (${safeMsg}) — draf tetap dibuat tanpa foto utama, silakan unggah manual di WP admin.`,
    };
  }
}

function buildPostErrorMessage(
  status: number,
  wpCode: string,
  wpMsg: string,
): string {
  if (status === 401) {
    return "Autentikasi WordPress gagal (HTTP 401) — cek WP_USER dan Application Password di .env (termasuk spasi), serta pastikan header Authorization tidak dibuang server. Tidak dilakukan percobaan ulang otomatis.";
  }
  if (status === 403) {
    return "Akses WordPress ditolak (HTTP 403) — pastikan role user bot minimal Editor (bukan Contributor/Subscriber) dan rute /wp-json/wp/v2/posts tidak diblokir WAF atau plugin keamanan.";
  }
  if (status === 404) {
    return "Endpoint REST API WordPress tidak ditemukan (HTTP 404) — periksa pengaturan Permalinks di WP Admin atau filter REST API.";
  }
  if (status === 413) {
    return "Ukuran payload draf melebihi batas server (HTTP 413 Payload Too Large).";
  }
  const detailCode = wpCode ? `, ${wpCode}` : "";
  const detailMsg = wpMsg ? `: ${wpMsg}` : "";
  return `Gagal menyimpan draf WordPress (HTTP ${status}${detailCode})${detailMsg}.`;
}

/**
 * Eksekutor tool create_wordpress_draft:
 * Menyimpan artikel CIKASDA NEWS ke WordPress dengan status eksplisit "draft" (tidak pernah tayang otomatis).
 */
export async function executeCreateWordpressDraft(
  params: CreateWordpressDraftParams,
  deps?: WordpressDraftDeps,
): Promise<CreateWordpressDraftResponse> {
  const envSource = deps?.envSource ?? process.env;
  const fetchFn = deps?.fetchFn ?? globalThis.fetch;

  const baseUrl = (envSource.WP_BASE_URL || DEFAULT_WP_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
  const wpUser = (envSource.WP_USER || "").trim();
  const wpAppPassword = (envSource.WP_APP_PASSWORD || "").trim();

  if (!wpUser || !wpAppPassword) {
    return {
      success: false,
      error:
        "WordPress belum dikonfigurasi (WP_USER atau WP_APP_PASSWORD kosong) — hubungi admin untuk melengkapi .env.",
    };
  }

  const isHttps = baseUrl.startsWith("https://");
  const isLocalHttp = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(baseUrl);
  if (!isHttps && !isLocalHttp) {
    return {
      success: false,
      error:
        "Konfigurasi WP_BASE_URL tidak valid: wajib menggunakan HTTPS agar Application Password aman.",
    };
  }

  const title = (params.headline || "").trim();
  if (!title) {
    return {
      success: false,
      error: "Judul berita (headline) wajib diisi sebelum membuat draf WordPress.",
    };
  }

  const htmlContent = buildWordpressContentHtml(
    params.lead_paragraph,
    params.body_paragraphs,
    params.closing_paragraph,
  );
  if (!htmlContent) {
    return {
      success: false,
      error: "Isi berita tidak boleh kosong. Sertakan paragraf pembuka, isi, atau penutup.",
    };
  }

  const authHeader =
    "Basic " + Buffer.from(`${wpUser}:${wpAppPassword}`, "utf8").toString("base64");
  const userAgent = "CIKASDA-PPID-Bot/1.0";

  let featuredMediaId: number | undefined;
  let mediaWarning: string | undefined;

  const imagePath = params.image_file_path?.trim();
  if (imagePath) {
    const mediaResult = await uploadFeaturedMedia(
      imagePath,
      baseUrl,
      authHeader,
      userAgent,
      wpAppPassword,
      fetchFn,
    );
    if (mediaResult.fatalError) {
      return { success: false, error: mediaResult.fatalError };
    }
    featuredMediaId = mediaResult.mediaId;
    mediaWarning = mediaResult.warning;
  }

  const categoryIds = parseCategoryIds(envSource.WP_CATEGORY_ID, params.categories);
  const payload: Record<string, unknown> = {
    title,
    content: htmlContent,
    status: DRAFT_STATUS,
    categories: categoryIds,
    tags: [],
    comment_status: "closed",
  };
  if (featuredMediaId !== undefined) {
    payload.featured_media = featuredMediaId;
  }

  try {
    const res = await fetchFn(`${baseUrl}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        "User-Agent": userAgent,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await res.text();
    const json = tryParseJson(rawText);

    if (!json) {
      const snippet = redactSecret(
        rawText.replace(/\s+/g, " ").trim().slice(0, 200),
        wpAppPassword,
      );
      console.error(
        `[WordpressDraft] Respons non-JSON dari WP (HTTP ${res.status}): ${snippet}`,
      );
      return {
        success: false,
        error: `Server WordPress mengembalikan respons non-JSON (HTTP ${res.status}). Kemungkinan rute diblokir WAF atau permalink bermasalah. Cuplikan: ${snippet || "(kosong)"}`,
      };
    }

    if (!res.ok) {
      const wpCode = typeof json.code === "string" ? json.code : "";
      const wpMsg = redactSecret(
        typeof json.message === "string" ? json.message : "",
        wpAppPassword,
      );
      console.error(
        `[WordpressDraft] Gagal membuat draf (HTTP ${res.status}, code: ${wpCode || "-"})`,
      );
      return {
        success: false,
        error: buildPostErrorMessage(res.status, wpCode, wpMsg),
      };
    }

    if (typeof json.id !== "number") {
      return {
        success: false,
        error: "WordPress mengembalikan respons sukses tanpa ID post yang valid.",
      };
    }

    const postId: number = json.id;
    const editLink = `${baseUrl}/wp-admin/post.php?post=${postId}&action=edit`;
    const previewLink =
      typeof json.link === "string" && json.link
        ? json.link
        : `${baseUrl}/?p=${postId}&preview=true`;

    const cleanChatId = normalizeChatId(params.chat_id || "");
    console.log(
      `[WordpressDraft] Draf berhasil disimpan (post_id=${postId}, status=${DRAFT_STATUS}, chat_id=${cleanChatId || "-"})`,
    );

    const mediaNote =
      featuredMediaId !== undefined
        ? `Terpasang (Media ID: ${featuredMediaId})`
        : mediaWarning
          ? `Tidak terpasang (${mediaWarning})`
          : "Tidak disertakan";

    const lines = [
      `📝 <b>DRAF BERITA CIKASDA NEWS TERSIMPAN (STATUS: DRAFT)</b>`,
      `• <b>Judul:</b> ${title}`,
      `• <b>ID Post:</b> #${postId}`,
      `• <b>Kategori ID:</b> ${categoryIds.join(", ")} (FAKTUAL & PPID CIKASDA)`,
      `• <b>Foto Utama:</b> ${mediaNote}`,
      `• <b>Tautan Edit WP Admin:</b> ${editLink}`,
      `• <b>Pratinjau Draf:</b> ${previewLink}`,
      ``,
      `<i>Mohon Petugas Kehumasan PPIDP memeriksa ketepatan nama, gelar, jabatan, tanggal, angka, serta tanda [PERLU DICEK] sebelum menayangkan manual di WP Admin.</i>`,
    ];

    return {
      success: true,
      post_id: postId,
      edit_link: editLink,
      preview_link: previewLink,
      ...(featuredMediaId !== undefined ? { featured_media_id: featuredMediaId } : {}),
      ...(mediaWarning ? { warning: mediaWarning } : {}),
      message: lines.join("\n"),
    };
  } catch (err: any) {
    const safeMsg = redactSecret(err?.message || "kesalahan jaringan", wpAppPassword);
    console.error(`[WordpressDraft] Gagal menghubungi WordPress: ${safeMsg}`);
    return {
      success: false,
      error: `Gagal menghubungi server WordPress: ${safeMsg}`,
    };
  }
}
