import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ECOS_USD_KRW_OPEN,
  parseEcosClosingRates,
  parseEcosRates,
} from "../../lib/pricing/fx.mjs";
import { fetchTrendsSeparately } from "../../lib/pricing/naver.mjs";
import {
  buildSessionFxSignals,
  calculateDay,
  simulateProductSessions,
} from "../../lib/pricing/pricing.mjs";

const pricing = {
  fxWeight: 0.28,
  searchWeight: 0.1,
  fxScale: 50,
  fxDiscountCapPct: 28,
  fxSurchargeCapPct: 28,
  discountCapPct: 38,
  priceRoundingWon: 10,
};

test("검색 절댓값 쿠폰과 환율 조정을 합산한다", () => {
  const result = calculateDay({
    searchRatio: 80,
    fxDeclinePct: -0.5,
    basePriceWon: 10000,
    pricing,
  });
  assert.equal(result.searchCouponPct, 8);
  assert.equal(result.fxAdjustmentPct, -7.000000000000001);
  assert.equal(result.discountPct, 0.9999999999999991);
  assert.equal(result.priceWon, 9900);

  const cheaper = calculateDay({
    searchRatio: 80,
    fxDeclinePct: 0.5,
    basePriceWon: 10000,
    pricing,
  });
  assert.equal(cheaper.discountPct, 15);
  assert.equal(cheaper.priceWon, 8500);
});

test("총 할인은 38%, 환율 조정은 ±28%p로 제한한다", () => {
  const result = calculateDay({
    searchRatio: 100,
    fxDeclinePct: 3,
    basePriceWon: 10000,
    pricing,
  });
  assert.equal(result.discountPct, 38);
  assert.equal(result.priceWon, 6200);

  const surcharge = calculateDay({
    searchRatio: 50,
    fxDeclinePct: -3,
    basePriceWon: 10000,
    pricing,
  });
  assert.equal(surcharge.discountPct, -23);
  assert.equal(surcharge.priceWon, 12300);
});

test("ECOS 응답에서 원/달러 15:30 종가만 시계열로 만든다", () => {
  assert.deepEqual(
    parseEcosClosingRates({
      StatisticSearch: {
        row: [
          { TIME: "20260901", ITEM_CODE1: "0000003", DATA_VALUE: "1380.5" },
          { TIME: "20260902", ITEM_CODE1: "0000003", DATA_VALUE: "1379.2" },
          { TIME: "20260902", ITEM_CODE1: "0000002", DATA_VALUE: "1381.0" },
        ],
      },
    }),
    { "2026-09-01": 1380.5, "2026-09-02": 1379.2 },
  );
});

test("ECOS 응답에서 원/달러 시가만 시계열로 만든다", () => {
  assert.deepEqual(
    parseEcosRates({
      StatisticSearch: {
        row: [
          { TIME: "20260901", ITEM_CODE1: "0000002", DATA_VALUE: "1382.5" },
          { TIME: "20260901", ITEM_CODE1: "0000003", DATA_VALUE: "1380.5" },
        ],
      },
    }, ECOS_USD_KRW_OPEN),
    { "2026-09-01": 1382.5 },
  );
});

/* 두 장이 시간을 이어 덮는다 — 전영업일 시가 →[오전]→ 전영업일 종가 →[오후]→ 당일 시가.
   구간이 겹치면 같은 환율 움직임이 이틀에 걸쳐 두 번 가격에 반영된다. */
test("오전은 전영업일 시가와 종가를, 오후는 그 종가와 당일 시가를 비교한다", () => {
  const signals = buildSessionFxSignals({
    closesByDate: {
      "2026-09-11": 1390,
      "2026-09-14": 1380,
      "2026-09-15": 1370,
      "2026-09-16": 1300,
    },
    opensByDate: { "2026-09-14": 1395, "2026-09-15": 1375 },
    publishDates: ["2026-09-15"],
  });

  assert.deepEqual(signals["2026-09-15"].morning, {
    reference: "PREVIOUS_OPEN_TO_PREVIOUS_CLOSE",
    previousDate: "2026-09-14",
    previousRate: 1395,
    currentDate: "2026-09-14",
    currentRate: 1380,
    declinePct: ((1395 - 1380) / 1395) * 100,
    carriedForward: false,
  });
  assert.deepEqual(signals["2026-09-15"].afternoon, {
    reference: "PREVIOUS_CLOSE_TO_TODAY_OPEN",
    previousDate: "2026-09-14",
    previousRate: 1380,
    currentDate: "2026-09-15",
    currentRate: 1375,
    declinePct: ((1380 - 1375) / 1380) * 100,
    carriedForward: false,
  });
});

test("당일 시가가 없는 날의 오후 세션은 오전 가격을 유지한다", () => {
  const publishDates = ["2026-09-15"];
  /* 주말 모습 그대로 — 전영업일 시가는 있고 당일 시가만 없다.
     오전장은 전영업일 안에서 끝나므로 그대로 나온다. */
  const fxSignals = buildSessionFxSignals({
    closesByDate: { "2026-09-11": 1390, "2026-09-14": 1380 },
    opensByDate: { "2026-09-14": 1395 },
    publishDates,
  });
  const rows = simulateProductSessions({
    product: { id: "sample", ticker: "SMP", name: "샘플", basePriceWon: 10000 },
    pricing,
    publishDates,
    trends: { "2026-09-13": 45, "2026-09-14": 40 },
    fxSignals,
  });

  assert.equal(rows[0].priceSession, "MORNING_0600");
  assert.equal(rows[0].status, "calculated");
  assert.equal(rows[1].priceSession, "AFTERNOON_1600");
  assert.equal(rows[1].status, "held");
  assert.equal(rows[1].reason, "missing-today-open");
  assert.equal(rows[1].priceWon, rows[0].priceWon);
});

test("네이버는 상품을 합치지 않고 상품당 그룹 1개로 각각 호출한다", async () => {
  process.env.NAVER_CLIENT_ID = "test-id";
  process.env.NAVER_CLIENT_SECRET = "test-secret";
  const bodies = [];
  const products = [
    { id: "one", ticker: "ONE", keywords: ["하나"] },
    { id: "two", ticker: "TWO", keywords: ["둘", "두번째"] },
  ];
  const fetchImpl = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({
        results: [{ data: [{ period: "2026-09-01", ratio: 100 }] }],
      }),
    };
  };

  const result = await fetchTrendsSeparately({
    products,
    startDate: "2026-09-01",
    endDate: "2026-09-02",
    fetchImpl,
    log: () => {},
  });

  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies.map((body) => body.keywordGroups.length), [1, 1]);
  assert.deepEqual(bodies[0].keywordGroups[0], {
    groupName: "ONE",
    keywords: ["하나"],
  });
  assert.deepEqual(bodies[1].keywordGroups[0], {
    groupName: "TWO",
    keywords: ["둘", "두번째"],
  });
  assert.deepEqual(result.seriesByProduct.one, { "2026-09-01": 100 });
});

test("상품 6종을 각각 독립된 네이버 요청으로 호출한다", async () => {
  process.env.NAVER_CLIENT_ID = "test-id";
  process.env.NAVER_CLIENT_SECRET = "test-secret";
  const config = JSON.parse(
    await readFile(new URL("../config.json", import.meta.url), "utf8"),
  );
  const bodies = [];
  const fetchImpl = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({
        results: [{ data: [{ period: "2026-09-01", ratio: 100 }] }],
      }),
    };
  };

  await fetchTrendsSeparately({
    products: config.products,
    startDate: "2026-09-01",
    endDate: "2026-09-02",
    fetchImpl,
    log: () => {},
  });

  assert.equal(config.products.length, 6);
  assert.equal(bodies.length, 6);
  assert.deepEqual(bodies.map((body) => body.keywordGroups.length), [1, 1, 1, 1, 1, 1]);
  const frozenDough = config.products.find(
    (product) => product.id === "gluten_free_frozen_dough_set",
  );
  assert.equal(frozenDough.basePriceWon, 21000);
  assert.equal(frozenDough.keywords.length, 20);
  assert.deepEqual(bodies[5].keywordGroups[0], {
    groupName: "GFD",
    keywords: frozenDough.keywords,
  });
});

test("할증은 discountFloorPct에서 멈춘다", () => {
  const pricing = {
    searchWeight: 0.13, fxWeight: 0.28, fxScale: 50,
    fxDiscountCapPct: 28, fxSurchargeCapPct: 28,
    discountCapPct: 38, discountFloorPct: -10, priceRoundingWon: 10,
  };
  // 검색 0 + 환율 대폭 상승 → 하한 -10%에서 멈춰야 한다 (정가의 110%)
  const surge = calculateDay({ searchRatio: 0, fxDeclinePct: -2, basePriceWon: 4500, pricing });
  assert.equal(surge.discountPct, -10);
  assert.equal(surge.priceWon, 4950);

  // 상한은 그대로 38%
  const deep = calculateDay({ searchRatio: 100, fxDeclinePct: 2, basePriceWon: 4500, pricing });
  assert.equal(deep.discountPct, 38);

  // floor 미지정이면 기존 동작(하한 없음)을 유지한다
  const legacy = calculateDay({
    searchRatio: 0, fxDeclinePct: -2, basePriceWon: 4500,
    pricing: { ...pricing, discountFloorPct: undefined },
  });
  assert.equal(legacy.discountPct, -28);
});

/* 오전장의 끝점과 오후장의 시작점이 같아야 구간이 이어진다. */
test("오전장 끝과 오후장 시작이 같은 값이다", () => {
  const signals = buildSessionFxSignals({
    closesByDate: { "2026-09-14": 1380, "2026-09-15": 1370 },
    opensByDate: { "2026-09-14": 1395, "2026-09-15": 1375 },
    publishDates: ["2026-09-15"],
  });
  const { morning, afternoon } = signals["2026-09-15"];
  assert.equal(morning.currentRate, afternoon.previousRate);
  assert.equal(morning.currentDate, afternoon.previousDate);
});

/* 전영업일 시가가 없으면 오전장을 만들지 않는다 — 없는 값으로 짐작해 가격을 내보내지 않는다. */
test("전영업일 시가가 없으면 오전 세션이 없다", () => {
  const signals = buildSessionFxSignals({
    closesByDate: { "2026-09-14": 1380 },
    opensByDate: { "2026-09-15": 1375 },
    publishDates: ["2026-09-15"],
  });
  assert.equal(signals["2026-09-15"].morning, null);
  assert.ok(signals["2026-09-15"].afternoon, "오후는 그대로 나온다");
});
