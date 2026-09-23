import { requireEnv } from "./env.mjs";
import { timedCall } from "./time.mjs";

const PROVIDERS = {
  hub: {
    endpoint: "https://naverapihub.apigw.ntruss.com/search-trend/v1/search",
    idHeader: "X-NCP-APIGW-API-KEY-ID",
    secretHeader: "X-NCP-APIGW-API-KEY",
  },
  openapi: {
    endpoint: "https://openapi.naver.com/v1/datalab/search",
    idHeader: "X-Naver-Client-Id",
    secretHeader: "X-Naver-Client-Secret",
  },
};

function pointsToMap(result) {
  return Object.fromEntries(
    (result?.data ?? []).map((point) => [point.period, Number(point.ratio)]),
  );
}

export async function fetchTrendsSeparately({
  products,
  startDate,
  endDate,
  provider = process.env.NAVER_PROVIDER || "hub",
  fetchImpl = fetch,
  log,
}) {
  const providerConfig = PROVIDERS[provider];
  if (!providerConfig) {
    throw new Error(`NAVER_PROVIDER는 hub 또는 openapi여야 합니다: ${provider}`);
  }
  const clientId = requireEnv("NAVER_CLIENT_ID");
  const clientSecret = requireEnv("NAVER_CLIENT_SECRET");
  const seriesByProduct = {};
  const rawByProduct = {};
  const timings = [];

  for (const product of products) {
    const { value: payload, timing } = await timedCall({
      provider: provider === "hub" ? "NAVER_API_HUB" : "NAVER_OPENAPI",
      label: `${product.ticker} (${product.keywords.length} keywords, 1 group)`,
      log,
      call: async () => {
        const response = await fetchImpl(providerConfig.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [providerConfig.idHeader]: clientId,
            [providerConfig.secretHeader]: clientSecret,
          },
          body: JSON.stringify({
            startDate,
            endDate,
            timeUnit: "date",
            keywordGroups: [
              {
                groupName: product.ticker,
                keywords: product.keywords,
              },
            ],
          }),
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Naver ${response.status}: ${body.slice(0, 500)}`);
        }
        return response.json();
      },
    });
    const result = payload.results?.[0];
    if (!result) throw new Error(`Naver 응답에 ${product.ticker} 결과가 없습니다.`);
    rawByProduct[product.id] = payload;
    seriesByProduct[product.id] = pointsToMap(result);
    timings.push({
      ...timing,
      productId: product.id,
      ticker: product.ticker,
      naverProvider: provider,
      keywordGroupCount: 1,
      keywordCount: product.keywords.length,
      observedDays: Object.keys(seriesByProduct[product.id]).length,
    });
  }

  return { seriesByProduct, rawByProduct, timings };
}
