import assert from "node:assert/strict";
import test from "node:test";
import { cls, discMark } from "../lib/bread-market/engine.ts";

/* 시세표·상단 티커의 할인율 앞 기호. 숫자는 정가 대비 할인율(늘 0 이상)이고
   어제 대비 등락은 색이 말한다. 화살표까지 등락 방향으로 돌리면 "▲ 6.3%" 가
   "6.3% 올랐다" 로 읽혀 두 기준이 한 자리에서 섞인다. */

test("할인율 앞 화살표는 오르든 내리든 아래를 가리킨다", () => {
  assert.equal(discMark(2.3), "▼", "가격이 올라도 숫자는 정가에서 내려온 폭이다");
  assert.equal(discMark(-1.8), "▼");
  assert.equal(discMark(12), "▼");
  assert.equal(discMark(-12), "▼");
});

test("어제와 같은 날만 —", () => {
  assert.equal(discMark(0), "—");
  assert.equal(discMark(0.04), "—", "cls 의 보합 문턱(0.049) 을 같이 쓴다");
  assert.equal(discMark(-0.04), "—");
});

/* 색은 cls 가 정한다. 문턱이 갈리면 "▼ 인데 회색" 같은 칸이 생긴다. */
test("— 와 회색은 같은 값에서 갈린다", () => {
  for (const v of [-3, -0.05, -0.048, 0, 0.048, 0.05, 3]) {
    assert.equal(discMark(v) === "—", cls(v) === "flat", `${v} 에서 기호와 색이 어긋난다`);
  }
});
