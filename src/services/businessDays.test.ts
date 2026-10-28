import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateBusinessDaysRemaining,
  addBusinessDays,
  isWeekend,
  isHoliday,
  isWorkingDay
} from "./businessDays.js";

test("BusinessDays: Identifikasi akhir pekan dan hari kerja", () => {
  const jumat = new Date("2026-10-23T00:00:00Z");
  const sabtu = new Date("2026-10-24T00:00:00Z");
  const minggu = new Date("2026-10-25T00:00:00Z");
  const senin = new Date("2026-10-26T00:00:00Z");

  assert.equal(isWeekend(jumat), false);
  assert.equal(isWeekend(sabtu), true);
  assert.equal(isWeekend(minggu), true);
  assert.equal(isWeekend(senin), false);

  assert.equal(isWorkingDay(jumat), true);
  assert.equal(isWorkingDay(sabtu), false);
});

test("BusinessDays: Deteksi hari libur nasional", () => {
  const hutRi = new Date("2026-08-17T00:00:00Z");
  assert.equal(isHoliday(hutRi), true);
  assert.equal(isWorkingDay(hutRi), false);
});

test("BusinessDays: Perhitungan sisa hari kerja melewati akhir pekan", () => {
  // Jumat 23 Okt 2026 ke Selasa 27 Okt 2026
  // Lewat Sabtu 24 & Minggu 25 -> Hari kerja: Senin 26, Selasa 27 = 2 hari kerja
  const start = new Date("2026-10-23T00:00:00Z");
  const target = new Date("2026-10-27T00:00:00Z");

  const result = calculateBusinessDaysRemaining(start, target);
  assert.equal(result.daysRemaining, 2);
  assert.equal(result.status, "WARNING");
});

test("BusinessDays: Deteksi status CRITICAL (H-1 / H-0) dan OVERDUE", () => {
  const start = new Date("2026-10-23T00:00:00Z"); // Jumat
  const targetBesok = new Date("2026-10-26T00:00:00Z"); // Senin (1 hari kerja)
  const targetHariIni = new Date("2026-10-23T00:00:00Z"); // Hari ini (0 hari kerja)
  const targetKemarin = new Date("2026-10-22T00:00:00Z"); // Lewat tenggat

  assert.equal(calculateBusinessDaysRemaining(start, targetBesok).status, "CRITICAL");
  assert.equal(calculateBusinessDaysRemaining(start, targetHariIni).status, "CRITICAL");
  assert.equal(calculateBusinessDaysRemaining(start, targetKemarin).status, "OVERDUE");
});

test("BusinessDays: Penambahan hari kerja murni (addBusinessDays +7 hari)", () => {
  // Jumat 23 Okt + 7 hari kerja
  // 1: Sen 26, 2: Sel 27, 3: Rab 28, 4: Kam 29, 5: Jum 30, 6: Sen 2 Nov, 7: Sel 3 Nov
  const start = new Date("2026-10-23T00:00:00Z");
  const extended = addBusinessDays(start, 7);

  assert.equal(extended.getDate(), 3);
  assert.equal(extended.getMonth(), 10); // November (0-indexed = 10)
});
