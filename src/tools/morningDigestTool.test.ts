import test from "node:test";
import assert from "node:assert/strict";
import { executeTriggerMorningDigest } from "./morningDigestTool.js";
import { PpidClient } from "../services/ppidClient.js";
import { SiveraClient } from "../services/siveraClient.js";
import { ApelinClient } from "../services/apelinClient.js";

test("Tools: trigger_morning_digest - Menghasilkan ringkasan briefing command center", async () => {
  const mockPpid = new PpidClient({
    customFetchActive: async () => [],
  });
  const mockSivera = new SiveraClient({
    customGetStats: async () => ({
      unverifiedCount: 0,
      undisposedCount: 0,
      totalActiveCount: 2,
    }),
  });
  const mockApelin = new ApelinClient({
    customGetSession: async (_d) => null,
  });

  const res = await executeTriggerMorningDigest(
    {},
    {
      ppidClient: mockPpid,
      siveraClient: mockSivera,
      apelinClient: mockApelin,
    }
  );

  assert.equal(res.success, true);
  if (!res.success) return;
  assert.match(res.message, /MORNING COMMAND BRIEFING CIKASDA/);
  assert.match(res.message, /Layanan KIP \(PPID-Digital\)/);
  assert.match(res.message, /Persuratan Dinas \(SIVERA\)/);
  assert.match(res.message, /Presensi Kepegawaian \(APEL-IN\)/);
});

