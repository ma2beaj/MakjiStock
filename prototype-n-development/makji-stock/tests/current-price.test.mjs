import assert from "node:assert/strict";
import test from "node:test";
import { priceSlots } from "../lib/pricing/current-price.ts";

/* 잠금·예측이 기준가를 어디서 찾는지 정하는 순서.
   화면(engine.ts quoteAt)과 어긋나면 화면에 뜬 가격과 서버가 잠그는 가격이 달라진다. */

test("오전장은 그날 오전가만 본다 — 전날로 거슬러 올라가지 않는다", () => {
  /* 몰은 02:00 에 정가로 되돌아간다. 오전가가 아직 없는 시간에 전날 가격을
     끌어오면 몰은 정가로 받는데 잠금·예측은 더 싼 값으로 잡힌다. */
  assert.deepEqual(priceSlots("2026-09-20", "am"), [
    { date: "2026-09-20", session: "am" },
  ]);
});

test("오후장은 그날 오후가 → 그날 오전가 — 주말은 오후 PUT 이 없어 몰이 오전가를 들고 있다", () => {
  assert.deepEqual(priceSlots("2026-09-20", "pm"), [
    { date: "2026-09-20", session: "pm" },
    { date: "2026-09-20", session: "am" },
  ]);
});

test("어느 세션이든 다른 날짜는 보지 않는다", () => {
  for (const session of ["am", "pm"]) {
    for (const slot of priceSlots("2026-09-20", session)) {
      assert.equal(slot.date, "2026-09-20");
    }
  }
});

test("오전장은 같은 날 오후가를 보지 않는다 — 06:00 에 오후가는 아직 없다", () => {
  assert.ok(priceSlots("2026-09-20", "am").every((s) => s.session !== "pm"));
});
