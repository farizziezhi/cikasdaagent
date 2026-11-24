import test from "node:test";
import assert from "node:assert/strict";
import { RealtimeWatcher } from "./realtimeWatcher.js";
import { PpidClient } from "./ppidClient.js";

test("RealtimeWatcher: handlePermohonanInsert mengirim notif dengan NIK tersensor & dedup", async () => {
  const sent: string[] = [];
  const mockPpid = new PpidClient({
    customGetById: async (id) => ({
      id,
      user_id: "u-1",
      jenis_informasi: "Laporan Realisasi Anggaran 2026",
      deskripsi: "Detail proyek irigasi",
      status: "diajukan",
      deadline_awal: "2026-12-08",
      diperpanjang: false,
      alasan_perpanjangan: null,
      deadline_akhir: null,
      created_at: "2026-11-24T01:30:00Z",
      profiles: {
        nama: "Andi Pratama",
        nik: "7271012345670001",
        telepon: "081234567890",
      },
    }),
  });

  const watcher = new RealtimeWatcher(
    { sendBroadcast: async (msg) => { sent.push(msg); } },
    { ppidClient: mockPpid },
  );

  const msg1 = await watcher.handlePermohonanInsert({ id: 42 });
  assert.ok(msg1);
  assert.match(msg1, /PERMOHONAN INFORMASI BARU \[#42\]/);
  assert.match(msg1, /Andi Pratama/);
  assert.match(msg1, /727101\*\*\*\*\*\*0001/);
  assert.doesNotMatch(msg1, /7271012345670001/);
  assert.equal(sent.length, 1);

  // Event ulang dengan ID yang sama harus di-dedup
  const msg2 = await watcher.handlePermohonanInsert({ id: 42 });
  assert.equal(msg2, null);
  assert.equal(sent.length, 1);
});

test("RealtimeWatcher: handleSuratInsert dan handleDisposisiInsert mengirim notif SIVERA & dedup", async () => {
  const sent: string[] = [];
  const watcher = new RealtimeWatcher({
    sendBroadcast: async (msg) => { sent.push(msg); },
  });

  const suratMsg = await watcher.handleSuratInsert({
    id: "surat-101",
    nomorSurat: "600/210/BWS-III",
    pengirim: "Balai Wilayah Sungai Sulawesi III",
    perihal: "Koordinasi Pengendalian Banjir Sungai Palu",
    statusSaatIni: "DIDAFTARKAN_PPID",
  });
  assert.ok(suratMsg);
  assert.match(suratMsg, /SURAT MASUK BARU \(SIVERA\)/);
  assert.match(suratMsg, /600\/210\/BWS-III/);
  assert.equal(sent.length, 1);

  // Dedup surat yang sama
  assert.equal(await watcher.handleSuratInsert({ id: "surat-101" }), null);
  assert.equal(sent.length, 1);

  const dispMsg = await watcher.handleDisposisiInsert({
    id: "disp-55",
    suratId: "surat-101",
    catatan: "Segera telaah teknis bersama Bidang SDA",
    bidangTujuanNama: "Bidang Sumber Daya Air",
  });
  assert.ok(dispMsg);
  assert.match(dispMsg, /DISPOSISI BARU TURUN \(SIVERA\)/);
  assert.match(dispMsg, /Bidang Sumber Daya Air/);
  assert.match(dispMsg, /Segera telaah teknis/);
  assert.equal(sent.length, 2);
});

test("RealtimeWatcher: start() aman dilewati jika kredensial Supabase kosong", async () => {
  const watcher = new RealtimeWatcher(
    { sendBroadcast: async () => {} },
    {
      ppidSupabaseUrl: "",
      ppidSupabaseKey: "",
      siveraSupabaseUrl: "",
      siveraSupabaseKey: "",
    },
  );
  watcher.start();
  await watcher.stop();
});
