import test from "node:test";
import assert from "node:assert/strict";
import {
  SiveraClient,
  mapStatusToCheckpoint,
  formatSiveraTrackingMessage,
  type SuratRow,
  type DisposisiRow,
} from "./siveraClient.js";

test("SIVERA: Pemetaan 5 Checkpoint status surat", () => {
  assert.deepEqual(mapStatusToCheckpoint("DIDAFTARKAN_PPID"), {
    checkpointIndex: 1,
    label: "Registrasi Loket PPID",
  });
  assert.deepEqual(mapStatusToCheckpoint("DITERIMA_KEARSIPAN"), {
    checkpointIndex: 2,
    label: "Agenda Kearsipan",
  });
  assert.deepEqual(mapStatusToCheckpoint("TERDISPOSISI"), {
    checkpointIndex: 3,
    label: "Disposisi Kepala Dinas",
  });
  assert.deepEqual(mapStatusToCheckpoint("DITERIMA_BIDANG"), {
    checkpointIndex: 4,
    label: "Tanda Terima Bidang",
  });
  assert.deepEqual(mapStatusToCheckpoint("DIPROSES"), {
    checkpointIndex: 4,
    label: "Tanda Terima Bidang",
  });
  assert.deepEqual(mapStatusToCheckpoint("ARSIP"), {
    checkpointIndex: 5,
    label: "Berkas Arsip Permanen",
  });
});

test("SIVERA: Tracking surat dengan disposisi lengkap", async () => {
  const mockSurat: SuratRow[] = [
    {
      id: "surat-001",
      nomorSurat: "600/124/BWS/2026",
      nomorAgenda: "042/CK-SDA/2026",
      pengirim: "Balai Wilayah Sungai Sulawesi III",
      perihal: "Permohonan Rekomendasi Teknis Saluran Gumbasa",
      tanggalSurat: new Date("2026-10-20"),
      tanggalDiterima: new Date("2026-10-21T08:30:00Z"),
      statusSaatIni: "TERDISPOSISI",
      fileUrl: "https://storage.neon.tech/surat-001.pdf",
    },
  ];

  const mockDisposisi: DisposisiRow[] = [
    {
      id: "disp-001",
      catatan: "Tindak lanjuti peninjauan lapangan bersama tim teknis BWS.",
      createdAt: new Date("2026-10-22T09:00:00Z"),
      bidangTujuanNama: "Bidang Sumber Daya Air (SDA)",
    },
  ];

  const client = new SiveraClient({
    customSearchSurat: async (_keyword) => mockSurat,
    customGetDisposisi: async (_suratId) => mockDisposisi,
    customGetAuditLogs: async (_suratId) => [],
  });

  const results = await client.searchSurat("Gumbasa");
  assert.equal(results.length, 1);
  const item = results[0];
  assert.equal(item.nomorSurat, "600/124/BWS/2026");
  assert.equal(item.checkpointIndex, 3);
  assert.equal(item.disposisi.length, 1);
  assert.equal(item.disposisi[0].bidangTujuanNama, "Bidang Sumber Daya Air (SDA)");
});

test("SIVERA: Formatting pesan Telegram pelacakan naskah", () => {
  const item = {
    id: "surat-001",
    nomorSurat: "600/124/BWS/2026",
    nomorAgenda: "042/CK-SDA/2026",
    pengirim: "Balai Wilayah Sungai Sulawesi III",
    perihal: "Permohonan Rekomendasi Teknis",
    tanggalSurat: "20 Oktober 2026",
    tanggalDiterima: "21 Oktober 2026",
    statusSaatIni: "TERDISPOSISI" as const,
    checkpointIndex: 3,
    checkpointLabel: "Disposisi Kepala Dinas",
    fileUrl: "https://storage.neon.tech/surat-001.pdf",
    disposisi: [
      {
        id: "disp-1",
        catatan: "Segera koordinasikan dengan tim teknis.",
        createdAt: "22 Oktober 2026",
        bidangTujuanNama: "Bidang Sumber Daya Air (SDA)",
      },
    ],
    auditLogs: [],
  };

  const message = formatSiveraTrackingMessage([item]);
  assert.match(message, /PELACAKAN NASKAH DINAS SIVERA/);
  assert.match(message, /\[✓\] 1\. Registrasi Loket PPID/);
  assert.match(message, /\[✓\] 2\. Agenda Kearsipan/);
  assert.match(message, /\[✓\] 3\. Disposisi Kepala Dinas/);
  assert.match(message, /\[ \] 4\. Tanda Terima Bidang/);
  assert.match(message, /\[ \] 5\. Berkas Arsip Permanen/);
  assert.match(message, /Segera koordinasikan dengan tim teknis/);
  assert.match(message, /Bidang Sumber Daya Air \(SDA\)/);
});

test("SIVERA: Hasil pencarian kosong memberikan pesan informatif", () => {
  const message = formatSiveraTrackingMessage([]);
  assert.match(message, /Tidak ditemukan naskah dinas/);
  assert.match(message, /Pastikan nomor surat, nomor agenda, atau kata kunci instansi pengirim sudah tepat/);
});
