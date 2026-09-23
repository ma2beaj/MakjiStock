export type OptionPriceDefinition = {
  optionValue: string;
  listPriceWon: number;
};

export type Cafe24Variant = {
  variant_code: string;
  options?: { name?: string; value?: string }[] | null;
  additional_amount?: string;
};

export type VariantPriceUpdate = {
  variantCode: string;
  optionValue: string;
  listPriceWon: number;
  salePriceWon: number;
  additionalAmountWon: number;
};

export type VariantPricePlan = {
  updates: VariantPriceUpdate[];
  missingOptionValues: string[];
  unmatchedVariantValues: string[];
};

/** 표시용 괄호·공백 같은 차이는 무시하되, 한글·영문·숫자·%는 보존한다. */
export function normalizeOptionValue(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^0-9a-z가-힣%]/g, "");
}

export function roundWon(value: number, unit = 10): number {
  return Math.round(value / unit) * unit;
}

export function discountedOptionPrice(
  listPriceWon: number,
  discountPct: number,
  roundingWon = 10,
): number {
  return roundWon(listPriceWon * (1 - discountPct / 100), roundingWon);
}

function variantValue(variant: Cafe24Variant): string | null {
  const values = (variant.options ?? [])
    .map((option) => option.value?.trim())
    .filter((value): value is string => Boolean(value));
  return values.length > 0 ? values.join(" / ") : null;
}

/**
 * 옵션의 최종 판매가를 먼저 계산한 뒤, Cafe24가 요구하는 추가금으로 바꾼다.
 * 추가금 자체에 할인율을 곱하면 세트 옵션의 원래 정가 할인이 깨지므로 그렇게 하지 않는다.
 */
export function buildVariantPricePlan({
  variants,
  definitions,
  productSalePriceWon,
  discountPct,
  roundingWon = 10,
}: {
  variants: readonly Cafe24Variant[];
  definitions: readonly OptionPriceDefinition[];
  productSalePriceWon: number;
  discountPct: number;
  roundingWon?: number;
}): VariantPricePlan {
  const definitionsByKey = new Map(
    definitions.map((definition) => [normalizeOptionValue(definition.optionValue), definition]),
  );
  if (definitionsByKey.size !== definitions.length) {
    throw new Error("옵션 정가 설정에 정규화 후 이름이 같은 항목이 있습니다.");
  }
  const matchedKeys = new Set<string>();
  const updates: VariantPriceUpdate[] = [];
  const unmatchedVariantValues: string[] = [];

  for (const variant of variants) {
    const displayValue = variantValue(variant);
    let definition: OptionPriceDefinition | undefined;

    if (displayValue) {
      definition = definitionsByKey.get(normalizeOptionValue(displayValue));
      if (!definition) {
        const matches = (variant.options ?? [])
          .map((option) => definitionsByKey.get(normalizeOptionValue(option.value ?? "")))
          .filter((item): item is OptionPriceDefinition => Boolean(item));
        if (matches.length === 1) definition = matches[0];
      }
    } else if (variants.length === 1 && definitions.length === 1) {
      // Cafe24는 옵션 없는 단일 상품도 variant 한 개를 반환한다.
      definition = definitions[0];
    }

    if (!definition) {
      unmatchedVariantValues.push(displayValue ?? `(옵션 없음: ${variant.variant_code})`);
      continue;
    }

    const key = normalizeOptionValue(definition.optionValue);
    if (matchedKeys.has(key)) {
      unmatchedVariantValues.push(`${displayValue ?? variant.variant_code} (중복)`);
      continue;
    }
    matchedKeys.add(key);

    const salePriceWon = discountedOptionPrice(
      definition.listPriceWon,
      discountPct,
      roundingWon,
    );
    updates.push({
      variantCode: variant.variant_code,
      optionValue: definition.optionValue,
      listPriceWon: definition.listPriceWon,
      salePriceWon,
      additionalAmountWon: salePriceWon - productSalePriceWon,
    });
  }

  return {
    updates,
    missingOptionValues: definitions
      .filter((definition) => !matchedKeys.has(normalizeOptionValue(definition.optionValue)))
      .map((definition) => definition.optionValue),
    unmatchedVariantValues,
  };
}

export function assertCompleteVariantPricePlan(plan: VariantPricePlan): void {
  if (plan.missingOptionValues.length === 0 && plan.unmatchedVariantValues.length === 0) return;
  const details = [
    plan.missingOptionValues.length > 0
      ? `Cafe24에서 못 찾은 설정 옵션: ${plan.missingOptionValues.join(", ")}`
      : null,
    plan.unmatchedVariantValues.length > 0
      ? `정가 설정이 없는 Cafe24 옵션: ${plan.unmatchedVariantValues.join(", ")}`
      : null,
  ].filter(Boolean);
  throw new Error(`옵션 매핑 불일치 — ${details.join(" / ")}`);
}

export function variantUpdateRequestBody(shopNo: number, updates: readonly VariantPriceUpdate[]) {
  return {
    shop_no: shopNo,
    requests: updates.map((update) => ({
      variant_code: update.variantCode,
      additional_amount: String(update.additionalAmountWon),
    })),
  };
}
