import assert from "node:assert/strict";
import test from "node:test";
import { CAFE24_OPTION_PRICES } from "../config/cafe24-option-prices.ts";
import {
  assertCompleteVariantPricePlan,
  buildVariantPricePlan,
  discountedOptionPrice,
  variantUpdateRequestBody,
} from "../lib/pricing/variant-pricing.ts";

const variants = (...values) =>
  values.map((value, index) => ({
    variant_code: `V${index + 1}`,
    options: [{ name: "옵션", value }],
    additional_amount: "0.00",
  }));

test("실제 옵션 정가 19개를 모두 보존한다", () => {
  assert.equal(Object.values(CAFE24_OPTION_PRICES).flat().length, 19);
});

test("옵션 총액에 같은 할인율을 적용한 뒤 대표 판매가와의 차이를 추가금으로 만든다", () => {
  const definitions = CAFE24_OPTION_PRICES.morning_roll;
  const plan = buildVariantPricePlan({
    variants: variants(...definitions.map((definition) => definition.optionValue)),
    definitions,
    productSalePriceWon: 3_150,
    discountPct: 30,
  });

  assert.deepEqual(
    plan.updates.map(({ salePriceWon, additionalAmountWon }) => ({
      salePriceWon,
      additionalAmountWon,
    })),
    [
      { salePriceWon: 3_150, additionalAmountWon: 0 },
      { salePriceWon: 8_540, additionalAmountWon: 5_390 },
      { salePriceWon: 13_440, additionalAmountWon: 10_290 },
    ],
  );
  assert.doesNotThrow(() => assertCompleteVariantPricePlan(plan));
});

test("할인율 소수점까지 계산하고 마지막에 10원 단위로 반올림한다", () => {
  assert.equal(discountedOptionPrice(13_700, 15, 10), 11_650);
  assert.equal(discountedOptionPrice(25_900, 17.35, 10), 21_410);
});

test("정가 리셋은 옵션 추가금도 원래 값으로 복원한다", () => {
  const plan = buildVariantPricePlan({
    variants: variants(
      "피칸 휘낭시에 냉동생지",
      "초코 휘낭시에 냉동생지",
      "스콘 냉동생지 (+4,000원)",
    ),
    definitions: CAFE24_OPTION_PRICES.gluten_free_frozen_dough_set,
    productSalePriceWon: 21_000,
    discountPct: 0,
  });

  assert.deepEqual(
    plan.updates.map((update) => update.additionalAmountWon),
    [0, 0, 4_000],
  );
  assert.doesNotThrow(() => assertCompleteVariantPricePlan(plan));
});

test("옵션 이름이 빠지거나 예상 밖 옵션이 있으면 대표가 반영 전에 실패시킨다", () => {
  const definitions = CAFE24_OPTION_PRICES.morning_roll;
  const plan = buildVariantPricePlan({
    variants: variants(definitions[0].optionValue, "몰에만 있는 옵션"),
    definitions,
    productSalePriceWon: 3_150,
    discountPct: 30,
  });

  assert.deepEqual(
    plan.missingOptionValues,
    definitions.slice(1).map((definition) => definition.optionValue),
  );
  assert.deepEqual(plan.unmatchedVariantValues, ["몰에만 있는 옵션"]);
  assert.throws(() => assertCompleteVariantPricePlan(plan), /옵션 매핑 불일치/);
});

test("Cafe24 bulk variants 요청은 shop_no와 variant_code별 추가금을 보낸다", () => {
  const plan = buildVariantPricePlan({
    variants: variants("피칸", "코코넛", "초코"),
    definitions: CAFE24_OPTION_PRICES.gluten_free_financier,
    productSalePriceWon: 3_040,
    discountPct: 20,
  });
  assert.deepEqual(variantUpdateRequestBody(1, plan.updates), {
    shop_no: 1,
    requests: [
      { variant_code: "V1", additional_amount: "0" },
      { variant_code: "V2", additional_amount: "0" },
      { variant_code: "V3", additional_amount: "0" },
    ],
  });
});
