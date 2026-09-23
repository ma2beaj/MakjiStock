/* 할인율 산식 시뮬레이터를 만든다 — 실데이터를 붙박아 파일 하나로 열리게.

   docs/reference/discount-formula-simulator.html 은 기업 발표 덱(슬라이드 8)
   시절 산식이라 지금 운영 산식과 다르다. 이 스크립트가 만드는 쪽이 현행이다.

     node scripts/build-discount-simulator.mjs [--days 91] [--end 2026-09-21]

   네이버·한국은행을 부르므로 .env.local 의 키가 필요하다. 데이터를 새로 받고
   싶을 때만 돌린다 — 산출물(HTML)은 커밋돼 있어 그냥 열어도 된다. */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { addDays, dateRange } from "../lib/pricing/dates.mjs";
import { loadEnvFile } from "../lib/pricing/env.mjs";
import { fetchUsdKrwOpenCloseRates } from "../lib/pricing/fx.mjs";
import { fetchTrendsSeparately } from "../lib/pricing/naver.mjs";
import { buildSessionFxSignals } from "../lib/pricing/pricing.mjs";

const root = path.resolve(import.meta.dirname, "..");
const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean).map((s) => s.trim().split(/\s+/)),
);

await loadEnvFile(path.join(root, ".env.local"));
const config = JSON.parse(await readFile(path.join(root, "config/pricing-products.json"), "utf8"));

const days = Number(args.days ?? 91);
const endDate = args.end ?? "2026-09-21";
const startDate = addDays(endDate, -(days - 1));
const dates = dateRange(startDate, endDate);

/* 검색지수는 D-2 를 쓴다 — 네이버가 전날 지수를 08~09시대에 올려 D-1 은 오전가
   크론(05시대)이 늘 놓친다. lib/pricing/daily-job.ts searchSignalDateOf */
const SEARCH_LAG = 2;

console.log(`${startDate} ~ ${endDate} (${days}일) · 상품 ${config.products.length}종`);
const trends = await fetchTrendsSeparately({
  products: config.products,
  startDate: addDays(startDate, -SEARCH_LAG - 1),
  endDate: addDays(endDate, -SEARCH_LAG),
  provider: process.env.NAVER_PROVIDER ?? "hub",
  log: console.log,
});
const fx = await fetchUsdKrwOpenCloseRates({ startDate: addDays(startDate, -14), endDate, log: console.log });
const fxSignals = buildSessionFxSignals({ ...fx, publishDates: dates });

const r6 = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/* 환율은 상품과 무관하고 검색은 세션과 무관하다. 축을 나눠 담으면
   936행이 (91×2) + (91×6) 개의 숫자로 줄어든다. */
const data = {
  generatedAt: new Date().toISOString().slice(0, 10),
  period: { startDate, endDate, days },
  pricing: config.pricing,
  products: config.products.map((p) => ({
    id: p.id, ticker: p.ticker, name: p.name, basePriceWon: p.basePriceWon,
  })),
  dates,
  fxDeclinePct: {
    am: dates.map((d) => r6(fxSignals[d]?.morning?.declinePct)),
    pm: dates.map((d) => r6(fxSignals[d]?.afternoon?.declinePct)),
  },
  searchRatio: Object.fromEntries(config.products.map((p) => [
    p.id, dates.map((d) => r2(trends.seriesByProduct[p.id]?.[addDays(d, -SEARCH_LAG)])),
  ])),
};

const template = await readFile(path.join(root, "scripts/lib/simulator-template.html"), "utf8");
const outPath = path.join(root, "docs/reference/discount-formula-simulator-current.html");
await writeFile(outPath, template.replace("/*__DATA__*/null", JSON.stringify(data)));

const filled = dates.filter((d, i) => data.fxDeclinePct.am[i] !== null).length;
console.log(`\n환율 있는 날 ${filled}/${dates.length} · 오후 ${data.fxDeclinePct.pm.filter(Boolean).length}일`);
console.log(`저장: ${path.relative(root, outPath)}`);
