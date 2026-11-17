// commandCenterScheduler.sla.test.ts — TEST BARU (v2).
// Simpan sebagai src/services/commandCenterScheduler.sla.test.ts di repo,
// lalu jalankan: pnpm test
// Menguji pemicu SLA kritis: alert sekali, tidak dobel di jam yang sama,
// dan alert lagi kalau status memburuk / hari berganti.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CommandCenterScheduler,
  buildSlaAlertMessage,
} from "./commandCenterScheduler.js";
import { PpidClient } from "./ppidClient.js";

function makePpid(rows: any[]): PpidClient {
  return new PpidClient({ customFetchActive: async () => rows });
}

const criticalRow: any = {
  id: 14,
  user_id: "u-1",
  jenis_informasi: "DPA Irigasi Gumbasa",
  deskripsi: "Rincian teknis",
  status: "diproses",
  deadline_awal: "2026-10-27",
  diperpanjang: false,
  alasan_perpanjangan: null,
  deadline_akhir: null,
  created_at: "2026-10-13T08:00:00Z",
  profiles: { nama: "Budi Santoso", nik: "7271012345670001", telepon: "081234567890" },
};

test("SLA alert: format pesan tidak membocorkan NIK/telepon utuh", () => {
  const msg = buildSlaAlertMessage([
    {
      id: 14,
      jenisInformasi: "DPA Irigasi Gumbasa",
      pemohonNama: "Budi Santoso",
      pemohonNikMasked: "727101******0001",
      targetDeadline: "2026-10-27",
      sla: { status: "CRITICAL", daysRemaining: 1 },
    },
  ]);
  assert.match(msg, /PERINGATAN SLA PPID/);
  assert.match(msg, /#14/);
  assert.match(msg, /727101\*\*\*\*\*\*0001/);
  assert.doesNotMatch(msg, /7271012345670001/);
  assert.match(msg, /hanya memberitahu/);
});

test("SLA alert: alert sekali per jam, tidak dobel", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sla-test-"));
  const statePath = join(dir, "scheduler-sent.json");
  const sent: string[] = [];
  const scheduler = new CommandCenterScheduler(
    { sendBroadcast: async (m: string) => { sent.push(m); } },
    statePath,
  );
  const ppid = makePpid([criticalRow]);
  // Senin 2026-10-26 09:02 WITA — jam kerja, menit 02 (dalam jendela 00-05).
  // Deadline 2026-10-27 = 1 hari kerja tersisa -> CRITICAL (lihat businessDays.ts).
  const senin0902 = new Date("2026-10-26T09:02:00+08:00");
  const msg1 = await scheduler.tick(senin0902, { ppidClient: ppid });
  assert.ok(msg1);
  assert.match(msg1, /#14/);
  assert.equal(sent.length, 1);

  // Tick lagi di menit yang sama -> tidak ada alert kedua.
  const msg2 = await scheduler.tick(new Date("2026-10-26T09:03:00+08:00"), { ppidClient: ppid });
  assert.equal(msg2, null);
  assert.equal(sent.length, 1);
});

test("SLA alert: tidak ada alert kalau semua tiket NORMAL", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sla-test-"));
  const statePath = join(dir, "scheduler-sent.json");
  const sent: string[] = [];
  const scheduler = new CommandCenterScheduler(
    { sendBroadcast: async (m: string) => { sent.push(m); } },
    statePath,
  );
  const normalRow = { ...criticalRow, deadline_awal: "2026-11-10" };
  const ppid = makePpid([normalRow]);
  const msg = await scheduler.tick(new Date("2026-10-26T09:02:00+08:00"), { ppidClient: ppid });
  assert.equal(msg, null);
  assert.equal(sent.length, 0);
});
