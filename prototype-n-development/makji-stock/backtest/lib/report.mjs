function finite(values) {
  return values.filter(Number.isFinite);
}

function average(values) {
  const numbers = finite(values);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function median(values) {
  const numbers = finite(values).sort((a, b) => a - b);
  if (!numbers.length) return null;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

function rounded(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

export function summarizeProduct(product, rows) {
  const calculated = rows.filter((row) => row.status === "calculated");
  const marketClosedAfternoons = rows.filter(
    (row) => row.status === "held" && row.reason === "missing-today-open",
  );
  const unexpectedMissing = rows.filter(
    (row) => row.status !== "calculated" && row.reason !== "missing-today-open",
  );
  const morning = calculated.filter((row) => row.priceSession === "MORNING_0600");
  const afternoon = calculated.filter((row) => row.priceSession === "AFTERNOON_1600");
  const prices = calculated.map((row) => row.priceWon);
  const discounts = calculated.map((row) => row.discountPct);
  const moves = calculated.map((row) => row.priceChangePct);
  return {
    id: product.id,
    ticker: product.ticker,
    name: product.name,
    requestedDays: rows.length,
    calculatedDays: calculated.length,
    missingDays: rows.length - calculated.length,
    missingSignalDates: rows
      .filter((row) => row.status !== "calculated")
      .map((row) => `${row.publishDate}:${row.priceSession}`),
    requestedSessions: rows.length,
    calculatedSessions: calculated.length,
    heldSessions: rows.filter((row) => row.status === "held").length,
    unavailableSessions: rows.filter((row) => row.status === "unavailable").length,
    marketClosedAfternoonSessions: marketClosedAfternoons.length,
    unexpectedMissingSessions: unexpectedMissing.length,
    unexpectedMissingKeys: unexpectedMissing.map(
      (row) => `${row.publishDate}:${row.priceSession}:${row.reason}`,
    ),
    calculatedMorningSessions: morning.length,
    calculatedAfternoonSessions: afternoon.length,
    averageSearchRatio: rounded(average(calculated.map((row) => row.searchRatio))),
    averageDiscountPct: rounded(average(discounts)),
    medianDiscountPct: rounded(median(discounts)),
    minDiscountPct: discounts.length ? rounded(Math.min(...discounts)) : null,
    maxDiscountPct: discounts.length ? rounded(Math.max(...discounts)) : null,
    surchargeSessions: discounts.filter((value) => value < 0).length,
    discountCapHits: discounts.filter(
      (value) => value === 38,
    ).length,
    averageAbsDailyMovePct: rounded(average(finite(moves).map(Math.abs))),
    averageAbsSessionMovePct: rounded(average(finite(moves).map(Math.abs))),
    averageAbsMorningMovePct: rounded(
      average(finite(morning.map((row) => row.priceChangePct)).map(Math.abs)),
    ),
    averageAbsAfternoonMovePct: rounded(
      average(finite(afternoon.map((row) => row.priceChangePct)).map(Math.abs)),
    ),
    minPriceWon: prices.length ? Math.min(...prices) : null,
    maxPriceWon: prices.length ? Math.max(...prices) : null,
  };
}

export function summarizeOverall(rows, pricing) {
  const calculated = rows.filter((row) => row.status === "calculated");
  const discounts = calculated.map((row) => row.discountPct);
  const moves = finite(calculated.map((row) => row.priceChangePct)).map(Math.abs);
  const mornings = new Map(
    calculated
      .filter((row) => row.priceSession === "MORNING_0600")
      .map((row) => [`${row.publishDate}:${row.productId}`, row.priceWon]),
  );
  const afternoonComparisons = calculated
    .filter((row) => row.priceSession === "AFTERNOON_1600")
    .map((row) => row.priceWon - mornings.get(`${row.publishDate}:${row.productId}`))
    .filter(Number.isFinite);

  return {
    calculatedSessions: calculated.length,
    averageDiscountPct: rounded(average(discounts)),
    medianDiscountPct: rounded(median(discounts)),
    minDiscountPct: discounts.length ? rounded(Math.min(...discounts)) : null,
    maxDiscountPct: discounts.length ? rounded(Math.max(...discounts)) : null,
    surchargeSessions: discounts.filter((value) => value < 0).length,
    surchargeSessionPct: calculated.length
      ? rounded((discounts.filter((value) => value < 0).length / calculated.length) * 100, 1)
      : null,
    discountCapHits: discounts.filter((value) => value === pricing.discountCapPct).length,
    averageAbsSessionMovePct: rounded(average(moves)),
    maxAbsSessionMovePct: moves.length ? rounded(Math.max(...moves)) : null,
    afternoonHigher: afternoonComparisons.filter((value) => value > 0).length,
    afternoonLower: afternoonComparisons.filter((value) => value < 0).length,
    afternoonSame: afternoonComparisons.filter((value) => value === 0).length,
  };
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function rowsToCsv(rows) {
  const fields = [
    "publishDate", "publishTimeKst", "priceSession", "searchSignalDate", "ticker",
    "productName", "status", "searchRatio", "previousSearchRatio", "searchChangePoint", "fxReference", "fxPreviousDate",
    "fxPreviousRate", "fxRateDate", "fxRate", "fxDeclinePct", "fxCarriedForward",
    "searchCouponPct", "fxRawAdjustmentPct", "fxAdjustmentPct", "rawDiscountPct", "discountPct", "basePriceWon", "priceWon",
    "previousPriceWon", "priceChangePct", "reason",
  ];
  return [
    fields.join(","),
    ...rows.map((row) => fields.map((field) => csvEscape(row[field])).join(",")),
  ].join("\n") + "\n";
}

export function markdownReport(report) {
  const lines = [
    "# MAKJI 가격 백테스트 결과",
    "",
    `- 실행 시작: ${report.run.startedAtKst}`,
    `- 실행 종료: ${report.run.finishedAtKst}`,
    `- 총 소요 시간: ${report.run.elapsedMs}ms`,
    `- 데이터 기간: ${report.period.startDate} ~ ${report.period.endDate} (${report.period.days}일)`,
    `- 네이버 호출: 상품별 1회, 총 ${report.apiCalls.filter((call) => call.provider.startsWith("NAVER_")).length}회`,
    `- 환율 호출: ${report.apiCalls.filter((call) => call.provider === "BOK_ECOS").length}회`,
    `- 환율 원천: 한국은행 ECOS ${report.policy.fxSeries.join(", ")}`,
    "- 오전 06:00: D-1 이하 최근 영업일의 시가와 종가를 비교",
    "- 오후 16:00: D 당일 시가와 D-1 이하 최근 종가를 비교",
    `- 검색 쿠폰: 검색지수 × ${report.policy.pricing.searchWeight}`,
    `- 환율 조정: clamp(환율하락률 × ${report.policy.pricing.fxWeight} × ${report.policy.pricing.fxScale}, -${report.policy.pricing.fxSurchargeCapPct}, +${report.policy.pricing.fxDiscountCapPct})`,
    `- 총 할인율: min(${report.policy.pricing.discountCapPct}, 검색 쿠폰 + 환율 조정)`,
    `- 판매가: 정가 × (1 - 총 할인율/100), ${report.policy.pricing.priceRoundingWon}원 단위 반올림`,
    `- 가격 범위: 정가 대비 최대 ${report.policy.pricing.discountCapPct}% 할인, 이론상 최대 ${report.policy.pricing.fxSurchargeCapPct}% 할증`,
    "",
    "## 전체 결과",
    "",
    `- 계산 세션: ${report.overall.calculatedSessions}개`,
    `- 평균 할인율: ${report.overall.averageDiscountPct}% (목표 10% 대비 ${(report.overall.averageDiscountPct - 10).toFixed(2)}%p)`,
    `- 중앙 할인율: ${report.overall.medianDiscountPct}%`,
    `- 관측 할인율 범위: ${report.overall.minDiscountPct}% ~ ${report.overall.maxDiscountPct}%`,
    `- 할증 세션: ${report.overall.surchargeSessions}개 (${report.overall.surchargeSessionPct}%)`,
    `- 38% 할인 상한 도달: ${report.overall.discountCapHits}회`,
    `- 평균/최대 절대 세션등락: ${report.overall.averageAbsSessionMovePct}% / ${report.overall.maxAbsSessionMovePct}%`,
    `- 오후가가 오전가보다 높음/낮음/같음: ${report.overall.afternoonHigher}/${report.overall.afternoonLower}/${report.overall.afternoonSame}개`,
    "",
    "## 상품별 결과",
    "",
    "| 상품 | 계산 세션 | 오전/오후 | 검색지수 평균 | 할인율 평균 | 할인율 범위 | 할증 세션 | 평균 절대 세션등락 | 오전등락 | 오후등락 | 가격 범위 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...report.products.map((product) =>
      `| ${product.name} | ${product.calculatedSessions}/${product.requestedSessions} | ${product.calculatedMorningSessions}/${product.calculatedAfternoonSessions} | ${product.averageSearchRatio ?? "-"} | ${product.averageDiscountPct ?? "-"}% | ${product.minDiscountPct ?? "-"}~${product.maxDiscountPct ?? "-"}% | ${product.surchargeSessions} | ${product.averageAbsSessionMovePct ?? "-"}% | ${product.averageAbsMorningMovePct ?? "-"}% | ${product.averageAbsAfternoonMovePct ?? "-"}% | ${product.minPriceWon?.toLocaleString() ?? "-"}~${product.maxPriceWon?.toLocaleString() ?? "-"}원 |`,
    ),
    "",
    "## 데이터 커버리지",
    "",
    `- 당일 시가가 없는 주말·휴일 오후 ${report.products[0]?.marketClosedAfternoonSessions ?? 0}개 세션은 오전 가격을 유지했습니다.`,
    ...(report.products.some((product) => product.unexpectedMissingSessions > 0)
      ? report.products
          .filter((product) => product.unexpectedMissingSessions > 0)
          .map(
            (product) =>
              `- ${product.name}: 예상 밖 누락 ${product.unexpectedMissingSessions}개 (${product.unexpectedMissingKeys.join(", ")})`,
          )
      : ["- 검색지수와 영업일 환율 데이터의 예상 밖 누락은 없습니다."]),
    "",
    "## API 호출 시간",
    "",
    "| 공급자 | 호출 | 시작(KST) | 종료(KST) | 소요 | 관측일 |",
    "|---|---|---|---|---:|---:|",
    ...report.apiCalls.map((call) =>
      `| ${call.provider} | ${call.label} | ${call.startedAtKst} | ${call.finishedAtKst} | ${call.elapsedMs}ms | ${call.observedDays ?? "-"} |`,
    ),
    "",
    "> 네이버 지수는 상품별 요청 안에서 독립적으로 0~100 정규화됩니다. 서로 다른 상품의 지수 크기를 절대 검색량처럼 직접 비교하면 안 됩니다.",
    "",
  ];
  return lines.join("\n");
}
