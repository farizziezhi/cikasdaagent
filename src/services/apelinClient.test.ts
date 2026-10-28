import test from "node:test";
import assert from "node:assert/strict";
import {
  ApelinClient,
  formatApelinReportMessage,
  type ApelinSessionRow,
  type DepartmentRecapRow,
  type AuditSnapshotRow,
} from "./apelinClient.js";

test("APEL-IN: Pengambilan info sesi dan kalkulasi rekap kehadiran", async () => {
  const mockSession: ApelinSessionRow = {
    id: "sess-20261026",
    sessionCode: "20261026-MORNING",
    sessionType: "MORNING",
    localDate: new Date("2026-10-26"),
    scheduledOpenAt: new Date("2026-10-26T07:15:00+08:00"),
    lateAfterAt: new Date("2026-10-26T07:45:00+08:00"),
    scheduledCloseAt: new Date("2026-10-26T08:00:00Z"),
    status: "CLOSED",
    startedAt: new Date("2026-10-26T07:15:00+08:00"),
    closedAt: new Date("2026-10-26T08:00:00+08:00"),
  };

  const mockDeptRecap: DepartmentRecapRow[] = [
    {
      departmentId: "d-sekretariat",
      departmentName: "Sekretariat Dinas",
      departmentCode: "SEKR",
      totalEmployees: 50,
      presentCount: 45,
      lateCount: 3,
      absentCount: 2,
    },
    {
      departmentId: "d-sda",
      departmentName: "Bidang Sumber Daya Air",
      departmentCode: "SDA",
      totalEmployees: 60,
      presentCount: 55,
      lateCount: 2,
      absentCount: 3,
    },
  ];

  const mockSnapshot: AuditSnapshotRow = {
    anchorStatus: "CONFIRMED",
    txHash: "0xabc123def456789",
    blockNumber: "5432100",
    anchoredAt: new Date("2026-10-26T08:05:00+08:00"),
  };

  const client = new ApelinClient({
    customGetSession: async (_date) => mockSession,
    customGetDepartmentRecap: async (_sessionId) => mockDeptRecap,
    customGetSnapshot: async (_sessionId) => mockSnapshot,
  });

  const report = await client.getSessionRecap("2026-10-26");
  assert.ok(report);
  assert.equal(report.session.sessionCode, "20261026-MORNING");
  assert.equal(report.session.status, "CLOSED");
  assert.equal(report.summary.totalEmployees, 110);
  assert.equal(report.summary.presentCount, 100);
  assert.equal(report.summary.lateCount, 5);
  assert.equal(report.summary.absentCount, 5);
  assert.equal(report.summary.attendanceRate, "95.5"); // (105 / 110) * 100
  assert.equal(report.departments.length, 2);
  assert.equal(report.snapshot?.anchorStatus, "CONFIRMED");
});

test("APEL-IN: Formatting pesan laporan eksekutif Telegram", () => {
  const sampleReport = {
    session: {
      id: "sess-1",
      sessionCode: "20261026-MORNING",
      sessionType: "MORNING" as const,
      localDate: "26 Oktober 2026",
      status: "CLOSED",
      scheduledOpenAt: "07:15 WITA",
      scheduledCloseAt: "08:00 WITA",
    },
    summary: {
      totalEmployees: 100,
      presentCount: 90,
      lateCount: 5,
      absentCount: 5,
      attendanceRate: "95.0",
    },
    departments: [
      {
        departmentName: "Sekretariat Dinas",
        totalEmployees: 40,
        presentCount: 36,
        lateCount: 2,
        absentCount: 2,
        rate: "95.0",
      },
    ],
    snapshot: {
      anchorStatus: "CONFIRMED",
      txHash: "0x73421064ea5595e2046ecc2648af5ad77f48ce09",
    },
  };

  const message = formatApelinReportMessage(sampleReport);
  assert.match(message, /LAPORAN PRESENSI APEL KEDINASAN CIKASDA/);
  assert.match(message, /Apel Senin Pagi/);
  assert.match(message, /SELESAI DITUTUP/);
  assert.match(message, /90 orang \(90.0%\)/);
  assert.match(message, /Sekretariat Dinas/);
  assert.match(message, /TERSINKRONISASI ON-CHAIN/);
  assert.match(message, /0x7342\.\.\.ce09/);
});

test("APEL-IN: Penanganan sesi tidak ditemukan", () => {
  const message = formatApelinReportMessage(null);
  assert.match(message, /Tidak ada data sesi apel/);
  assert.match(message, /Jadwal apel rutin: Senin Pagi \(07:15 WITA\) & Kamis Sore \(15:45 WITA\)/);
});
