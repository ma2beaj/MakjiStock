import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { addDays, dateRange, kstToday } from "../lib/pricing/dates.mjs";
import { loadEnvFile } from "../lib/pricing/env.mjs";
import {
  ECOS_USD_KRW_CLOSE,
  ECOS_USD_KRW_OPEN,
  fetchUsdKrwOpenCloseRates,
} from "../lib/pricing/fx.mjs";
import { fetchTrendsSeparately } from "../lib/pricing/naver.mjs";
import { buildSessionFxSignals, simulateProductSessions } from "../lib/pricing/pricing.mjs";
import {
  markdownReport,
  rowsToCsv,
  summarizeOverall,
  summarizeProduct,
} from "./lib/report.mjs";
import { nowStamp, runId } from "../lib/pricing/time.mjs";

const backtestRoot = import.meta.dirname;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

async function main() {
  const started = new Date();
  const startedAt = nowStamp(started);
  const args = parseArgs(process.argv.slice(2));
  const envFile = path.resolve(args["env-file"] ?? path.join(backtestRoot, ".env"));
  const configFile = path.resolve(args.config ?? path.join(backtestRoot, "config.json"));
  await loadEnvFile(envFile);
  const config = JSON.parse(await readFile(configFile, "utf8"));
  const days = Number(args.days ?? 90);
  if (!Number.isInteger(days) || days < 2 || days > 365) {
    throw new Error("--days는 2~365 사이 정수여야 합니다.");
  }
  const endDate = args.end ?? addDays(kstToday(), -1);
  const startDate = addDays(endDate, -(days - 1));
  const publishDates = dateRange(startDate, endDate);
  const searchStartDate = addDays(startDate, -2);
  const searchEndDate = addDays(endDate, -1);
  const outputDir = path.resolve(
    args.output ?? path.join(backtestRoot, "output", runId(started)),
  );
  const naverProvider = args["naver-provider"] ?? process.env.NAVER_PROVIDER ?? "hub";

  console.log(`\nMAKJI 백테스트 시작: ${startedAt.kst}`);
  console.log(`기간: ${startDate} ~ ${endDate} (${days}일)`);
  console.log("가격 세션: 오전 06:00 전영업일 시가→종가 · 오후 16:00 그 종가→당일 시가");
  console.log(`네이버: ${naverProvider} · 상품별 1개 그룹으로 ${config.products.length}회 순차 호출\n`);

  const trendResult = await fetchTrendsSeparately({
    products: config.products,
    startDate: searchStartDate,
    endDate: searchEndDate,
    provider: naverProvider,
    log: console.log,
  });
  const fxResult = await fetchUsdKrwOpenCloseRates({
    startDate: addDays(startDate, -14),
    endDate,
    log: console.log,
  });
  const fxSignals = buildSessionFxSignals({
    closesByDate: fxResult.closesByDate,
    opensByDate: fxResult.opensByDate,
    publishDates,
  });
  const productReports = config.products.map((product) => {
    const rows = simulateProductSessions({
      product,
      pricing: config.pricing,
      publishDates,
      trends: trendResult.seriesByProduct[product.id],
      fxSignals,
    });
    return { ...product, rows };
  });
  const allRows = productReports.flatMap((product) => product.rows);

  const finished = new Date();
  const finishedAt = nowStamp(finished);
  const report = {
    run: {
      startedAtUtc: startedAt.utc,
      startedAtKst: startedAt.kst,
      finishedAtUtc: finishedAt.utc,
      finishedAtKst: finishedAt.kst,
      elapsedMs: finished.getTime() - started.getTime(),
      envFile,
      configFile,
    },
    period: { startDate, endDate, days },
    policy: {
      naverRequests: "one HTTP request with one keyword group per product",
      naverProvider,
      naverNormalization: "independent 0-100 series per product request",
      fxProvider: "bok-ecos",
      fxSeries: [
        `${ECOS_USD_KRW_CLOSE.statCode}/${ECOS_USD_KRW_CLOSE.itemCode} ${ECOS_USD_KRW_CLOSE.itemName}`,
        `${ECOS_USD_KRW_OPEN.statCode}/${ECOS_USD_KRW_OPEN.itemCode} ${ECOS_USD_KRW_OPEN.itemName}`,
      ],
      fxCredentialMode: process.env.BOK_ECOS_API_KEY ? "api-key" : "sample",
      morningFxCutoff: "06:00 KST compares the open and close of the latest business day dated D-1 or earlier",
      afternoonFxCutoff: "16:00 KST compares that same close with D's open",
      fxDirection: "decline adds discount; rise adds surcharge; FX contribution is capped at ±28 percentage points",
      pricing: config.pricing,
    },
    apiCalls: [...trendResult.timings, ...fxResult.timings],
    overall: summarizeOverall(allRows, config.pricing),
    products: productReports.map((product) => summarizeProduct(product, product.rows)),
  };

  await mkdir(outputDir, { recursive: true });
  const rawDir = path.join(outputDir, "raw");
  await mkdir(rawDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(path.join(outputDir, "daily.csv"), rowsToCsv(allRows)),
    writeFile(
      path.join(outputDir, "api-calls.json"),
      `${JSON.stringify(report.apiCalls, null, 2)}\n`,
    ),
    writeFile(path.join(outputDir, "report.md"), markdownReport(report)),
    writeFile(
      path.join(rawDir, "bok-ecos-usd-krw-close-1530.json"),
      `${JSON.stringify(fxResult.rawPayloads.close, null, 2)}\n`,
    ),
    writeFile(
      path.join(rawDir, "bok-ecos-usd-krw-open.json"),
      `${JSON.stringify(fxResult.rawPayloads.open, null, 2)}\n`,
    ),
    ...config.products.map((product) =>
      writeFile(
        path.join(rawDir, `naver-${product.ticker.toLowerCase()}.json`),
        `${JSON.stringify(trendResult.rawByProduct[product.id], null, 2)}\n`,
      ),
    ),
  ]);

  console.log(`\n완료: ${finishedAt.kst} · ${report.run.elapsedMs}ms`);
  console.log(`결과: ${outputDir}`);
  console.table(report.products);
}

main().catch((error) => {
  console.error(`\n백테스트 실패: ${error.message}`);
  if (error.apiTiming) console.error(JSON.stringify(error.apiTiming, null, 2));
  process.exitCode = 1;
});
