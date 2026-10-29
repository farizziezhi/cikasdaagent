import test from "node:test";
import assert from "node:assert/strict";
import {
  isApelDay,
  buildApelReminder,
  buildMorningBriefing,
  CommandCenterScheduler,
} from "./commandCenterScheduler.js";
import { PpidClient } from "./ppidClient.js";
import { SiveraClient } from "./siveraClient.js";
import { ApelinClient } from "./apelinClient.js";

test("Scheduler: Deteksi hari apel kedinasan rutin (Senin & Kamis)", () => {
  // 2026-10-26 adalah hari Senin
  const senin = new Date("2026-10-26T08:00:00+08:00");
  const checkSenin = isApelDay(senin);
  assert.equal(checkSenin.isApel, true);
  assert.equal(checkSenin.type, "MORNING");
  assert.match(checkSenin.label, /Apel Senin Pagi/);

  // 2026-10-29 adalah hari Kamis
  const kamis = new Date("2026-10-29T15:00:00+08:00");
  const checkKamis = isApelDay(kamis);
  assert.equal(checkKamis.isApel, true);
  assert.equal(checkKamis.type, "AFTERNOON");
  assert.match(checkKamis.label, /Apel Kamis Sore/);

  // 2026-10-27 adalah hari Selasa (bukan hari apel)
  const selasa = new Date("2026-10-27T09:00:00+08:00");
  const checkSelasa = isApelDay(selasa);
  assert.equal(checkSelasa.isApel, false);
  assert.equal(checkSelasa.type, null);
});

test("Scheduler: Template pengingat apel otomatis", () => {
  const reminderPagi = buildApelReminder("MORNING");
  assert.match(reminderPagi, /PENGINGAT APEL SENIN PAGI/);
  assert.match(reminderPagi, /07:15 WITA/);

  const reminderSore = buildApelReminder("AFTERNOON");
  assert.match(reminderSore, /PENGINGAT APEL KAMIS SORE/);
  assert.match(reminderSore, /15:45 WITA/);
});

test("Scheduler: Penyusunan Morning Briefing terpadu 3 pilar", async () => {
  const mockPpid = new PpidClient({
    customFetchActive: async () => [
      {
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
        profiles: {
          nama: "Budi Santoso",
          nik: "7271012345670001",
          telepon: "081234567890",
        },
      },
    ],
  });

  const mockSivera = new SiveraClient({
    customGetStats: async () => ({
      unverifiedCount: 3,
      undisposedCount: 2,
      totalActiveCount: 7,
    }),
  });

  const mockApelin = new ApelinClient({
    customGetSession: async (_d) => null,
  });

  const seninDate = new Date("2026-10-26T08:00:00+08:00");
  const briefing = await buildMorningBriefing({
    ppidClient: mockPpid,
    siveraClient: mockSivera,
    apelinClient: mockApelin,
    date: seninDate,
  });

  assert.match(briefing, /MORNING COMMAND BRIEFING/);
  assert.match(briefing, /Layanan KIP \(PPID-Digital\)/);
  assert.match(briefing, /Persuratan Dinas \(SIVERA\)/);
  assert.match(briefing, /Presensi Kepegawaian \(APEL-IN\)/);
  assert.match(briefing, /DPA Irigasi Gumbasa/);
  assert.match(briefing, /3 berkas menunggu verifikasi/);
  assert.match(briefing, /APEL SENIN PAGI/);
});

test("Scheduler: Validasi pemicu waktu (shouldTrigger) pengingat apel dan morning briefing", () => {
  const scheduler = new CommandCenterScheduler();

  // Senin 06:45 WITA -> APEL_PAGI
  const senin0645 = new Date("2026-10-26T06:45:00+08:00");
  assert.equal(scheduler.shouldTrigger(senin0645), "APEL_PAGI");
  // Cek idempotensi marker hari yang sama (tidak dobel kirim)
  assert.equal(scheduler.shouldTrigger(senin0645), null);

  // Senin 08:00 WITA -> MORNING_BRIEFING
  const senin0800 = new Date("2026-10-26T08:00:00+08:00");
  assert.equal(scheduler.shouldTrigger(senin0800), "MORNING_BRIEFING");
  assert.equal(scheduler.shouldTrigger(senin0800), null);

  // Kamis 15:47 WITA -> APEL_SORE
  const kamis1547 = new Date("2026-10-29T15:47:00+08:00");
  assert.equal(scheduler.shouldTrigger(kamis1547), "APEL_SORE");

  // Jam 12:00 -> null
  const siang = new Date("2026-10-26T12:00:00+08:00");
  assert.equal(scheduler.shouldTrigger(siang), null);
});

