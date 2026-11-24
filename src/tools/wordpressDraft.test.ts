import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  DRAFT_STATUS,
  escapeHtml,
  buildWordpressContentHtml,
  parseCategoryIds,
  executeCreateWordpressDraft,
  type CreateWordpressDraftParams,
} from "./wordpressDraft.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_ENV: Record<string, string> = {
  WP_BASE_URL: "https://cikasda.sultengprov.go.id",
  WP_USER: "ppid-bot",
  WP_APP_PASSWORD: "ABCD efgh IJKL mnop",
  WP_CATEGORY_ID: "3,7",
};

const SAMPLE_PARAMS: CreateWordpressDraftParams = {
  headline: "Dinas CIKASDA Sulteng Gelar Rapat Evaluasi EPPRA",
  lead_paragraph:
    "CIKASDA NEWS – Dinas Cipta Karya dan Sumber Daya Air (CIKASDA) Provinsi Sulawesi Tengah menggelar rapat evaluasi di Palu, Kamis (19/11/2026).",
  body_paragraphs: [
    "Rapat diikuti pejabat struktural dan fungsional perencana untuk meninjau capaian fisik serta serapan anggaran.",
    "Kepala Dinas menekankan percepatan penyelesaian administrasi paket pekerjaan sebelum akhir triwulan.",
  ],
  closing_paragraph:
    "Melalui kegiatan ini, Dinas CIKASDA berkomitmen menjaga ketepatan waktu pelaksanaan program infrastruktur daerah.",
  chat_id: "telegram:2100878150",
};

test("wordpressDraft: DRAFT_STATUS dan kode sumber bebas kata publish", () => {
  assert.equal(DRAFT_STATUS, "draft");
  const sourcePath = path.resolve(__dirname, "wordpressDraft.ts");
  const sourceText = fs.readFileSync(sourcePath, "utf8").toLowerCase();
  const forbiddenWord = "pub" + "lish";
  assert.equal(
    sourceText.includes(forbiddenWord),
    false,
    "Kode sumber wordpressDraft.ts tidak boleh mengandung kata terlarang tersebut",
  );
});

test("wordpressDraft: parseCategoryIds membaca env '3,7' dan fallback saat kosong", () => {
  assert.deepEqual(parseCategoryIds("3,7"), [3, 7]);
  assert.deepEqual(parseCategoryIds(" 3 , 7 , 3 "), [3, 7]);
  assert.deepEqual(parseCategoryIds(""), [3, 7]);
  assert.deepEqual(parseCategoryIds(undefined), [3, 7]);
  assert.deepEqual(parseCategoryIds("3,7", [12, 7]), [12, 7]);
});

test("wordpressDraft: escapeHtml dan buildWordpressContentHtml bungkus paragraf & escape karakter khusus", () => {
  assert.equal(escapeHtml(`A & B <tag> "quote" 'single'`), "A &amp; B &lt;tag&gt; &quot;quote&quot; &#39;single&#39;");

  const html = buildWordpressContentHtml(
    "Lead <script>alert(1)</script> & Info",
    ["Paragraf 2 & data > 0", "   "],
    'Penutup "aman"',
  );

  assert.equal(
    html,
    [
      `<p style="text-align: justify;">Lead &lt;script&gt;alert(1)&lt;/script&gt; &amp; Info</p>`,
      `<p style="text-align: justify;">Paragraf 2 &amp; data &gt; 0</p>`,
      `<p style="text-align: justify;">Penutup &quot;aman&quot;</p>`,
    ].join("\n"),
  );
});

test("wordpressDraft: env kosong gagal jelas tanpa crash dan tanpa memanggil fetch", async () => {
  let fetchCalled = false;
  const mockFetch: typeof fetch = async () => {
    fetchCalled = true;
    throw new Error("Should not call fetch");
  };

  const result = await executeCreateWordpressDraft(SAMPLE_PARAMS, {
    fetchFn: mockFetch,
    envSource: { WP_BASE_URL: "https://cikasda.sultengprov.go.id", WP_USER: "", WP_APP_PASSWORD: "" },
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.includes("WordPress belum dikonfigurasi"));
  }
  assert.equal(fetchCalled, false);
});

test("wordpressDraft: HTTP 401 mengembalikan error autentikasi tanpa retry dan tanpa membocorkan password", async () => {
  let callCount = 0;
  const mockFetch: typeof fetch = async () => {
    callCount++;
    return new Response(
      JSON.stringify({ code: "incorrect_password", message: "The password you entered is incorrect." }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  };

  const result = await executeCreateWordpressDraft(SAMPLE_PARAMS, {
    fetchFn: mockFetch,
    envSource: BASE_ENV,
  });

  assert.equal(callCount, 1);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.includes("401"));
    assert.ok(!result.error.includes(BASE_ENV.WP_APP_PASSWORD));
  }
});

test("wordpressDraft: HTTP 403 mengembalikan error otorisasi/WAF tanpa retry", async () => {
  let callCount = 0;
  const mockFetch: typeof fetch = async () => {
    callCount++;
    return new Response(
      JSON.stringify({ code: "rest_cannot_create", message: "Sorry, you are not allowed to create posts." }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  };

  const result = await executeCreateWordpressDraft(SAMPLE_PARAMS, {
    fetchFn: mockFetch,
    envSource: BASE_ENV,
  });

  assert.equal(callCount, 1);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.includes("403"));
  }
});

test("wordpressDraft: respons HTML non-JSON ditangani aman tanpa crash", async () => {
  const mockFetch: typeof fetch = async () => {
    return new Response("<html><body><h1>403 Forbidden by WAF</h1></body></html>", {
      status: 403,
      headers: { "content-type": "text/html" },
    });
  };

  const result = await executeCreateWordpressDraft(SAMPLE_PARAMS, {
    fetchFn: mockFetch,
    envSource: BASE_ENV,
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.includes("non-JSON"));
    assert.ok(result.error.includes("403"));
  }
});

test("wordpressDraft: HTTP 201 sukses menyimpan status 'draft', categories [3,7], tags [], dan return edit_link", async () => {
  const captured: { url: string; auth: string; body: Record<string, any> | null } = {
    url: "",
    auth: "",
    body: null,
  };

  const mockFetch: typeof fetch = async (input, init) => {
    captured.url = String(input);
    const headers = (init?.headers || {}) as Record<string, string>;
    captured.auth = headers.Authorization || "";
    captured.body = JSON.parse(String(init?.body || "{}"));

    return new Response(
      JSON.stringify({
        id: 18350,
        status: "draft",
        link: "https://cikasda.sultengprov.go.id/?p=18350&preview=true",
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  };

  const result = await executeCreateWordpressDraft(SAMPLE_PARAMS, {
    fetchFn: mockFetch,
    envSource: BASE_ENV,
  });

  assert.equal(captured.url, "https://cikasda.sultengprov.go.id/wp-json/wp/v2/posts");
  const expectedAuth =
    "Basic " + Buffer.from(`${BASE_ENV.WP_USER}:${BASE_ENV.WP_APP_PASSWORD}`, "utf8").toString("base64");
  assert.equal(captured.auth, expectedAuth);

  assert.ok(captured.body);
  assert.equal(captured.body.status, "draft");
  assert.deepEqual(captured.body.categories, [3, 7]);
  assert.deepEqual(captured.body.tags, []);
  assert.equal(captured.body.comment_status, "closed");
  assert.equal(captured.body.featured_media, undefined);

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.post_id, 18350);
    assert.equal(
      result.edit_link,
      "https://cikasda.sultengprov.go.id/wp-admin/post.php?post=18350&action=edit",
    );
    assert.equal(result.preview_link, "https://cikasda.sultengprov.go.id/?p=18350&preview=true");
    assert.ok(result.message.includes("DRAFT"));
  }
});

test("wordpressDraft: upload foto .jpg sukses mengirim featured_media ke post", async () => {
  const tempImg = path.join(os.tmpdir(), `wp-test-${crypto.randomUUID()}.jpg`);
  fs.writeFileSync(tempImg, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));

  const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = (init?.headers || {}) as Record<string, string>;
    calls.push({ url, headers, body: init?.body });

    if (url.endsWith("/wp/v2/media")) {
      return new Response(JSON.stringify({ id: 9912, source_url: "https://example.com/foto.jpg" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: 18351, status: "draft", link: "https://cikasda.sultengprov.go.id/?p=18351" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await executeCreateWordpressDraft(
      { ...SAMPLE_PARAMS, image_file_path: tempImg },
      { fetchFn: mockFetch, envSource: BASE_ENV },
    );

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://cikasda.sultengprov.go.id/wp-json/wp/v2/media");
    assert.equal(calls[0].headers["Content-Type"], "image/jpeg");
    assert.ok(calls[0].headers["Content-Disposition"]?.includes("attachment; filename="));

    assert.equal(calls[1].url, "https://cikasda.sultengprov.go.id/wp-json/wp/v2/posts");
    const postPayload = JSON.parse(String(calls[1].body));
    assert.equal(postPayload.status, "draft");
    assert.equal(postPayload.featured_media, 9912);

    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.featured_media_id, 9912);
      assert.equal(result.warning, undefined);
    }
  } finally {
    if (fs.existsSync(tempImg)) fs.unlinkSync(tempImg);
  }
});

test("wordpressDraft: upload media gagal HTTP 500 tetap membuat draf tanpa featured_media dan menyertakan warning", async () => {
  const tempImg = path.join(os.tmpdir(), `wp-fail-${crypto.randomUUID()}.png`);
  fs.writeFileSync(tempImg, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const state: { postPayload: Record<string, any> | null } = { postPayload: null };
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/wp/v2/media")) {
      return new Response(JSON.stringify({ code: "upload_error", message: "Disk error" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    state.postPayload = JSON.parse(String(init?.body || "{}"));
    return new Response(JSON.stringify({ id: 18352, status: "draft" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await executeCreateWordpressDraft(
      { ...SAMPLE_PARAMS, image_file_path: tempImg },
      { fetchFn: mockFetch, envSource: BASE_ENV },
    );

    assert.ok(state.postPayload);
    assert.equal(state.postPayload.status, "draft");
    assert.equal(state.postPayload.featured_media, undefined);

    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.post_id, 18352);
      assert.equal(result.featured_media_id, undefined);
      assert.ok(result.warning && result.warning.includes("500"));
      assert.ok(result.message.includes("500"));
    }
  } finally {
    if (fs.existsSync(tempImg)) fs.unlinkSync(tempImg);
  }
});

test("wordpressDraft: file .heic tidak diunggah ke media API tetapi draf tetap dibuat dengan peringatan JPEG", async () => {
  const tempHeic = path.join(os.tmpdir(), `wp-iphone-${crypto.randomUUID()}.heic`);
  fs.writeFileSync(tempHeic, Buffer.from("dummy-heic"));

  const urlsCalled: string[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    urlsCalled.push(String(input));
    const payload = JSON.parse(String(init?.body || "{}"));
    assert.equal(payload.featured_media, undefined);
    return new Response(JSON.stringify({ id: 18353, status: "draft" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await executeCreateWordpressDraft(
      { ...SAMPLE_PARAMS, image_file_path: tempHeic },
      { fetchFn: mockFetch, envSource: BASE_ENV },
    );

    assert.deepEqual(urlsCalled, ["https://cikasda.sultengprov.go.id/wp-json/wp/v2/posts"]);
    assert.equal(result.success, true);
    if (result.success) {
      assert.ok(result.warning?.includes("HEIC/HEIF"));
      assert.ok(result.message.includes("JPEG"));
    }
  } finally {
    if (fs.existsSync(tempHeic)) fs.unlinkSync(tempHeic);
  }
});
