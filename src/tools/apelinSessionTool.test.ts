import test from "node:test";
import assert from "node:assert/strict";
import { executeCheckApelinSession } from "./apelinSessionTool.js";
import { ApelinClient } from "../services/apelinClient.js";

test("Tools: check_apelin_session - Mengambil laporan apel tanggal hari ini / terbaru", async () => {
  const mockClient = new ApelinClient({
    customGetSession: async (_d) => ({
      id: "sess-123",
      sessionCode: "20261026-MORNING",
      sessionType: "MORNING",
      localDate: new Date("2026-10-26"),
      scheduledOpenAt: new Date("2026-10-26T07:15:00+08:00"),
      lateAfterAt: new Date("2026-10-26T07:45:00+08:00"),
      scheduledCloseAt: new Date("2026-10-26T08:00:00+08:00"),
      status: "CLOSED",
      startedAt: new Date("2026-10-26T07:15:00+08:00"),
      closedAt: new Date("2026-10-26T08:00:00+08:00"),
    }),
    customGetDepartmentRecap: async (_sId) => [
      {
        departmentId: "d-1",
        departmentName: "Sekretariat Dinas",
        departmentCode: "SEKR",
        totalEmployees: 40,
        presentCount: 38,
        lateCount: 1,
        absentCount: 1,
      },
    ],
    customGetSnapshot: async (_sId) => ({
      anchorStatus: "CONFIRMED",
      txHash: "0x37afe9d908225bee6d06854bded22e85ec597056",
      blockNumber: "6500123",
      anchoredAt: new Date("2026-10-26T08:02:00+08:00"),
    }),
  });

  const res = await executeCheckApelinSession({}, mockClient);
  assert.equal(res.success, true);
  if (!res.success) return;
  assert.match(res.message, /LAPORAN PRESENSI APEL KEDINASAN CIKASDA/);
  assert.match(res.message, /Apel Senin Pagi/);
  assert.match(res.message, /97\.5%/);
  assert.match(res.message, /0x37af\.\.\.7056/);
});

test("Tools: check_apelin_session - Respon informatif jika sesi tidak ditemukan", async () => {
  const mockClient = new ApelinClient({
    customGetSession: async (_d) => null,
  });

  const res = await executeCheckApelinSession({ date: "2026-10-25" }, mockClient);
  assert.equal(res.success, true);
  if (!res.success) return;
  assert.match(res.message, /Tidak ada data sesi apel yang ditemukan/);
});
