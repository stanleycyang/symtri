import assert from "node:assert/strict";
import test from "node:test";
import { isCalendarDay } from "./dates";

test("snapshot dates reject impossible days and accept leap days", () => {
  for (const value of ["2026-02-30", "2026-02-29", "2026-13-01", "2026-00-01", "2026-10-1", "invalid", null]) {
    assert.equal(isCalendarDay(value), false);
  }
  for (const value of ["2024-02-29", "2026-10-12", "2026-12-31"]) {
    assert.equal(isCalendarDay(value), true);
  }
});

test("calendar day validation enforces 30-day and 31-day month boundaries", () => {
  // 30-day months: April (04), June (06), September (09), November (11)
  const thirtyDayMonths = ["04", "06", "09", "11"];
  for (const mm of thirtyDayMonths) {
    assert.equal(isCalendarDay(`2026-${mm}-30`), true, `day 30 should be valid for month ${mm}`);
    assert.equal(isCalendarDay(`2026-${mm}-31`), false, `day 31 should be invalid for month ${mm}`);
  }

  // 31-day months: Jan (01), Mar (03), May (05), Jul (07), Aug (08), Oct (10), Dec (12)
  const thirtyOneDayMonths = ["01", "03", "05", "07", "08", "10", "12"];
  for (const mm of thirtyOneDayMonths) {
    assert.equal(isCalendarDay(`2026-${mm}-31`), true, `day 31 should be valid for month ${mm}`);
    assert.equal(isCalendarDay(`2026-${mm}-32`), false, `day 32 should be invalid for month ${mm}`);
  }

  // Day zero is invalid for all months
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    assert.equal(isCalendarDay(`2026-${mm}-00`), false, `day 00 should be invalid for month ${mm}`);
  }
});

test("leap year rules correctly handle quadrennial and century boundaries", () => {
  // Standard quadrennial leap years: Feb 29 is valid
  assert.equal(isCalendarDay("2024-02-29"), true);
  assert.equal(isCalendarDay("2028-02-29"), true);

  // Common non-leap years: Feb 29 is invalid
  assert.equal(isCalendarDay("2023-02-29"), false);
  assert.equal(isCalendarDay("2025-02-29"), false);
  assert.equal(isCalendarDay("2026-02-29"), false);

  // Century rule: divisible by 100 but not 400 is not a leap year
  assert.equal(isCalendarDay("1900-02-29"), false);
  assert.equal(isCalendarDay("2100-02-29"), false);

  // Century rule: divisible by 400 is a leap year
  assert.equal(isCalendarDay("2000-02-29"), true);
  assert.equal(isCalendarDay("2400-02-29"), true);
});

test("year transitions and boundaries preserve date integrity", () => {
  assert.equal(isCalendarDay("2025-12-31"), true);
  assert.equal(isCalendarDay("2026-01-01"), true);
  assert.equal(isCalendarDay("1999-12-31"), true);
  assert.equal(isCalendarDay("2000-01-01"), true);
  assert.equal(isCalendarDay("9999-12-31"), true);
});

test("time components, timezone offsets, and malformed strings are rejected", () => {
  const malformed = [
    // ISO timestamps with time and TZ indicators
    "2026-10-14T00:00:00Z",
    "2026-10-14T23:59:59.999Z",
    "2026-10-14T12:00:00+14:00",
    "2026-10-14T12:00:00-12:00",
    "2026-10-14 00:00:00",
    // Whitespace padding
    " 2026-10-14",
    "2026-10-14 ",
    "2026- 10-14",
    // Non-padded parts
    "2026-1-1",
    "2026-01-1",
    "2026-1-01",
    // Invalid delimiters and formatting
    "2026/10/14",
    "2026.10.14",
    "14-10-2026",
    "20261014",
    // Out-of-bounds months
    "2026-00-15",
    "2026-13-15",
    // Negative or non-4-digit years
    "-2026-01-01",
    "10000-01-01",
    "26-10-14",
    "",
  ];

  for (const value of malformed) {
    assert.equal(isCalendarDay(value), false, `expected "${value}" to be rejected`);
  }
});

test("non-string types are safely rejected without throwing", () => {
  const nonStrings = [
    undefined,
    null,
    12345,
    0,
    NaN,
    true,
    false,
    {},
    [],
    new Date("2026-10-14T00:00:00Z"),
  ];

  for (const value of nonStrings) {
    assert.equal(isCalendarDay(value), false, `expected non-string to be rejected`);
  }
});
