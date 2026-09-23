import assert from "node:assert/strict";
import test from "node:test";

/* lib/cafe24/client.ts 의 cafe24ShopNo 와 같은 규칙.
   Cafe24 는 shop_no=0 에 오류가 아니라 빈 목록을 돌려주므로 조용히 실패한다. */
const shopNo = (raw) => Number(raw) || 1;

test("빈 값·미설정·0 은 1 로 떨어진다", () => {
  for (const bad of ["", undefined, null, "0", 0, "  ", "abc", NaN]) {
    assert.equal(shopNo(bad), 1, `${JSON.stringify(bad)} → 1 이어야 함`);
  }
});

test("정상 값은 그대로 쓴다", () => {
  assert.equal(shopNo("1"), 1);
  assert.equal(shopNo("2"), 2);
  assert.equal(shopNo(3), 3);
});

test("?? 만 쓰면 빈 문자열이 0 이 된다 (이 버그를 막는다)", () => {
  assert.equal(Number("" ?? 1), 0);
  assert.equal(shopNo(""), 1);
});
