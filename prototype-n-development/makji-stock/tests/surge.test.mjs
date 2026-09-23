import assert from "node:assert/strict";
import test from "node:test";

/* lib/bread-market/engine.ts 의 surgeOf 와 같은 규칙.
   검색지수는 상품마다 자기 90일 최고치를 100 으로 잡은 상댓값이라
   87 과 44 를 "누가 더 검색됐나"로 읽으면 안 된다 (PRD §7).
   변화량은 자기 자신과의 비교라 이 문제가 없다. */
function surgeOf(rows) {
  const risen = rows.filter((r) => r.searchChange > 0);
  if (risen.length === 0) return null;
  return risen.sort((a, b) => b.searchChange - a.searchChange)[0];
}

test("전일 대비 가장 많이 오른 종을 고른다", () => {
  const r = surgeOf([
    { tk: "SCN", searchIdx: 47.1, searchChange: 8.9 },
    { tk: "GFD", searchIdx: 46.9, searchChange: 0.9 },
    { tk: "FNC", searchIdx: 88.3, searchChange: -1.2 },
  ]);
  assert.equal(r.tk, "SCN");
});

test("검색지수가 높아도 안 올랐으면 급등주가 아니다", () => {
  // FNC 는 지수 88 로 가장 높지만 내렸다. 지수 크기로 뽑으면 안 된다.
  const r = surgeOf([
    { tk: "FNC", searchIdx: 88.3, searchChange: -1.2 },
    { tk: "GFD", searchIdx: 46.9, searchChange: 0.9 },
  ]);
  assert.equal(r.tk, "GFD");
});

test("아무도 안 올랐으면 배지가 없다", () => {
  assert.equal(
    surgeOf([
      { tk: "FNC", searchIdx: 88.3, searchChange: -1.2 },
      { tk: "MRL", searchIdx: 52.8, searchChange: -8.7 },
    ]),
    null,
  );
});

test("보합(0)은 오른 것이 아니다", () => {
  assert.equal(surgeOf([{ tk: "MUF", searchIdx: 61, searchChange: 0 }]), null);
});
