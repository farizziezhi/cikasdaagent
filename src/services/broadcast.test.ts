import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChatId, getBroadcastChatIds } from "./broadcast.js";

test("normalizeChatId: buang awalan telegram: atau platform prefix", () => {
  assert.equal(normalizeChatId("telegram:2100878150"), "2100878150");
  assert.equal(normalizeChatId("telegram:-1001987654321"), "-1001987654321");
  assert.equal(normalizeChatId("discord:123456789"), "123456789");
  assert.equal(normalizeChatId("2100878150"), "2100878150");
  assert.equal(normalizeChatId("  telegram:2100878150  "), "2100878150");
});

test("getBroadcastChatIds: normalisasi dan dedup penerima", async () => {
  const origBroadcast = process.env.BROADCAST_CHAT_IDS;
  const origWhitelist = process.env.WHITELIST_CHAT_IDS;
  const origRegistered = process.env.BROADCAST_TO_REGISTERED;

  try {
    // Beri input dengan variasi awalan telegram:, spasi, dan duplikat
    process.env.BROADCAST_CHAT_IDS = "telegram:2100878150, 2100878150, telegram:-100123456";
    process.env.WHITELIST_CHAT_IDS = "2100878150, telegram:999999";
    process.env.BROADCAST_TO_REGISTERED = "false"; // uji daftar env

    const ids = await getBroadcastChatIds();
    // Harus ter-normalisasi dan tidak ada duplikat untuk 2100878150
    assert.deepEqual(ids, ["2100878150", "-100123456", "999999"]);
  } finally {
    process.env.BROADCAST_CHAT_IDS = origBroadcast;
    process.env.WHITELIST_CHAT_IDS = origWhitelist;
    process.env.BROADCAST_TO_REGISTERED = origRegistered;
  }
});
