import test from "node:test";
import assert from "node:assert/strict";
import { executeTrackSiveraSurat } from "./siveraTrackTool.js";
import { SiveraClient } from "../services/siveraClient.js";

test("Tools: track_sivera_surat - Menolak kata kunci pencarian kosong", async () => {
  const mockClient = new SiveraClient({});
  const res = await executeTrackSiveraSurat({ keyword: " " }, mockClient);
  assert.equal(res.success, false);
  if (res.success) return;
  assert.match(res.error, /minimal 2 karakter/);
});

test("Tools: track_sivera_surat - Menampilkan pelacakan surat yang ditemukan", async () => {
  const mockClient = new SiveraClient({
    customSearchSurat: async (_kw) => [
      {
        id: "s-100",
        nomorSurat: "005/78/Bappeda/2026",
        nomorAgenda: "102/CK-SDA/2026",
        pengirim: "Bappeda Provinsi Sulawesi Tengah",
        perihal: "Undangan Rakor Perencanaan Irigasi",
        tanggalSurat: new Date("2026-10-25"),
        tanggalDiterima: new Date("2026-10-26T08:00:00Z"),
        statusSaatIni: "TERDISPOSISI",
        fileUrl: "https://storage.neon.tech/s-100.pdf",
      },
    ],
    customGetDisposisi: async (_id) => [
      {
        id: "d-1",
        catatan: "Hadir mewakili dinas dan siapkan bahan paparan.",
        createdAt: new Date("2026-10-26T10:00:00Z"),
        bidangTujuanNama: "Sekretariat",
      },
    ],
    customGetAuditLogs: async (_id) => [],
  });

  const res = await executeTrackSiveraSurat(
    { keyword: "Bappeda", chat_id: "2100878150" },
    mockClient
  );

  assert.equal(res.success, true);
  if (!res.success) return;
  assert.equal(res.totalFound, 1);
  assert.match(res.message, /PELACAKAN NASKAH DINAS SIVERA/);
  assert.match(res.message, /005\/78\/Bappeda\/2026/);
  assert.match(res.message, /\[✓\] 3\. Disposisi Kepala Dinas/);
  assert.match(res.message, /Hadir mewakili dinas/);
});
