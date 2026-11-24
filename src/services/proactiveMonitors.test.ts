import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HealthWatchdog,
  checkStaleWordpressDrafts,
  buildSiveraBottleneckMessage,
  buildWeeklyExecutiveDigest,
} from "./proactiveMonitors.js";
import { CommandCenterScheduler } from "./commandCenterScheduler.js";
import { PpidClient } from "./ppidClient.js";
import { SiveraClient } from "./siveraClient.js";
import { ApelinClient } from "./apelinClient.js";

test("HealthWatchdog: alert hanya setelah 3x gagal beruntun dan kirim notif pulih saat sukses", () => {
  const wd = new HealthWatchdog(3);

  assert.equal(wd.recordFailure("sivera", "timeout"), null);
  assert.equal(wd.recordFailure("sivera", "timeout"), null);

  const alert = wd.recordFailure("sivera", "ECONNREFUSED");
  assert.ok(alert);
  assert.match(alert, /PERINGATAN HEALTH WATCHDOG/);
  assert.match(alert, /SIVERA/);
  assert.match(alert, /3× berturut-turut/);

  // Kegagalan ke-4 tidak spam ulang
  assert.equal(wd.recordFailure("sivera", "ECONNREFUSED"), null);

  // Pulih kembali -> notif pemulihan sekali
  const recovery = wd.recordSuccess("sivera");
  assert.ok(recovery);
  assert.match(recovery, /kembali normal/);
  assert.equal(wd.recordSuccess("sivera"), null);
});

test("checkStaleWordpressDrafts: mendeteksi draf > 24 jam dan mengabaikan draf baru", async () => {
  const now = new Date("2026-11-24T15:00:00+08:00");
  const mockFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify([
        {
          id: 101,
          title: { rendered: "Draf Lama Belum Tayang" },
          modified_gmt: "2026-11-22T05:00:00", // > 24 jam
        },
        {
          id: 102,
          title: { rendered: "Draf Baru Pagi Tadi" },
          modified_gmt: "2026-11-24T03:00:00", // < 24 jam
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  const res = await checkStaleWordpressDrafts({
    fetchFn: mockFetch,
    envSource: {
      WP_BASE_URL: "https://cikasda.sultengprov.go.id",
      WP_USER: "ppid-bot",
      WP_APP_PASSWORD: "ABCD efgh",
    },
    now,
  });

  assert.equal(res.count, 1);
  assert.ok(res.message);
  assert.match(res.message, /Draf Lama Belum Tayang/);
  assert.doesNotMatch(res.message, /Draf Baru Pagi Tadi/);
  assert.match(res.message, /post\.php\?post=101&action=edit/);
});

test("buildSiveraBottleneckMessage: memformat peringatan surat tertahan > 2 hari kerja", () => {
  const msg = buildSiveraBottleneckMessage([
    {
      id: "s-1",
      nomorSurat: "800/45/SET",
      pengirim: "BKD Sulteng",
      perihal: "Usulan Kenaikan Pangkat",
      statusSaatIni: "DITERIMA_KEARSIPAN",
      tanggalDiterima: "18 Nov 2026",
      businessDaysStalled: 4,
    },
  ]);

  assert.ok(msg);
  assert.match(msg, /SURAT TERTAHAN SIVERA/);
  assert.match(msg, /800\/45\/SET/);
  assert.match(msg, /Menunggu Disposisi Kadis/);
  assert.match(msg, /4 hari kerja/);
});

test("buildWeeklyExecutiveDigest & CommandCenterScheduler: Jumat 17:00 WITA memicu Weekly Digest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "weekly-test-"));
  const statePath = join(dir, "scheduler-sent.json");
  const broadcasts: string[] = [];
  const adminBroadcasts: string[] = [];

  const scheduler = new CommandCenterScheduler(
    {
      sendBroadcast: async (m) => { broadcasts.push(m); },
      sendAdminBroadcast: async (m) => { adminBroadcasts.push(m); },
    },
    statePath,
  );

  // Kamis 17:00 bukan Weekly Digest
  const kamis1700 = new Date("2026-11-19T17:00:00+08:00");
  assert.equal(scheduler.shouldTrigger(kamis1700), null);

  // Jumat 2026-11-20 17:02 WITA -> WEEKLY_DIGEST
  const jumat1702 = new Date("2026-11-20T17:02:00+08:00");
  const mockPpid = new PpidClient({ customFetchActive: async () => [] });
  const mockSivera = new SiveraClient({
    customGetStats: async () => ({ unverifiedCount: 1, undisposedCount: 2, totalActiveCount: 5 }),
    customGetStalledSurat: async () => [],
  });
  const mockApelin = new ApelinClient({ customGetSession: async () => null });

  const digest = await scheduler.tick(jumat1702, {
    ppidClient: mockPpid,
    siveraClient: mockSivera,
    apelinClient: mockApelin,
    envSource: { WP_USER: "", WP_APP_PASSWORD: "" },
  });

  assert.ok(digest);
  assert.match(digest, /RINGKASAN MINGGUAN EKSEKUTIF PPID CIKASDA/);
  assert.match(digest, /17:00 WITA/);
  assert.match(digest, /ditinjau Tim PPID sebelum diteruskan/);
  assert.equal(broadcasts.length, 1);

  // Tidak dobel di menit berikutnya
  assert.equal(await scheduler.tick(new Date("2026-11-20T17:03:00+08:00")), null);

  // Verifikasi juga buildWeeklyExecutiveDigest langsung
  const standalone = await buildWeeklyExecutiveDigest({
    ppidClient: mockPpid,
    siveraClient: mockSivera,
    apelinClient: mockApelin,
    envSource: { WP_USER: "", WP_APP_PASSWORD: "" },
    date: jumat1702,
  });
  assert.match(standalone, /Total Naskah Aktif\s*: 5 berkas/);

  // Verifikasi HealthWatchdog via scheduler.reportHealth
  await scheduler.reportHealth("wordpress", false, "err 1");
  await scheduler.reportHealth("wordpress", false, "err 2");
  assert.equal(adminBroadcasts.length, 0);
  await scheduler.reportHealth("wordpress", false, "err 3");
  assert.equal(adminBroadcasts.length, 1);
  assert.match(adminBroadcasts[0], /HEALTH WATCHDOG/);
});
