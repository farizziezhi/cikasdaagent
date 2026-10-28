import test from "node:test";
import assert from "node:assert/strict";
import {
  maskNik,
  maskPhone,
  formatPermohonanDigest,
  PpidClient,
  type PermohonanRow,
} from "./ppidClient.js";

test("Security: Masking NIK 16 digit sesuai UU PDP", () => {
  assert.equal(maskNik("7271011508990002"), "727101******0002");
  assert.equal(maskNik("7271011234"), "7271******");
  assert.equal(maskNik(""), "-");
  assert.equal(maskNik(undefined), "-");
});

test("Security: Masking nomor telepon pemohon", () => {
  assert.equal(maskPhone("081234567890"), "0812****7890");
  assert.equal(maskPhone("0852"), "0852");
  assert.equal(maskPhone(""), "-");
});

test("PPID Client: Perhitungan status SLA tiket aktif", () => {
  const mockRows: PermohonanRow[] = [
    {
      id: 101,
      user_id: "user-1",
      jenis_informasi: "Laporan Anggaran 2025",
      deskripsi: "Meminta rincian DPA Bidang Air Baku",
      status: "diproses",
      deadline_awal: "2026-10-30",
      diperpanjang: false,
      alasan_perpanjangan: null,
      deadline_akhir: null,
      created_at: "2026-10-16T08:00:00Z",
      profiles: {
        nama: "Ahmad Dahlan",
        nik: "7271012010900001",
        telepon: "081234567890",
      },
    },
  ];

  const client = new PpidClient({
    customFetchActive: async () => mockRows,
  });

  const now = new Date("2026-10-27T00:00:00Z");
  return client.getActivePermohonan(now).then((items) => {
    assert.equal(items.length, 1);
    const item = items[0];
    assert.equal(item.id, 101);
    assert.equal(item.pemohonNama, "Ahmad Dahlan");
    assert.equal(item.pemohonNikMasked, "727101******0001");
    assert.equal(item.sla.daysRemaining, 3);
    assert.equal(item.sla.status, "WARNING");
  });
});

test("PPID Client: Formatting ringkasan pesan Telegram", () => {
  const sampleItems = [
    {
      id: 101,
      jenisInformasi: "Rincian Pembangunan Bendung",
      pemohonNama: "Budi Santoso",
      pemohonNikMasked: "727102******0005",
      status: "diproses" as const,
      diperpanjang: false,
      targetDeadline: "2026-10-28",
      sla: {
        daysRemaining: 1,
        status: "CRITICAL" as const,
        label: "H-1 (Mendesak)",
      },
    },
  ];

  const output = formatPermohonanDigest(sampleItems);
  assert.match(output, /DAFTAR TIKET PERMOHONAN INFORMASI/);
  assert.match(output, /🚨 CRITICAL/);
  assert.match(output, /Budi Santoso/);
  assert.match(output, /727102\*\*\*\*\*\*0005/);
});

test("PPID Client: Penolakan perpanjangan jika tiket sudah pernah diperpanjang", async () => {
  const client = new PpidClient({
    customGetById: async (id: number) => ({
      id,
      user_id: "user-1",
      jenis_informasi: "Data Debit Air",
      deskripsi: "Data 2024",
      status: "diproses",
      deadline_awal: "2026-10-20",
      diperpanjang: true,
      alasan_perpanjangan: "Dokumen teknis masih diverifikasi",
      deadline_akhir: "2026-10-29",
      created_at: "2026-10-06T08:00:00Z",
    }),
  });

  await assert.rejects(
    async () => {
      await client.extendSla(102, "Minta perpanjang lagi");
    },
    {
      name: "Error",
      message: /sudah pernah diperpanjang sebelumnya/,
    }
  );
});
