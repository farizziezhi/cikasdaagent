import test from "node:test";
import assert from "node:assert";
import {
  getMinutesSynthesisPrompt,
  getNewsExamples,
  getNewsOnlyPrompt,
} from "./minutesSynthesis.js";

test("Minutes Synthesis Prompt & Few-Shot Learning", async (t) => {
  await t.test("getNewsExamples - loads CIKASDA news few-shot reference examples (Contoh 1-7)", () => {
    const examples = getNewsExamples();
    assert.ok(examples.length > 0, "Few-shot examples should not be empty");
    assert.ok(examples.includes("CIKASDA NEWS"), "Should contain CIKASDA NEWS tag");
    assert.ok(examples.includes("Huntap"), "Should contain Contoh 1 Huntap");
    assert.ok(examples.includes("ODDELL"), "Should contain Contoh 2 ODDELL");
    assert.ok(examples.includes("PPPK"), "Should contain Contoh 3 Orientasi PPPK");
    assert.ok(examples.includes("Ombudsman"), "Should contain Contoh 4 Ombudsman & Etika Pelayanan");
    assert.ok(examples.includes("CONTOH 5") && examples.includes("SINTUWU"), "Should contain Contoh 5 SINTUWU");
    assert.ok(examples.includes("CONTOH 6") && examples.includes("EPPRA"), "Should contain Contoh 6 EPPRA");
    assert.ok(
      examples.includes("CONTOH 7") && examples.includes("Tim Analis Gubernur"),
      "Should contain Contoh 7 Tim Analis Gubernur",
    );
    assert.ok(
      examples.includes("https://cikasda.sultengprov.go.id/"),
      "Contoh 5-7 should include source URLs",
    );
  });

  await t.test("getMinutesSynthesisPrompt - produces comprehensive prompt with examples and schema", () => {
    const prompt = getMinutesSynthesisPrompt();
    assert.ok(prompt.includes("Dinas Cipta Karya dan Sumber Daya Air"), "Should mention official agency name");
    assert.ok(prompt.includes("CIKASDA NEWS"), "Should instruct CIKASDA NEWS branding");
    assert.ok(prompt.includes("Anti-Slop"), "Should enforce anti-slop guidelines");
    assert.ok(prompt.includes("FEW-SHOT BENCHMARK"), "Should inject few-shot benchmark section");
    assert.ok(prompt.includes("Orientasi PPPK"), "Should inject the user's PPPK news example");
    assert.ok(prompt.includes("Etika Pelayanan Publik"), "Should inject the user's Etika Pelayanan news example");
    assert.ok(prompt.includes("KUTIPAN TIDAK LANGSUNG"), "Should enforce indirect quotation rule");
    assert.ok(prompt.includes("[PERLU DICEK:"), "Should enforce fact-checking placeholder");
    assert.ok(prompt.includes("150–350 kata"), "Should specify target word count");
  });

  await t.test("getNewsOnlyPrompt - produces news-only prompt without minutes schema", () => {
    const prompt = getNewsOnlyPrompt();
    assert.ok(prompt.includes("news_article"), "Should require news_article JSON structure");
    assert.ok(!prompt.includes('"minutes":'), "Should NOT ask for minutes object in JSON schema");
    assert.ok(prompt.includes("CIKASDA NEWS"), "Should enforce CIKASDA NEWS lead format");
    assert.ok(prompt.includes("KUTIPAN TIDAK LANGSUNG"), "Should enforce indirect quotation rule");
    assert.ok(prompt.includes("[PERLU DICEK:"), "Should enforce [PERLU DICEK: ...] placeholder");
    assert.ok(prompt.includes("4–6 paragraf") && prompt.includes("150–350 kata"), "Should specify length target");
    assert.ok(prompt.includes("FEW-SHOT BENCHMARK"), "Should inject few-shot examples");
  });
});

