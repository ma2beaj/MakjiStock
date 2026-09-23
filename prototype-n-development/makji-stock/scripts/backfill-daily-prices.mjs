/* 백테스트 결과(backtest/output 아래 daily.csv)를 daily_prices 에 채운다.
   화면의 91일 추이 차트가 실데이터를 그리려면 과거가 필요하다.
   산식이 같으므로(v1.0) 오늘 계산되는 값과 이어진다.

   사용: node scripts/backfill-daily-prices.mjs --input <daily.csv> [--commit] */
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { loadEnvFile } from "../lib/pricing/env.mjs";

const TICKER_TO_ID = {
  MRL: "morning_roll",
  TTR: "tetris_bread",
  MUF: "english_muffin",
  SCN: "gluten_free_scone",
  FNC: "gluten_free_financier",
  GFD: "gluten_free_frozen_dough_set",
};
const SESSION = { MORNING_0600: "am", AFTERNOON_1600: "pm" };

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) throw new Error("--input <daily.csv> 가 필요합니다.");
  await loadEnvFile(path.resolve(args["env-file"] ?? ".env"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase 환경변수가 필요합니다.");

  const csv = await readFile(path.resolve(args.input), "utf8");
  const [head, ...lines] = csv.trim().split("\n");
  const cols = head.split(",");
  const rows = lines
    .map((line) => {
      const v = line.split(",");
      return Object.fromEntries(cols.map((c, i) => [c, v[i]]));
    })
    .filter((r) => r.status === "calculated" && TICKER_TO_ID[r.ticker]);

  // 상품·세션별 직전 가격을 이어 붙인다. 화면의 등락률이 여기서 나온다.
  const prevKey = (r) => `${r.ticker}`;
  const lastPrice = {};
  const payload = rows.map((r) => {
    const productId = TICKER_TO_ID[r.ticker];
    const previous = lastPrice[prevKey(r)] ?? null;
    const priceWon = Number(r.priceWon);
    lastPrice[prevKey(r)] = priceWon;
    return {
      product_id: productId,
      publish_date: r.publishDate,
      price_session: SESSION[r.priceSession],
      signal_date: r.searchSignalDate,
      formula_version: "v1.0",
      search_ratio: Math.abs(Number(r.searchRatio)),
      search_discount_pct: Number(r.searchCouponPct),
      fx_previous_date: r.fxPreviousDate,
      fx_current_date: r.fxRateDate,
      fx_previous_rate: Number(r.fxPreviousRate),
      fx_current_rate: Number(r.fxRate),
      fx_decline_pct: Number(r.fxDeclinePct),
      fx_discount_pct: Number(r.fxAdjustmentPct),
      discount_pct: Number(r.discountPct),
      base_price_won: Number(r.basePriceWon),
      price_won: priceWon,
      previous_price_won: previous,
      price_change_pct: previous ? (priceWon / previous - 1) * 100 : null,
      status: "completed",
      // 백필은 과거 재현이라 Cafe24 에 보낸 적이 없다. 보냈다고 표시하지 않는다.
      cafe24_apply_status: "pending",
    };
  });

  console.log(`읽음 ${rows.length}행 → 적재 대상 ${payload.length}행`);
  console.log(`기간 ${payload[0].publish_date} ~ ${payload.at(-1).publish_date}`);
  if (!args.commit) {
    console.table(payload.slice(0, 3).map(({ product_id, publish_date, price_session, discount_pct, price_won }) =>
      ({ product_id, publish_date, price_session, discount_pct: discount_pct.toFixed(2), price_won })));
    console.log("드라이런. 실제 적재는 --commit 을 붙이세요.");
    return;
  }

  const CHUNK = 200;
  let done = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK);
    const response = await fetch(
      `${url}/rest/v1/daily_prices?on_conflict=product_id,publish_date,price_session,formula_version`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(slice),
      },
    );
    if (!response.ok) {
      throw new Error(`적재 실패 ${response.status}: ${(await response.text()).slice(0, 400)}`);
    }
    done += slice.length;
    process.stdout.write(`\r적재 ${done}/${payload.length}`);
  }
  console.log("\n완료");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
