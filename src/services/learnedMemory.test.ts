import test from "node:test";
import assert from "node:assert";
import {
  learnFact,
  forgetFact,
  listAllMemories,
  getMemoryForPrompt,
  applyGlossaryCorrections
} from "./learnedMemory.js";

test("LearnedMemory Service", async (t) => {
  await t.test("learnFact - can record and retrieve project context", () => {
    const res = learnFact("project", "Proyek Uji Coba", "Pembangunan Saluran Sekunder");
    assert.strictEqual(res.success, true);
    assert.ok(res.message.includes("Proyek Uji Coba"));

    const promptContext = getMemoryForPrompt();
    assert.ok(promptContext.includes("Proyek Uji Coba"));
    assert.ok(promptContext.includes("Pembangunan Saluran Sekunder"));
  });

  await t.test("applyGlossaryCorrections - auto-corrects misheard CIKASDA terms", () => {
    const raw = "Rapat di dinas cik asda membahas daerah irigasi gumbas dan sumber daya alam.";
    const clean = applyGlossaryCorrections(raw);
    assert.ok(clean.includes("CIKASDA"), "Should correct cik asda to CIKASDA");
    assert.ok(clean.includes("Daerah Irigasi Gumbasa"), "Should correct daerah irigasi gumbas");
    assert.ok(clean.includes("Sumber Daya Air"), "Should correct sumber daya alam to Sumber Daya Air");
  });

  await t.test("listAllMemories - formats markdown list for Telegram", () => {
    const list = listAllMemories();
    assert.ok(list.includes("Memori & Konteks Dinas"));
    assert.ok(list.includes("SDA"));
  });

  await t.test("forgetFact - can remove test facts cleanly", () => {
    const res = forgetFact("Proyek Uji Coba");
    assert.strictEqual(res.success, true);

    const promptContext = getMemoryForPrompt();
    assert.ok(!promptContext.includes("Proyek Uji Coba"));
  });
});
