# 핵심 기능별 플로우차트 (F1~F5)

MVP 앱(`prototype-n-development/makji-stock/`)의 판단 규칙을 코드 그대로 옮겼다. 아래 경로는 모두 이 앱 폴더 기준이다.
분기 조건과 숫자는 코드·config에서 그대로 가져왔고, `tests/*.test.mjs`로 경계값을 한 번 더 확인했다.

- 시각은 모두 KST다. 크론 스케줄(`vercel.json`)만 UTC로 적혀 있어 괄호 안에 KST를 함께 적었다.
- "시장 시계"는 02:00에 날짜가 바뀌는 시계다. 00~01시는 전날 날짜의 24·25시로 센다.

| ID | 이름 | 다이어그램 |
|---|---|---|
| F1 | 장 세션 판정 | F1-a 세션과 날짜 경계, F1-b 환율 구간과 주말 이월 |
| F2 | 할인율·판매가 계산 | F2-a 대표 판매가, F2-b 옵션가 `additional_amount` |
| F3 | 가격 산정 작업 상태 전이 | F3-a `job_runs.status`, F3-b `onlyIfMissing` 재시도 |
| F4 | 가격 잠금 가능 여부와 오후 정산 | F4 |
| F5 | 예측 판정과 보상 | F5-a 제출과 바로 받기, F5-b 판정과 쿠폰 발급 |

---

## F1. 장 세션 판정

### F1-a. 세션과 02:00 날짜 경계

지금 시각이 어느 장(정가·오전장·오후장)인지, 그리고 그 장에 어떤 확정가를 보여주고 쓰는지 정한다.

- 근거 코드: `lib/market/calendar.ts` (`marketClockOf`, `kstNow`), `lib/bread-market/reward-policy.ts` (`sessionOfHour`, `isPublicAt`), `lib/pricing/current-price.ts` (`priceSlots`), `lib/predictions/schedule.ts`, `vercel.json`
- 확인한 테스트: `tests/market-calendar.test.mjs`, `tests/reward-policy.test.mjs`, `tests/current-price.test.mjs`
- 코드 대조일: 2026-09-23

```mermaid
flowchart TD
  NOW["서버 시각을 KST 날짜·시로 읽음<br/>kstNow()"] --> B{"KST 시 < 2 ?"}
  B -- "예 (00·01시)" --> PREV["시장 날짜 = 전날<br/>시장 시 = 시 + 24 (24·25시)"]
  B -- "아니오" --> SAME["시장 날짜 = 그날<br/>시장 시 = 그대로"]
  PREV --> S{"sessionOfHour(시)"}
  SAME --> S
  S -- "6 ≤ 시 < 16" --> AM["오전장 am<br/>06:00~15:59"]
  S -- "시 ≥ 16 또는 시 < 2" --> PM["오후장 pm<br/>16:00~다음 날 01:59"]
  S -- "그 밖 (2~5시)" --> LIST["정가 list<br/>02:00~05:59"]

  LIST --> RESET["02:00 크론 reset-list-price<br/>(0 17 * * * UTC)<br/>Cafe24 판매가를 정가로 되돌림"]
  RESET --> NOLIST["확정가 없음<br/>잠금·예측·바로 받기 모두 거절"]

  AM --> SAM["그날 am 확정가를 찾음"]
  PM --> SPM{"그날 pm 확정가가 있나"}
  SPM -- "있음" --> USEPM["그날 pm 확정가"]
  SPM -- "없음 (주말·공휴일)" --> SAM
  SAM --> HAS{"그날 am 확정가가 있나"}
  HAS -- "있음" --> USEAM["그날 am 확정가"]
  HAS -- "없음 (보류 중)" --> NOPRICE["확정가 없음<br/>전날 가격으로 거슬러 가지 않음<br/>잠금·예측 409"]

  USEAM --> PUB{"isPublicAt<br/>오전가는 시 ≥ 6, 오후가는 시 ≥ 16부터 공개"}
  USEPM --> PUB
```

읽는 법
- 00:00~01:59는 달력으로는 다음 날이지만 시장 시계로는 전날 24·25시다. 그래서 `sessionOfHour`의 `시 ≥ 16` 조건에 걸려 전날 오후장이 01:59까지 이어진다.
- 확정가는 그날 것만 찾는다. 오후장은 그날 오후가가 없으면 그날 오전가로 내려가고(주말), 그날 오전가도 없으면 가격이 없는 것으로 보고 거절한다.
- 크론은 05시대·15시대에 `daily_prices`를 쓰지만 공개 시각은 `isPublicAt`이 06:00·16:00으로 고정한다.
- 가격 산정 크론이 어느 장을 만들지는 `resolveSession`이 따로 정한다: `?session=` 파라미터 → 크론 헤더의 UTC 시가 6이면 pm, 그 밖은 am → 헤더도 없으면 KST 15~23시는 pm, 나머지는 am (`lib/pricing/daily-job.ts:38-52`).

### F1-b. 환율 구간과 주말 이월

가격 산정 때 오전장·오후장이 각각 어느 환율 구간의 하락률을 쓰는지, 외환시장이 쉬는 날 어떻게 되는지 보여준다.

- 근거 코드: `lib/pricing/pricing.mjs` (`buildSessionFxSignals`, 43~88행), `app/api/internal/daily-pricing/route.ts` (162~193행), `docs/산식-버전.md` (v1.1)
- 확인한 테스트: `tests/pricing-core.test.mjs`
- 코드 대조일: 2026-09-23

```mermaid
flowchart TD
  START["daily-pricing 실행<br/>publishDate = 오늘(KST 달력)<br/>ECOS 시가·종가를 12일 전부터 조회"] --> LC["latestClose = 어제(달력) 이하에서 가장 최근 종가"]
  LC --> SES{"session"}

  SES -- "am" --> MO{"latestClose와<br/>그 날짜의 시가가 모두 있나"}
  MO -- "없음" --> HELD1["morning = null<br/>job held, error_code fx_unavailable"]
  MO -- "있음" --> MCALC["오전장 하락률(%) =<br/>(전영업일 시가 − 전영업일 종가) / 전영업일 시가 × 100"]
  MCALC --> CARRY{"latestClose 날짜 = 어제 ?"}
  CARRY -- "예" --> FRESH["carriedForward = false"]
  CARRY -- "아니오 (일·월요일 등)" --> CARRIED["carriedForward = true<br/>금요일 구간을 그대로 이월"]

  SES -- "pm" --> PO{"오늘 시가가 있나"}
  PO -- "없음 (주말·공휴일)" --> HELD2["afternoon = null<br/>job held, error_code fx_unavailable<br/>오후 PUT 없음 → 몰은 오전가 유지"]
  PO -- "있음" --> PCALC["오후장 하락률(%) =<br/>(전영업일 종가 − 오늘 시가) / 전영업일 종가 × 100"]
```

읽는 법
- v1.1부터 두 장이 겹치지 않고 이어진다: 전영업일 시가 →(오전장)→ 전영업일 종가 →(오후장)→ 당일 시가. 현재 `formulaVersion`은 `v1.1`이다(`config/pricing-products.json:13`).
- 주말에도 오전가는 나온다. 토요일 오전은 금요일 시가→종가, 일·월요일 오전은 같은 금요일 구간을 이월해 쓴다. 가격은 매번 정가에서 새로 계산하므로 이월해도 할인이 쌓이지 않는다.
- 주말·공휴일 오후에는 당일 시가가 없어 오후가를 만들지 않는다. 화면과 서버는 F1-a의 규칙대로 그날 오전가를 계속 쓴다.

---

## F2. 할인율·판매가 계산

### F2-a. 대표 판매가

검색지수와 환율 하락률로 할인율을 만들고, 상·하한을 적용해 10원 단위 판매가를 낸다.

- 근거 코드: `lib/pricing/pricing.mjs` (`calculateDay` 90~116행, `resolveSearchRatio` 271~282행, `roundTo` 3~5행), `config/pricing-products.json` (2~14행), `lib/pricing/daily-job.ts` (`searchSignalDateOf`, `marginCapPct`), `app/api/internal/daily-pricing/route.ts` (195~225행), `supabase/migrations/005_no_surcharge_reward5.sql`
- 확인한 테스트: `tests/pricing-core.test.mjs`, `tests/search-carry-forward.test.mjs`, `tests/daily-job.test.mjs`
- 코드 대조일: 2026-09-23 · 산식 버전 `v1.1` (계수와 상한은 v1.0과 같고 오전장 환율 구간만 바뀜, `docs/산식-버전.md`)

```mermaid
flowchart TD
  IN["상품 1개 · 공개일 D"] --> SD["검색 날짜 = D − 2일<br/>searchSignalDateOf"]
  SD --> SR{"resolveSearchRatio<br/>D−2 값이 있고 0이 아닌가"}
  SR -- "예" --> S["S = 그 날 검색지수 절댓값"]
  SR -- "아니오, 이전 관측치는 있음" --> HOLD1["carried = true → 이 상품 보류<br/>(daily_prices 행을 만들지 않음)"]
  SR -- "90일 창에 관측치 없음" --> HOLD2["null → 이 상품 보류"]

  S --> SC["검색쿠폰(%p) = S × searchWeight 0.15"]
  FX["환율 하락률(%)<br/>F1-b에서 옴"] --> RAW["환율원시(%p) =<br/>하락률 × fxWeight 0.28 × fxScale 50<br/>(= 하락률 × 14)"]
  RAW --> DIR{"환율원시 ≥ 0 ?"}
  DIR -- "예 (환율 하락)" --> DOWN["환율조정 = min(fxDiscountCapPct 28, 환율원시)"]
  DIR -- "아니오 (환율 상승)" --> UP["환율조정 = max(−fxSurchargeCapPct 14,<br/>환율원시 × fxRisePassThroughPct 50%)"]

  SC --> SUM["합산 할인율 = 검색쿠폰 + 환율조정"]
  DOWN --> SUM
  UP --> SUM

  SUM --> CAP{"상품 마진 자료<br/>list_margin_pct, min_margin_pct<br/>둘 다 있나"}
  CAP -- "예" --> MCAP["상한 = min(discountCapPct 38,<br/>(정가마진 − 최소마진) / (100 − 최소마진) × 100)"]
  CAP -- "아니오" --> PCAP["상한 = discountCapPct 38"]
  MCAP --> CLAMP["할인율 = max(discountFloorPct 0, min(상한, 합산))"]
  PCAP --> CLAMP
  CLAMP --> PRICE["판매가 = Math.round(정가 × (1 − 할인율/100) / 10) × 10<br/>priceRoundingWon 10, 반올림"]
  PRICE --> OUT["정가 이하 보장 (할인율 하한 0)<br/>DB 제약: discount_pct 0~38, price_won % 10 = 0"]
```

읽는 법
- 계수는 `config/pricing-products.json` 값이다: `searchWeight 0.15`, `fxWeight 0.28`, `fxScale 50`, `fxDiscountCapPct 28`, `fxSurchargeCapPct 14`, `fxRisePassThroughPct 50`, `discountCapPct 38`, `discountFloorPct 0`, `priceRoundingWon 10`. `dailyPriceMoveCapPct`는 `null`이고 운영 경로(`calculateDay`)는 이 값을 쓰지 않는다.
- 환율이 내리면 ×14를 전부 할인에 더하고(최대 +28%p), 오르면 ×7만 할인에서 뺀다(최대 −14%p). 테스트 예: S=60, 환율 0.5% 하락 → 16.00%, 0.5% 상승 → 5.50% (`tests/pricing-core.test.mjs:136-149`).
- 할인율 하한이 0이라 판매가는 정가를 넘지 않는다. 상한 38%이면 판매가는 정가의 62%까지 내려간다. 마진 자료가 있는 상품은 상한이 38보다 작아질 수 있다.
- 검색지수가 D−2에 없어 이월값밖에 없으면 계산하지 않고 그 상품만 보류한다. 보류된 상품은 F3-b의 재시도가 다시 만든다.

### F2-b. 옵션가와 `additional_amount`

대표 판매가를 정한 뒤, Cafe24 옵션마다 구매자가 보는 옵션 총액을 같은 할인율로 계산하고 대표가와의 차이를 추가금으로 보낸다.

- 근거 코드: `lib/pricing/variant-pricing.ts` (`discountedOptionPrice`, `buildVariantPricePlan`, `assertCompleteVariantPricePlan`, `variantUpdateRequestBody`), `config/cafe24-option-prices.ts`, `lib/cafe24/price-sync.ts` (`syncCafe24ProductPrice`)
- 확인한 테스트: `tests/variant-pricing.test.mjs`
- 코드 대조일: 2026-09-23

```mermaid
flowchart TD
  A["입력: 대표 판매가 P, 할인율 d (반올림 전 값)"] --> DEF{"CAFE24_OPTION_PRICES에<br/>이 상품 옵션 정가가 있나"}
  DEF -- "없음" --> PUTP["대표가만 PUT<br/>PUT /products/{no} price = P"]
  DEF -- "있음" --> GET["GET /products/{no}/variants<br/>variant_code, options, additional_amount"]
  GET --> MATCH["옵션 값 정규화 후 정가 설정과 짝짓기<br/>NFKC, 소문자, 한글·영문·숫자·% 외 제거"]
  MATCH --> DEMO{"데모몰 상품이고, 몰에 옵션이 없고,<br/>옵션 정가 설정이 2개 이상인가"}
  DEMO -- "예" --> SKIP["옵션 반영 생략<br/>optionsSkippedReason 기록"] --> PUTP
  DEMO -- "아니오" --> CHECK{"설정에만 있는 옵션 또는<br/>몰에만 있는 옵션이 있나"}
  CHECK -- "있음" --> FAIL["옵션 매핑 불일치 오류<br/>대표가도 바꾸지 않음<br/>cafe24_apply_status = failed"]
  CHECK -- "없음" --> CALC["옵션마다<br/>옵션 판매가 = round(옵션 정가 × (1 − d/100) / 10) × 10<br/>additional_amount = 옵션 판매가 − P"]
  CALC --> PUT2["PUT /products/{no} price = P<br/>이어서 PUT /products/{no}/variants"]
  PUTP --> OK["cafe24_apply_status = applied"]
  PUT2 --> OK
```

읽는 법
- 추가금에 할인율을 곱하지 않는다. 옵션 총액(예: 모닝롤 3개 12,200원)에 할인율을 먼저 적용한 뒤 대표 판매가를 빼서 추가금을 만든다. 그래야 세트 옵션의 원래 가격 구성이 유지된다.
- 옵션 판매가도 10원 단위 반올림이다. 테스트 예: 13,700원 × 15% 할인 → 11,650원, 25,900원 × 17.35% 할인 → 21,410원.
- 매핑이 어긋나면 대표가를 PUT하기 전에 멈춘다. 옵션 일부만 옛 가격으로 남은 채 공개되는 일을 막기 위해서다.

---

## F3. 가격 산정 작업 상태 전이

### F3-a. `job_runs.status` (`price_status` enum)

`/api/internal/daily-pricing` 한 번의 실행이 `job_runs` 행에 실제로 남기는 상태만 그렸다.

- 근거 코드: `app/api/internal/daily-pricing/route.ts` (95~117행 시작·실패, 132~149행 `onlyIfMissing`, 175~193행 환율 없음, 378~388행 종료), `supabase/schema.sql:17` (`price_status` enum), `app/api/internal/reset-list-price/route.ts:63`
- 확인한 테스트: 상태 전이 자체를 고정하는 테스트는 없다. 판단 함수만 `tests/cron-session.test.mjs`, `tests/daily-job.test.mjs`가 고정한다.
- 코드 대조일: 2026-09-23

```mermaid
stateDiagram-v2
  [*] --> collecting : job_runs insert
  collecting --> completed : onlyIfMissing=1 이고 남은 상품이 0개
  collecting --> held : 환율 신호 없음, error_code fx_unavailable
  collecting --> held : 수집·계산·저장 중 예외, error_code pipeline, HTTP 502
  collecting --> calculated : commit 아님 (POST 기본값, 드라이런)
  collecting --> completed : commit, Cafe24 반영 실패 0건
  collecting --> partially_failed : commit, Cafe24 반영 실패 1건 이상
  completed --> [*]
  calculated --> [*]
  partially_failed --> [*]
  held --> [*]

  state "scheduled (미사용)" as scheduled
  state "applying_cafe24 (이 작업은 미사용)" as applying_cafe24
  state "published (미사용)" as published
  note right of scheduled : 컬럼 기본값일 뿐. insert가 collecting을 직접 넣는다
  note right of applying_cafe24 : reset-list-price 작업만 시작 상태로 쓴다
  note right of published : 코드 어디에서도 쓰지 않는다
```

읽는 법
- 상태는 한 번에 최종값으로 바뀐다. `collecting`으로 만든 행을 끝에서 `completed`·`partially_failed`·`calculated`·`held` 중 하나로 한 번만 갱신한다. 중간 단계(계산 완료, Cafe24 반영 중)를 따로 기록하지 않는다.
- `calculated`는 중간 단계가 아니라 "드라이런으로 끝남"이라는 최종값이다. Vercel 크론은 GET이라 `commit` 기본값이 켜져 있다.
- 상품 단위 보류(검색지수 미도착)는 작업 상태를 바꾸지 않는다. 일부 상품이 빠져도 Cafe24 실패가 없으면 `completed`다. 빠진 상품은 F3-b 재시도가 채운다.
- `partially_failed`는 Cafe24 반영 실패만 센다. 잠금 코드·예측 쿠폰 발급 실패는 `step_log`에만 남고 상태에는 반영되지 않는다.

### F3-b. `onlyIfMissing` 재시도

오전가가 보류된 상품을 뒤늦게 만드는 따라잡기 실행의 흐름이다.

- 근거 코드: `vercel.json`, `app/api/internal/daily-pricing/route.ts` (130~149행, 293~296행), `lib/pricing/daily-job.ts` (`resolveSession`), `lib/predictions/resolve.ts`
- 확인한 테스트: `tests/cron-schedule.test.mjs`, `tests/cron-session.test.mjs`
- 코드 대조일: 2026-09-23

```mermaid
flowchart TD
  C0["05:30 KST 크론 (30 20 * * * UTC)<br/>session=am, onlyIfMissing 없음"] --> ALL["활성 상품 전부 수집·계산"]
  ALL --> PART{"상품별 검색지수가 준비됐나"}
  PART -- "예" --> SAVE["daily_prices upsert<br/>키: product_id, publish_date, price_session, formula_version<br/>Cafe24 반영, 예측 판정"]
  PART -- "아니오" --> MISS["그 상품만 보류<br/>daily_prices 행 없음"]

  MISS --> R["재시도 크론 5회<br/>06:00·07:00·08:00·09:00·10:00 KST<br/>(0 21·22·23·0·1 * * * UTC)<br/>session=am, onlyIfMissing=1"]
  R --> Q["daily_prices에서 같은 publish_date·price_session 행이 있는 상품을 제외<br/>(formula_version은 보지 않음)"]
  Q --> LEFT{"남은 상품이 있나"}
  LEFT -- "없음" --> DONE["job completed<br/>응답 mode = skipped"]
  LEFT -- "있음" --> REDO["남은 상품만 수집·계산·저장·반영<br/>예측 판정도 이번에 계산한 상품만"]
  REDO --> PART

  PM["15:00 KST 크론 (0 6 * * * UTC)<br/>session=pm, 1회뿐"] --> PMNOTE["재시도 없음<br/>오후가가 보류되면 그날 오후장은 오전가 유지"]
```

읽는 법
- 이미 확정가가 있는 상품은 다시 계산하지 않는다. 공개된 값을 나중 실행이 덮어쓰면 화면에 떴던 가격과 달라지기 때문이다.
- Hobby 크론은 지정한 시간대 안 아무 분에나 돌기 때문에(최대 59분 늦음) 재시도 시각도 "그 시간대"로 읽는다.
- 재시도 실행에서 예측 판정은 이번에 계산한 상품만 본다. 앞선 실행에서 판정이 저장되지 못한 건은 `pending`으로 남아 다음 날 오전 크론이 DB 확정가로 따라잡는다(F5-b).

---

## F4. 가격 잠금 가능 여부와 오후 정산

손님이 오전가를 잠글 수 있는지 판단하고, 오후가가 나오면 차액 할인코드를 발급한다.

- 근거 코드: `app/api/locks/route.ts` (57~164행), `lib/locks/lock-codes.ts` (`issueLockCodes`), `lib/bread-market/reward-policy.ts` (`lockOpensOn`, `lockProtection`, `lockAppliedPriceWon`, `lockCodeAmountWon`), `lib/pricing/current-price.ts`, `app/api/internal/daily-pricing/route.ts` (356~366행), `supabase/schema.sql:173`
- 확인한 테스트: `tests/reward-policy.test.mjs` (잠금 세션, 평일, 차액), `tests/current-price.test.mjs`
- 코드 대조일: 2026-09-23

```mermaid
flowchart TD
  subgraph LOCK["POST /api/locks — 잠금 접수"]
    direction TB
    L0["요청 ticker 또는 productId"] --> L1{"둘 다 없나"}
    L1 -- "예" --> E400["400"]
    L1 -- "아니오" --> L2{"시장 시 < 6 또는 시장 시 ≥ 16 ?"}
    L2 -- "예 (정가·오후장, 00·01시 포함)" --> E409A["409 오전장에만 잠금 가능"]
    L2 -- "아니오 (06:00~15:59)" --> L3{"lockOpensOn(시장 날짜)<br/>토·일요일인가"}
    L3 -- "토·일" --> E409B["409 주말에는 잠금 안 받음<br/>(공휴일은 가리지 못함)"]
    L3 -- "평일" --> L4{"상품이 있나"}
    L4 -- "없음" --> E404["404"]
    L4 -- "있음" --> L5{"그날 am 확정가가 있나"}
    L5 -- "없음" --> E409C["409 오늘 가격이 아직 없음"]
    L5 -- "있음" --> L6["price_locks insert<br/>잠금가 = 서버가 읽은 오전가<br/>보호 구간 = 그날 16:00:00 ~ 다음 날 01:59:59<br/>status = active"]
    L6 --> L7{"유니크 위반 23505<br/>(visitor_hash, lock_date)"}
    L7 -- "예" --> E409D["409 오늘은 이미 잠금 사용"]
    L7 -- "아니오" --> L8{"그날 pm 확정가가 이미 있나<br/>(오전가 폴백은 제외)"}
    L8 -- "예" --> NOW["이 잠금 하나만 즉시 차액 코드 발급<br/>실패해도 잠금은 유지"]
    L8 -- "아니오" --> OK201["201 잠금 완료"]
    NOW --> OK201
  end

  subgraph SETTLE["오후 정산 — issueLockCodes"]
    direction TB
    P0["15시대 pm 크론 또는 위의 즉시 발급"] --> P1["대상: lock_date = 그날, lock_session = am,<br/>status = active, reward_claim_id 없음"]
    P1 --> P2{"오후가를 찾았나"}
    P2 -- "아니오" --> SK1["skipped 현재가 없음"]
    P2 -- "예" --> P3["차액 = floor((오후가 − 잠금가) / 10) × 10"]
    P3 --> P4{"차액 ≤ 0 ?"}
    P4 -- "예 (오후가가 같거나 더 쌈)" --> SK2["코드 없음<br/>더 싼 현재가로 구매"]
    P4 -- "아니오 (오후가가 오름)" --> P5{"cafe24_product_no가 있고 commit인가"}
    P5 -- "아니오" --> SK3["skipped"]
    P5 -- "예" --> P6["Cafe24 정액 할인코드 생성<br/>유효: protect_from ~ protect_until"]
    P6 --> P7["reward_claims insert<br/>price_locks.status = protecting"]
    P6 -. "실패" .-> FL["failed, 잠금은 active로 남음"]
  end
```

읽는 법
- 잠금은 평일 오전장(06:00~15:59)에 하루 한 번, 빵 한 개만 된다. 하루 한 번은 앱이 아니라 DB 유니크 제약 `(visitor_hash, lock_date)`가 막는다.
- 적용가는 `min(잠금가, 현재가)`다. 오후가가 오르면 차액만큼 정액 코드를 주고, 내리거나 같으면 코드 없이 더 싼 현재가로 산다. 몰 판매가 자체는 오후가 그대로다.
- 크론이 15시대 어느 분에 돌지 모르므로, 크론 뒤 15:59까지 걸린 잠금은 접수하는 자리에서 바로 발급한다. `reward_claim_id`가 빈 잠금만 보므로 둘이 겹쳐도 두 번 나가지 않는다.
- 발급이 실패한 잠금은 `active`로 남지만, 그날 오후 크론은 한 번뿐이라 자동으로 다시 발급되지 않는다.

---

## F5. 예측 판정과 보상

### F5-a. 예측 제출(공격형)과 바로 받기(안정형)

한 시장 날짜에 방문자는 예측과 바로 받기 중 하나만 할 수 있다. 둘 다 다음 날 06:00 오전가 회차를 쓴다.

- 근거 코드: `app/api/predictions/route.ts` (49~159행), `app/api/predictions/instant/route.ts` (25~151행), `lib/predictions/schedule.ts`, `lib/bread-market/reward-policy.ts` (`instantRewardPct`, `rollPredictionRewardPct`, `INSTANT_CODE_HOURS`), `supabase/schema.sql:214`, `supabase/migrations/006_prediction_risk_reward.sql:24`
- 확인한 테스트: `tests/prediction-schedule.test.mjs`, `tests/reward-policy.test.mjs` (안정형·공격형 보상률)
- 코드 대조일: 2026-09-23

```mermaid
flowchart TD
  T0["요청 시각을 시장 시계로 읽음"] --> T1{"시장 시 < 6 ?<br/>(02:00~05:59 정가)"}
  T1 -- "예" --> X409["409 정가 시간에는 불가"]
  T1 -- "아니오" --> SCH["predictionSchedule<br/>제출 장 = 시 ≥ 16 이면 pm, 아니면 am<br/>기준 날짜 = 오늘 시장 날짜<br/>판정 = 다음 날 am (06:00 오전가)<br/>roundId = 시장날짜-am"]
  SCH --> REF{"기준가: 오늘 확정가가 있나<br/>(pm 제출은 pm → 없으면 am)"}
  REF -- "없음" --> X409B["409 오늘 가격이 아직 없음"]
  REF -- "있음" --> KIND{"어느 쪽인가"}

  KIND -- "예측 POST /api/predictions" --> P1["prediction_rounds upsert"]
  P1 --> P2{"같은 회차 reward_claims에<br/>바로 받기 기록이 있나"}
  P2 -- "있음" --> X409C["409 이미 할인코드를 받음"]
  P2 -- "없음" --> P3["약속 보상률 = 5~20% 정수 중 무작위<br/>제출 때 뽑아 reward_rate_pct에 저장"]
  P3 --> P4{"prediction_entries insert<br/>유니크 (round_id, visitor_hash)"}
  P4 -- "위반" --> X409D["409 이미 예측함"]
  P4 -- "성공" --> P5["201 result = pending<br/>판정은 다음 날 06:00 오전가"]

  KIND -- "바로 받기 POST /api/predictions/instant" --> I1{"같은 회차 prediction_entries에<br/>예측 기록이 있나"}
  I1 -- "있음" --> X409E["409 이미 예측함"]
  I1 -- "없음" --> I2["보상률 = instantRewardPct(roundId, 제출 장)<br/>am 표 15·14·13, pm 표 10·11·12 중 회차로 고정"]
  I2 --> I3["쿠폰 금액 = couponAmountWon(보상률, 기준가, 정가)<br/>계산은 F5-b와 같음"]
  I3 --> I4{"금액 ≤ 0 ?"}
  I4 -- "예" --> X409F["409 할인 여력 없음"]
  I4 -- "아니오" --> I5["rounds upsert → Cafe24 정액 코드 생성<br/>유효: 발급 시각 + 3시간"]
  I5 --> I6{"reward_claims insert<br/>유니크 (round_id, visitor_hash)"}
  I6 -- "위반" --> X409G["409 이미 받음"]
  I6 -- "성공" --> I7["201 코드 즉시 표시"]
```

읽는 법
- 판정은 제출 시각과 상관없이 늘 다음 날 06:00 오전가다. 오전에 내든 자정 넘어(시장 시계 24·25시) 내든 같다. 주말에도 쉬지 않는다.
- 회차 id가 `시장날짜-am` 하나라 오전장·오후장 제출이 같은 회차를 쓴다. 즉 시장 날짜 하루에 예측이나 바로 받기 중 한 번이다.
- 상호 배제는 각 라우트가 상대 테이블을 먼저 조회해서 막는다. DB 유니크 제약은 테이블마다 따로 걸려 있어(`prediction_entries`, `reward_claims`), 두 요청이 동시에 들어오는 경우까지 DB가 막아 주지는 않는다.
- 바로 받기는 상품에 `cafe24_product_no`가 없으면 409로 거절한다(흐름에서는 생략).

### F5-b. 판정과 쿠폰 발급 (38% 상한에 따른 쿠폰율 축소)

오전가가 확정되는 가격 산정 크론 안에서 밀린 예측까지 판정하고 할인코드를 낸다.

- 근거 코드: `lib/predictions/resolve.ts` (59~183행), `lib/bread-market/reward-policy.ts` (`resolveDirection` 174~178행, `rewardPctFor` 123~125행, `finalCouponPct` 141~144행, `couponAmountWon` 161~167행, `predictionCodeValidUntil` 213~215행), `app/api/internal/daily-pricing/route.ts` (368~376행)
- 확인한 테스트: `tests/reward-policy.test.mjs`, `tests/prediction.test.mjs`
- 코드 대조일: 2026-09-23

```mermaid
flowchart TD
  C["daily-pricing 크론이 D일 가격을 확정한 직후<br/>resolvePredictions(targetDate = D, targetSession = 이번 장)"] --> Q["대상: role = general, result = pending,<br/>target_publish_date ≤ D, target_session = 이번 장"]
  Q --> PMCASE{"이번 장이 pm인가"}
  PMCASE -- "예" --> EMPTY["대상 0건<br/>모든 예측이 target_session = am"]
  PMCASE -- "아니오 (am)" --> RP{"결과가 찾기<br/>그날분은 방금 계산한 값,<br/>밀린 날짜분은 DB의 그날 am 확정가"}
  RP -- "없음" --> SKIP["이 건만 건너뜀<br/>pending 유지, 다음 실행에서 다시 봄"]
  RP -- "있음" --> DIR{"결과가 = 기준가 ?"}
  DIR -- "예" --> VOID["void 무승부"]
  DIR -- "아니오" --> HIT{"예측 방향과 실제 방향이 같은가<br/>(결과가 > 기준가 이면 up)"}
  HIT -- "같음" --> H["hit 적중"]
  HIT -- "다름" --> M["miss 빗나감"]
  VOID --> R["보상률 R = 제출 때 약속한 값 (5~20%)"]
  H --> R
  M --> R0["보상률 R = 0"]

  R --> D1["판매가 할인율 D = (1 − 결과가 / 정가) × 100"]
  D1 --> D2["허용 쿠폰율 = max(0, 38 − D)"]
  D2 --> D3["최종 쿠폰율 = floor(min(R, 허용 쿠폰율) × 10) / 10<br/>(0.1% 단위 내림)"]
  D3 --> D4["금액 = floor(결과가 × 최종 쿠폰율 / 100 / 10) × 10<br/>(판매가 기준, 10원 내림)"]
  D4 --> D5{"결과가 − 금액 < 정가 × 0.62 ?"}
  D5 -- "예" --> D6["금액 −10원 후 다시 확인"] --> D5
  D5 -- "아니오" --> UPD
  R0 --> UPD["prediction_entries 판정 저장<br/>result, result_price_won, reward_rate_pct, resolved_at"]
  UPD --> SAVED{"저장 성공?"}
  SAVED -- "실패" --> KEEP["쿠폰 안 냄, pending 유지"]
  SAVED -- "성공" --> AMT{"금액 > 0 이고 cafe24_product_no가 있나"}
  AMT -- "아니오" --> NONE["코드 없음 (보상 없음 등)"]
  AMT -- "예" --> CODE["Cafe24 정액 코드 생성<br/>유효: 발급 시각 ~ 발급 시각 + 24시간"]
  CODE --> CLAIM["reward_claims insert, status = issued"]
  CODE -. "실패" .-> CF["code failed<br/>판정은 이미 저장돼 자동 재발급 없음"]
```

읽는 법
- 모든 예측이 다음 날 오전가로 판정되므로 실제 판정은 오전 크론(05시대와 재시도)에서만 일어난다. 오후 크론도 같은 함수를 부르지만 대상이 없다.
- 동가는 `void`이고, 빗나감(`miss`)만 0%다. 무승부에도 제출 때 약속한 보상률을 그대로 준다.
- 쿠폰은 판매가에 보상률을 곱하되, 상품 할인과 합쳐 정가의 38%를 넘지 않게 쿠폰율을 `38 − D`로 자르고 결제가가 정가의 62% 아래로 내려가면 10원씩 더 줄인다. 테스트 예: 판매가 6,500원·정가 10,000원(D 35%)에서 5% → 3%로 줄어 190원.
- 코드 유효기간은 공격형(예측) 24시간, 안정형(바로 받기) 3시간, 잠금 차액 코드는 보호 구간(16:00~다음 날 01:59:59)이다. 셋 다 발급 시각 또는 잠금 구간 기준이고, 시장일 기준이 아니다.
