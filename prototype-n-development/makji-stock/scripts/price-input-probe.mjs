/* 가격 입력 두 가지가 몇 시에 준비되는지 잰다.

   naver  — 데이터랩의 전전날(D-2) 검색지수. 오전가·오후가가 함께 쓴다.
   ecos   — 한국은행의 당일 시가. 오후가만 쓴다. 외환시장 개장(09:00) 이후에야 생긴다.

   둘 다 "언제부터 안전한가"가 문서에 없다. 크론 시각을 정하려면 재는 수밖에 없다.
   ../../research/네이버-검색지수-도착시각.md

   사용:
     node scripts/price-input-probe.mjs                # 한 번 재고 로그에 붙인다
     node scripts/price-input-probe.mjs --all          # 검색은 활성 상품 전부
     node scripts/price-input-probe.mjs --summary      # 날짜별 요약
     node scripts/price-input-probe.mjs --out other.tsv

   며칠 모으려면 crontab 에 새벽~오전만 촘촘히 걸면 된다. 예)
     *\/15 4-12 * * *  cd <repo> && node scripts/price-input-probe.mjs >> /dev/null

   로그 열: 잰시각KST · 출처 · 필요한날짜 · 도착여부 · 실제마지막관측일 · 자정이후분 · 라벨 */
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { loadEnvFile } from "../lib/pricing/env.mjs";
import { fetchTrendsSeparately } from "../lib/pricing/naver.mjs";
import { fetchUsdKrwOpenCloseRates } from "../lib/pricing/fx.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const ALL = process.argv.includes("--all");
const OUT = path.resolve(arg("out", "price-input-lag.tsv"));

/** KST 벽시계. 로그가 사람이 읽는 시각이어야 언제부터 안전한지 눈에 보인다. */
const kstNow = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" });
function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

for (const file of [".env.local", ".env"]) {
  // Next.js 와 같은 우선순위. loadEnvFile 은 먼저 넣은 값을 지킨다.
  await loadEnvFile(path.resolve(file)).catch(() => {});
}

const supabase = async (query) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${url}/rest/v1/${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
};

const now = kstNow();
const today = now.slice(0, 10);
const minutes = Number(now.slice(11, 13)) * 60 + Number(now.slice(14, 16));
const row = (source, want, last, label) =>
  [now, source, want, last === want ? "도착" : "미도착", last || "-", minutes, label].join("\t");

const lines = [];

/* ── 네이버: 가격이 쓰는 D-2 ──────────────────────────────── */
const wantSearch = addDays(today, -2);
try {
  const products = await supabase("products?select=id,ticker,keywords&active=eq.true&order=ticker");
  const targets = ALL ? products : products.slice(0, 1);
  if (targets.length === 0) throw new Error("활성 상품이 없습니다.");
  const { seriesByProduct } = await fetchTrendsSeparately({
    products: targets.map((p) => ({ id: p.id, ticker: p.ticker, keywords: p.keywords })),
    // 관측이 드문 키워드도 이월 대상을 찾을 수 있게 넉넉히 본다.
    startDate: addDays(wantSearch, -30),
    endDate: wantSearch,
    log: () => {},
  });
  for (const p of targets) {
    const days = Object.keys(seriesByProduct[p.id] ?? {}).sort();
    lines.push(row("naver", wantSearch, days.at(-1) ?? "", p.ticker));
  }
} catch (cause) {
  lines.push(row("naver", wantSearch, "", `실패:${String(cause.message).slice(0, 40)}`));
}

/* ── ECOS: 오후가가 쓰는 당일 시가 ────────────────────────────
   주말·공휴일에는 오늘 시가가 없는 게 정상이다. 그런 날은 마지막 관측일이
   직전 영업일로 찍히므로 "미도착" 과 구분해서 읽어야 한다. */
try {
  const fx = await fetchUsdKrwOpenCloseRates({
    startDate: addDays(today, -12),
    endDate: today,
    log: () => {},
  });
  const opens = Object.keys(fx.opensByDate).sort();
  lines.push(row("ecos", today, opens.at(-1) ?? "", "USDKRW시가"));
} catch (cause) {
  lines.push(row("ecos", today, "", `실패:${String(cause.message).slice(0, 40)}`));
}

await appendFile(OUT, lines.join("\n") + "\n");
for (const line of lines) console.log(line);

/* 모인 뒤 훑어보기: 출처·날짜별로 "미도착 마지막 시각"과 "도착 첫 시각"을 뽑는다. */
if (process.argv.includes("--summary")) {
  const rows = (await readFile(OUT, "utf8")).trim().split("\n").map((l) => l.split("\t"));
  const byKey = new Map();
  for (const [at, source, want, state] of rows) {
    const day = at.slice(0, 10);
    const key = `${day}|${source}`;
    const bucket = byKey.get(key) ?? { day, source, want, lastMissing: null, firstArrived: null };
    if (state === "미도착") bucket.lastMissing = at.slice(11, 16);
    else if (!bucket.firstArrived) bucket.firstArrived = at.slice(11, 16);
    byKey.set(key, bucket);
  }
  console.log("\n잰 날짜\t출처\t필요한 날짜\t마지막 미도착\t첫 도착");
  for (const b of [...byKey.values()].sort((x, y) => x.day.localeCompare(y.day) || x.source.localeCompare(y.source))) {
    console.log(`${b.day}\t${b.source}\t${b.want}\t${b.lastMissing ?? "-"}\t${b.firstArrived ?? "아직"}`);
  }
}
