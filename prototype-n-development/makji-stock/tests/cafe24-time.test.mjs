import assert from "node:assert/strict";
import test from "node:test";

/* lib/cafe24/client.ts 의 parseCafe24Time 과 같은 규칙.
   TS 파일을 직접 import 할 수 없어 규칙만 옮겨 고정한다. */
function parseCafe24Time(value) {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim());
  return new Date(hasZone ? value : `${value.trim()}+09:00`);
}

test("타임존이 없는 Cafe24 시각은 KST 로 읽는다", () => {
  // 실제 응답 형태. 발급 04:52:51Z 기준 2시간 뒤여야 한다.
  const issued = new Date("2026-09-19T04:52:51.000Z");
  const parsed = parseCafe24Time("2026-09-19T15:52:50.000");
  const hours = (parsed.getTime() - issued.getTime()) / 3600000;
  assert.ok(Math.abs(hours - 2) < 0.01, `2시간이어야 하는데 ${hours}시간`);
});

test("refresh_token 은 14일", () => {
  const issued = new Date("2026-09-19T04:52:51.000Z");
  const parsed = parseCafe24Time("2026-10-03T13:52:50.000");
  const days = (parsed.getTime() - issued.getTime()) / 86400000;
  assert.ok(Math.abs(days - 14) < 0.01, `14일이어야 하는데 ${days}일`);
});

test("타임존이 이미 있으면 그대로 쓴다", () => {
  assert.equal(
    parseCafe24Time("2026-09-19T15:52:50Z").toISOString(),
    "2026-09-19T15:52:50.000Z",
  );
  assert.equal(
    parseCafe24Time("2026-09-19T15:52:50+09:00").toISOString(),
    "2026-09-19T06:52:50.000Z",
  );
});
