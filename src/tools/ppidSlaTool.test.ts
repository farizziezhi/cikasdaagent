import test from "node:test";
import assert from "node:assert/strict";
import { executeCheckPpidSla, executeExtendPpidSla } from "./ppidSlaTool.js";
import { PpidClient } from "../services/ppidClient.js";

test("Tools: check_ppid_sla - Menampilkan seluruh tiket aktif", async () => {
  const mockClient = new PpidClient({
    customFetchActive: async () => [
      {
        id: 12,
        user_id: "u-1",
        jenis_informasi: "RAB Embung Desa Torue",
        deskripsi: "RAB teknis",
        status: "diproses",
        deadline_awal: "2026-10-28",
        diperpanjang: false,
        alasan_perpanjangan: null,
        deadline_akhir: null,
        created_at: "2026-10-15T08:00:00Z",
        profiles: {
          nama: "I Wayan Sujana",
          nik: "7208012304880003",
          telepon: "081399887766",
        },
      },
    ],
  });

  const res = await executeCheckPpidSla({}, mockClient);
  assert.equal(res.success, true);
  if (!res.success) return;
  assert.equal(res.totalActive, 1);
  assert.match(res.message, /DAFTAR TIKET PERMOHONAN/);
  assert.match(res.message, /RAB Embung Desa Torue/);
  assert.match(res.message, /I Wayan Sujana/);
});

test("Tools: check_ppid_sla - Menampilkan detail tiket spesifik dengan masking NIK", async () => {
  const mockClient = new PpidClient({
    customGetById: async (id: number) => ({
      id,
      user_id: "u-2",
      jenis_informasi: "Dokumen AMDAL Sungai Palu",
      deskripsi: "Kajian dampak lingkungan",
      status: "diproses",
      deadline_awal: "2026-10-29",
      diperpanjang: false,
      alasan_perpanjangan: null,
      deadline_akhir: null,
      created_at: "2026-10-16T08:00:00Z",
      profiles: {
        nama: "Siti Rahmawati",
        nik: "7271035509920004",
        telepon: "082198765432",
      },
    }),
  });

  const res = await executeCheckPpidSla({ id: 50 }, mockClient);
  assert.equal(res.success, true);
  if (!res.success) return;
  assert.match(res.message, /DETAIL TIKET PERMOHONAN #50/);
  assert.match(res.message, /727103\*\*\*\*\*\*0004/);
  assert.match(res.message, /0821\*\*\*\*5432/);
});

test("Tools: extend_ppid_sla - Menolak alasan perpanjangan terlalu pendek", async () => {
  const mockClient = new PpidClient({});
  const res = await executeExtendPpidSla(
    { id: 10, alasan: "abc", chat_id: "12345" },
    mockClient
  );

  assert.equal(res.success, false);
  if (res.success) return;
  assert.match(res.error, /minimal 5 karakter/);
});

test("Tools: extend_ppid_sla - Sukses memperpanjang tiket +7 hari kerja", async () => {
  let updatedExtend = false;
  const mockClient = new PpidClient({
    customGetById: async (id: number) => ({
      id,
      user_id: "u-3",
      jenis_informasi: "Peta Jaringan Irigasi Gumbasa",
      deskripsi: "Peta teknis CAD/PDF",
      status: "diproses",
      deadline_awal: "2026-10-27",
      diperpanjang: false,
      alasan_perpanjangan: null,
      deadline_akhir: null,
      created_at: "2026-10-13T08:00:00Z",
    }),
    customUpdateExtend: async (_id, _deadline, _alasan) => {
      updatedExtend = true;
    },
  });

  const res = await executeExtendPpidSla(
    {
      id: 77,
      alasan: "Data teknis memerlukan verifikasi lapangan oleh Pejabat Pembuat Komitmen",
      chat_id: "2100878150",
    },
    mockClient
  );

  assert.equal(res.success, true);
  if (!res.success) return;
  assert.equal(updatedExtend, true);
  assert.match(res.message, /PERPANJANGAN WAKTU SLA BERHASIL/);
  assert.match(res.message, /Tenggat Baru \(\+7 Hari Kerja\)/);
});

