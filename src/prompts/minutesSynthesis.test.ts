import test from "node:test";
import assert from "node:assert";
import { getMinutesSynthesisPrompt, getNewsExamples } from "./minutesSynthesis.js";

test("Minutes Synthesis Prompt & Few-Shot Learning", async (t) => {
  await t.test("getNewsExamples - loads CIKASDA news few-shot reference examples", () => {
    const examples = getNewsExamples();
    assert.ok(examples.length > 0, "Few-shot examples should not be empty");
    assert.ok(examples.includes("CIKASDA NEWS"), "Should contain CIKASDA NEWS tag");
    assert.ok(examples.includes("Huntap"), "Should contain Contoh 1 Huntap");
    assert.ok(examples.includes("ODDELL"), "Should contain Contoh 2 ODDELL");
    assert.ok(examples.includes("PPPK"), "Should contain Contoh 3 Orientasi PPPK");
    assert.ok(examples.includes("Ombudsman"), "Should contain Contoh 4 Ombudsman & Etika Pelayanan");
  });

  await t.test("getMinutesSynthesisPrompt - produces comprehensive prompt with examples and schema", () => {
    const prompt = getMinutesSynthesisPrompt();
    assert.ok(prompt.includes("Dinas Cipta Karya dan Sumber Daya Air"), "Should mention official agency name");
    assert.ok(prompt.includes("CIKASDA NEWS"), "Should instruct CIKASDA NEWS branding");
    assert.ok(prompt.includes("Anti-Slop"), "Should enforce anti-slop guidelines");
    assert.ok(prompt.includes("FEW-SHOT BENCHMARK"), "Should inject few-shot benchmark section");
    assert.ok(prompt.includes("Orientasi PPPK"), "Should inject the user's PPPK news example");
    assert.ok(prompt.includes("Etika Pelayanan Publik"), "Should inject the user's Etika Pelayanan news example");
  });
});

