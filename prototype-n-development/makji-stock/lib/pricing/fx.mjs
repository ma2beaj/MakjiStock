import { timedCall } from "./time.mjs";

/* ECOS는 간헐적으로 연결이 끊긴다. 페이지 하나가 실패하면 90일 수집 전체가
   날아가므로 네트워크 오류와 5xx만 짧게 되돌려 시도한다.
   ponytail: 고정 백오프. 호출량이 늘면 지터를 넣는다. */
async function fetchWithRetry(fetchImpl, url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      if (response.status < 500) return response;
      lastError = new Error(`ECOS ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

export const ECOS_USD_KRW_OPEN = {
  statCode: "731Y003",
  itemCode: "0000002",
  itemName: "원/달러(시가)",
  availableSince: "1990-03-02",
};

export const ECOS_USD_KRW_CLOSE = {
  statCode: "731Y003",
  itemCode: "0000003",
  itemName: "원/달러(종가 15:30)",
  availableSince: "1990-03-02",
};

export function parseEcosRates(payload, series) {
  const apiError = payload?.RESULT;
  if (apiError) {
    throw new Error(`ECOS ${apiError.CODE}: ${apiError.MESSAGE}`);
  }

  const rows = payload?.StatisticSearch?.row;
  if (!Array.isArray(rows)) {
    throw new Error(`ECOS ${series.itemName} 응답에 StatisticSearch.row가 없습니다.`);
  }

  return Object.fromEntries(
    rows.flatMap((row) => {
      const value = Number(row?.DATA_VALUE);
      if (
        row?.ITEM_CODE1 !== series.itemCode ||
        !/^\d{8}$/.test(row?.TIME ?? "") ||
        !Number.isFinite(value) ||
        value <= 0
      ) {
        return [];
      }
      const date = `${row.TIME.slice(0, 4)}-${row.TIME.slice(4, 6)}-${row.TIME.slice(6, 8)}`;
      return [[date, value]];
    }),
  );
}

export function parseEcosClosingRates(payload) {
  return parseEcosRates(payload, ECOS_USD_KRW_CLOSE);
}

async function fetchEcosSeries({
  series,
  startDate,
  endDate,
  apiKey,
  fetchImpl,
  log,
}) {
  const pageSize = apiKey === "sample" ? 10 : 1000;
  const start = startDate.replaceAll("-", "");
  const end = endDate.replaceAll("-", "");

  const { value, timing } = await timedCall({
    provider: "BOK_ECOS",
    label: `${series.itemName} ${startDate}..${endDate}`,
    log,
    call: async () => {
      const payloads = [];
      const ratesByDate = {};
      let firstRow = 1;
      let totalCount = Infinity;

      while (firstRow <= totalCount) {
        const lastRow = firstRow + pageSize - 1;
        const url = new URL(
          `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(apiKey)}/json/kr/${firstRow}/${lastRow}/${series.statCode}/D/${start}/${end}/${series.itemCode}/`,
        );
        const response = await fetchWithRetry(fetchImpl, url);
        if (!response.ok) {
          throw new Error(
            `ECOS ${response.status}: ${(await response.text()).slice(0, 500)}`,
          );
        }
        const payload = await response.json();
        payloads.push(payload);
        Object.assign(ratesByDate, parseEcosRates(payload, series));
        totalCount = Number(payload?.StatisticSearch?.list_total_count ?? 0);
        if (!Number.isFinite(totalCount) || totalCount <= 0) break;
        firstRow = lastRow + 1;
      }

      return { payloads, ratesByDate };
    },
  });

  if (Object.keys(value.ratesByDate).length < 2) {
    throw new Error(`ECOS ${series.itemName} 데이터가 2거래일 미만입니다.`);
  }

  return {
    ...value,
    timing: {
      ...timing,
      observedDays: Object.keys(value.ratesByDate).length,
      statCode: series.statCode,
      itemCode: series.itemCode,
      credentialMode: apiKey === "sample" ? "sample" : "api-key",
    },
  };
}

export async function fetchUsdKrwOpenCloseRates({
  startDate,
  endDate,
  apiKey = process.env.BOK_ECOS_API_KEY || "sample",
  fetchImpl = fetch,
  log,
}) {
  if (startDate < ECOS_USD_KRW_OPEN.availableSince) {
    throw new Error(
      `ECOS 원/달러 시가·종가는 ${ECOS_USD_KRW_OPEN.availableSince}부터 제공됩니다.`,
    );
  }

  const close = await fetchEcosSeries({
    series: ECOS_USD_KRW_CLOSE,
    startDate,
    endDate,
    apiKey,
    fetchImpl,
    log,
  });
  const open = await fetchEcosSeries({
    series: ECOS_USD_KRW_OPEN,
    startDate,
    endDate,
    apiKey,
    fetchImpl,
    log,
  });

  return {
    closesByDate: close.ratesByDate,
    opensByDate: open.ratesByDate,
    rawPayloads: {
      close: close.payloads,
      open: open.payloads,
    },
    timings: [close.timing, open.timing],
  };
}
