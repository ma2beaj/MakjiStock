# 03. 핵심 기능별 시퀀스 다이어그램 (S1~S9)

MVP 앱(`prototype-n-development/makji-stock/`)의 핵심 기능을 라우트 핸들러부터 lib 함수, Supabase 테이블, Cafe24·외부 API까지 실제 호출 순서대로 그렸다. 아래 경로는 모두 `prototype-n-development/makji-stock/` 기준이다.

공통 표기

- `SB`는 Supabase다. 서버는 모두 `supabaseAdmin()`(service_role)으로 접근한다.
- `C24`는 Cafe24 Admin API(`https://{mall}.cafe24api.com`)다. 모든 호출은 `cafe24Request()`를 거치며, 토큰 조회·갱신 과정은 S7에 한 번만 그렸다.
- 크론 시각은 `vercel.json`(UTC)을 KST(UTC+9)로 바꿔 함께 적었다. Hobby 요금제라 지정 시각이 아니라 그 시간대 안의 아무 때나 실행된다(`lib/pricing/daily-job.ts` `resolveSession` 주석).
- 응답 코드와 에러 문구는 코드에 있는 그대로 옮겼다.
- `Note`의 "미구현"은 코드 주석이 직접 "아직/나중에/지금은 ~만" 등으로 밝힌 부분만 표시했다.

| 크론 경로 | UTC | KST | 다이어그램 |
|---|---|---|---|
| `/api/internal/reset-list-price` | 17:00 | 02:00 | S4 |
| `/api/internal/daily-pricing?session=am` | 20:30 | 05:30 (05시대) | S2 |
| `/api/internal/daily-pricing?session=am&onlyIfMissing=1` | 21:00, 22:00, 23:00, 00:00, 01:00 | 06:00, 07:00, 08:00, 09:00, 10:00 (5회) | S2 |
| `/api/internal/daily-pricing?session=pm` | 06:00 | 15:00 (15시대) | S3 |

---

## S1. 첫 화면 렌더

**요약:** `/market`·`/me` 요청 때 서버가 시세·잠금·예측·바로 받기 쿠폰을 한꺼번에 읽어 첫 HTML에 싣는다. 쿠키는 읽기만 하고 새로 발급하지 않는다.

**근거 코드:** `app/page.tsx:HomePage`, `app/(bread)/market/page.tsx:MarketPage`, `app/(bread)/me/page.tsx:MePage`, `lib/bread-market/page-data.ts:loadShellData`, `lib/bread-market/market-data.ts:loadMarketData`, `lib/bread-market/visitor-data.ts:loadLock·loadPredictions·loadInstantRewards`, `lib/visitor.ts:readVisitorHash`, `components/bread-market/Shell.tsx:BreadMarketShell`

**코드 대조일:** 2026-09-23

```mermaid
sequenceDiagram
    autonumber
    participant B as 브라우저
    participant P as Next.js 페이지<br/>(force-dynamic)
    participant L as loadShellData
    participant V as lib/visitor
    participant SB as Supabase

    B->>P: GET /
    P-->>B: redirect("/market")
    B->>P: GET /market (또는 /me)
    P->>L: loadShellData()
    par 시세 loadMarketData
        L->>SB: products select (active=true, ticker 순)
        L->>SB: daily_prices select (최근 91일)
        L->>L: isPublicAt 로 공개 전 행 제외 (오전 06시·오후 16시)
        L->>L: 막지지수 indexSeries 계산
        Note over L: 실패하면 console.error 후 market=null
    and 잠금 loadLock
        L->>V: readVisitorHash()
        alt visitor_token 쿠키 없음
            V-->>L: null
            Note over L: EMPTY_LOCK
        else 쿠키 있음
            V-->>L: HMAC 해시
            L->>SB: price_locks select (visitor_hash, 시장 날짜)
            opt reward_claim_id 있음
                L->>SB: reward_claims select (id)
                L->>L: 보호 시작(16:00) 뒤이고 만료 전일 때만 코드 복호화
            end
            Note over L: 16:00 전에는 차액 금액을 숨기고<br/>protecting 상태도 active 로 내려보냄
        end
    and 예측 loadPredictions
        L->>V: readVisitorHash()
        opt 쿠키 있음
            L->>SB: prediction_entries select (role=general, 최근 100건)
            opt 적중·무승부 기록 있음
                L->>SB: reward_claims select (prediction_entry_id in ...)
                L->>L: 만료 전 코드만 복호화
            end
        end
    and 바로 받기 쿠폰 loadInstantRewards
        L->>V: readVisitorHash()
        opt 쿠키 있음
            L->>SB: reward_claims select (round_id not null, 최근 5건)
            L->>L: 유효 기간 안의 코드만 복호화
        end
    end
    L-->>P: ShellData (clock, market, lock, predictions, instantRewards)
    P-->>B: HTML (BreadMarketShell + MarketPanel 또는 MyPanel)
    opt 화면을 켜 둔 채 장이 바뀜 (am에서 pm 등)
        B->>P: router.refresh() 로 다시 렌더
    end
```

**읽는 법**

- 네 가지 조회는 `Promise.all`로 동시에 돌고, 하나가 실패해도 빈 값으로 대신해 나머지는 그린다.
- 첫 방문자는 쿠키가 없어 잠금·예측이 빈 값으로 나온다. `visitor_token` 발급은 S5·S6의 라우트 핸들러에서만 일어난다.
- 오후가는 15시대에 이미 DB에 있어도 16:00 전에는 `isPublicAt`이 걸러 화면과 `/api/market` 어디에도 나가지 않는다.

---

## S2. 오전 가격 산정 (05시대, `onlyIfMissing=1` 재시도 포함)

**요약:** 05시대 크론이 네이버 검색지수(D-2)와 ECOS 환율을 모아 오전가를 계산·저장하고, Cafe24 판매가·옵션가를 바꾼 뒤, 밀린 예측을 판정해 보상 코드를 발급한다. 06~10시에는 보류된 상품만 다시 만든다.

**근거 코드:** `app/api/internal/daily-pricing/route.ts:GET·run`, `lib/pricing/daily-job.ts:resolveSession·searchSignalDateOf·marginCapPct·pickPreviousPrices`, `lib/pricing/naver.mjs:fetchTrendsSeparately`, `lib/pricing/fx.mjs:fetchUsdKrwOpenCloseRates`, `lib/pricing/pricing.mjs:buildSessionFxSignals·resolveSearchRatio·calculateDay`, `lib/cafe24/price-sync.ts:syncCafe24ProductPrice`, `lib/predictions/resolve.ts:resolvePredictions`, `lib/pricing/current-price.ts:currentPriceOf`, `lib/rewards/discount-code.ts:createDiscountCode`

**코드 대조일:** 2026-09-23

```mermaid
sequenceDiagram
    autonumber
    participant CR as Vercel Cron
    participant R as daily-pricing 라우트
    participant SB as Supabase
    participant NV as 네이버 검색어 트렌드
    participant EC as 한국은행 ECOS
    participant C24 as Cafe24 Admin API

    CR->>R: GET ?session=am (UTC 20:30 = KST 05시대)
    Note over CR,R: 재시도 GET ?session=am&onlyIfMissing=1<br/>UTC 21·22·23·00·01시 = KST 06·07·08·09·10시
    alt Authorization 이 Bearer CRON_SECRET 과 다름
        R-->>CR: 401 {"error":"unauthorized"}
    end
    Note over R: GET 은 commit 기본값 1, 수동 POST 는 드라이런이 기본
    R->>SB: job_runs insert (daily_pricing, am, collecting)
    R->>SB: products select (active=true)
    alt 조회 오류 또는 0건
        R->>SB: job_runs update (held, error_code=pipeline)
        R-->>CR: 502 {error:"활성 상품이 없습니다.", stage:"pipeline"}
    end
    opt onlyIfMissing=1
        R->>SB: daily_prices select (오늘, am)
        R->>R: 이미 확정가가 있는 상품 제외
        alt 남은 상품 없음 (멱등 스킵)
            R->>SB: job_runs update (completed)
            R-->>CR: 200 {mode:"skipped", reason:"이미 확정가가 있습니다."}
        end
    end
    loop 상품마다 따로 1회
        R->>NV: POST 검색어 트렌드 (D-2까지 90일, 상품 키워드 1그룹)
    end
    R->>EC: GET StatisticSearch 매매기준율 종가 (오늘-12일부터 오늘까지)
    R->>EC: GET StatisticSearch 시가
    Note over R,EC: 네트워크 오류·5xx 는 최대 4회 재시도
    R->>R: buildSessionFxSignals 로 오전 환율 신호
    alt 오전 환율 신호 없음
        R->>SB: job_runs update (held, fx_unavailable)
        R-->>CR: 200 {mode:"held", reason:"직전 두 영업일 종가를 찾지 못했습니다."}
    end
    loop 상품마다
        alt 90일 창 전체에 검색지수 없음
            R->>R: 보류 "검색지수 관측 이력 없음"
        else D-2 지수가 없어 이월값뿐
            R->>R: 보류 "검색지수 미도착"
        else 지수 있음
            R->>R: marginCapPct 로 할인 상한, calculateDay 로 판매가
        end
    end
    R->>SB: fx_rates upsert (rate_date, item_code)
    R->>SB: trend_snapshots upsert (계산된 상품만)
    R->>SB: daily_prices select (오늘 이전, 직전 확정가)
    R->>SB: daily_prices upsert (calculated, cafe24_apply_status=pending)
    Note over R,SB: 멱등 키 (product_id, publish_date, price_session, formula_version)
    alt upsert 오류
        R-->>CR: 502 {error:"daily_prices 저장 실패: ..."}
    end
    opt commit
        loop 계산된 상품마다
            alt cafe24_product_no 없음
                R->>R: skipped "cafe24_product_no 없음"
            else CAFE24_WRITES_ENABLED 가 false (로컬·프리뷰)
                R->>R: skipped "로컬 — 실몰 반영 생략" (pending 유지)
            else 반영
                opt 옵션 정가 설정(config/cafe24-option-prices.ts)이 있음
                    R->>C24: GET /api/v2/admin/products/{no}/variants
                    R->>R: 옵션별 판매가와 추가금 계산, 누락·불일치면 오류
                    Note over R: 미구현 — 데모몰 샘플 상품에는 옵션이 없어<br/>옵션이 2개 이상인 상품은 대표가만 반영
                end
                R->>C24: PUT /api/v2/admin/products/{no} (price)
                opt 옵션 갱신 대상 있음
                    R->>C24: PUT /api/v2/admin/products/{no}/variants (additional_amount)
                end
                alt 성공
                    R->>SB: daily_prices update (applied, applied_at)
                else 실패
                    R->>SB: daily_prices update (failed)
                end
            end
        end
    end
    R->>SB: prediction_entries select (general, pending, 오늘 이하, target_session=am)
    loop 판정 대상 예측마다
        alt 대상일이 오늘
            R->>R: 방금 계산한 오전가 사용
        else 밀린 날짜
            R->>SB: daily_prices select (그날 am)
        end
        opt 결과가 없음
            R->>R: 건너뜀 (다음 실행에서 다시 판정)
        end
        R->>R: resolveDirection (같은 가격이면 void 무승부)
        R->>R: 보상률 = 제출 때 약속한 값, 빗나감이면 0
        opt commit
            R->>SB: prediction_entries update (result, result_price_won, resolved_at)
            alt 판정 저장 실패
                R->>R: 코드 발급 안 함, pending 유지
            else 보상 0원 또는 cafe24_product_no 없음
                R->>R: code none
            else 보상 있음
                alt CAFE24_WRITES_ENABLED 가 false
                    R->>R: 코드 문자열만 생성 (codeNo=null)
                else
                    R->>C24: POST /api/v2/admin/discountcodes (정액, 상품 1개, 1회, 24시간)
                end
                R->>SB: reward_claims insert (prediction_entry_id, 암호화한 코드)
                R->>R: 600ms 대기 (호출 한도)
            end
        end
    end
    R->>SB: job_runs update (completed 또는 partially_failed, step_log)
    R-->>CR: 200 {mode:"committed", fx, makjiIndex, products, cafe24, predictions}
    Note over R: 이 사이 어디서든 예외가 나면 job_runs held (pipeline) 후 502
```

**읽는 법**

- 06~10시 재시도(`onlyIfMissing=1`)는 이미 확정가가 있는 상품을 빼고 돈다. 공개된 가격을 다시 덮어쓰지 않기 위해서다. 남은 상품이 없으면 외부 API를 부르지 않고 바로 끝난다.
- 검색지수가 D-2까지 오지 않은 상품은 가격을 만들지 않고 보류한다. 화면은 그동안 정가를 보여주고, 다음 재시도에서 다시 만든다.
- 예측은 모두 `target_session=am`이라 판정은 이 오전 크론에서만 일어난다. 크론을 건너뛴 날의 pending도 그날 확정가를 DB에서 읽어 함께 처리한다.
- Cafe24 호출 전 토큰 조회·갱신은 S7 아래쪽 흐름을 따른다.

---

## S3. 오후 가격 산정과 잠금 차액 코드 발급

**요약:** 15시대 크론이 당일 시가로 오후가를 계산·반영한 뒤, 오전 잠금 중 오후가가 잠금가보다 오른 건에 차액 정액 할인코드를 발급한다.

**근거 코드:** `app/api/internal/daily-pricing/route.ts:run`, `lib/locks/lock-codes.ts:issueLockCodes`, `lib/rewards/discount-code.ts:createDiscountCode`, `lib/predictions/resolve.ts:resolvePredictions`

**코드 대조일:** 2026-09-23

```mermaid
sequenceDiagram
    autonumber
    participant CR as Vercel Cron
    participant R as daily-pricing 라우트
    participant SB as Supabase
    participant NV as 네이버 검색어 트렌드
    participant EC as 한국은행 ECOS
    participant C24 as Cafe24 Admin API

    CR->>R: GET ?session=pm (UTC 06:00 = KST 15시대)
    alt 인증 실패
        R-->>CR: 401 {"error":"unauthorized"}
    end
    R->>SB: job_runs insert (daily_pricing, pm, collecting)
    R->>SB: products select (active=true)
    loop 상품마다
        R->>NV: POST 검색어 트렌드 (오전과 같은 D-2)
    end
    R->>EC: GET 종가·시가 (당일 시가 포함)
    R->>R: buildSessionFxSignals 로 오후 환율 신호
    alt 당일 시가 없음 (주말·공휴일)
        R->>SB: job_runs update (held, fx_unavailable)
        R-->>CR: 200 {mode:"held", reason:"당일 시가가 없습니다(비영업일). 오전 확정가를 유지합니다."}
    end
    R->>R: 상품별 계산 (S2와 같은 보류 규칙)
    R->>SB: fx_rates·trend_snapshots upsert, 직전 확정가 select
    R->>SB: daily_prices upsert (오늘, pm)
    opt commit
        R->>C24: 상품별 PUT 판매가·옵션가 (S2와 같은 분기)
        R->>SB: daily_prices update (applied 또는 failed)
    end
    R->>SB: price_locks select (오늘, am, active, reward_claim_id is null)
    Note over R,SB: reward_claim_id 가 빈 것만 보므로 S5의 즉시 발급과 겹쳐도 한 번만 발급
    Note over R: 미구현 — 지금은 오전 잠금(am)만 발급 대상
    loop 잠금마다
        alt 오후가를 찾을 수 없음
            R->>R: skipped "현재가를 찾을 수 없음"
        else 차액(10원 단위 내림)이 0 이하
            R->>R: skipped "이미 잠금가 이하"
        else cafe24_product_no 없음
            R->>R: skipped "cafe24_product_no 없음"
        else commit 아님
            R->>R: skipped "dry-run"
        else 발급
            alt CAFE24_WRITES_ENABLED 가 false
                R->>R: 코드 문자열만 생성 (codeNo=null)
            else
                R->>C24: POST /api/v2/admin/discountcodes (차액 정액, 유효 16:00~다음 날 01:59:59)
            end
            R->>SB: reward_claims insert (price_lock_id, 암호화한 코드, issued)
            R->>SB: price_locks update (reward_claim_id, lock_code_amount_won, protecting)
            Note over R: 도중 오류는 result failed 로 기록하고 다음 잠금으로
            R->>R: 600ms 대기
        end
    end
    R->>SB: prediction_entries select (target_session=pm)
    Note over R,SB: 모든 예측이 am 대상이라 빈 결과
    R->>SB: job_runs update (completed 또는 partially_failed)
    R-->>CR: 200 {mode:"committed", ..., lockCodes, predictions}
```

**읽는 법**

- 오후 크론도 네이버를 다시 부른다. 검색지수 날짜는 오전과 같은 D-2라 오전·오후 차이는 환율(전날 종가 대비 당일 시가)에서 나온다.
- 차액 코드는 15시대에 발급되지만 화면에는 16:00부터 보인다(S1 `loadLock`).
- 크론이 지나간 뒤 15:59까지 걸린 잠금은 이 명단에 없다. 그 잠금은 S5에서 잠그는 순간 바로 발급한다.

---

## S4. 02:00 정가 복귀

**요약:** 02시 크론이 모든 활성 상품의 Cafe24 판매가·옵션가를 정가(할인 0%)로 되돌린다.

**근거 코드:** `app/api/internal/reset-list-price/route.ts:GET·run`, `lib/cafe24/price-sync.ts:syncCafe24ProductPrice`

**코드 대조일:** 2026-09-23

```mermaid
sequenceDiagram
    autonumber
    participant CR as Vercel Cron
    participant R as reset-list-price 라우트
    participant SB as Supabase
    participant C24 as Cafe24 Admin API

    CR->>R: GET /api/internal/reset-list-price (UTC 17:00 = KST 02:00)
    alt 인증 실패
        R-->>CR: 401 {"error":"unauthorized"}
    end
    Note over R: GET 은 commit 기본값 1, 수동 POST 는 드라이런이 기본
    R->>SB: job_runs insert (reset_list_price, list, applying_cafe24)
    R->>SB: products select (active=true)
    loop 상품마다
        alt cafe24_product_no 없음
            R->>R: skipped "cafe24_product_no 없음"
        else commit 아님 또는 CAFE24_WRITES_ENABLED 가 false
            R->>R: dry-run 또는 skipped "로컬 — 실몰 반영 생략"
        else 반영
            opt 옵션 정가 설정 있음
                R->>C24: GET /api/v2/admin/products/{no}/variants
            end
            R->>C24: PUT /api/v2/admin/products/{no} (price=base_price_won)
            opt 옵션 갱신 대상 있음
                R->>C24: PUT /api/v2/admin/products/{no}/variants (옵션 정가 기준 추가금)
            end
            Note over R: 실패하면 그 상품만 failed, 성공분은 되돌리지 않음
        end
    end
    R->>SB: job_runs update (completed, partially_failed 또는 calculated)
    R-->>CR: 200 {mode:"committed", note:"02:00~05:59 정가 구간.", products}
    Note over R: 상품 조회 등에서 예외가 나면 job_runs held 후 502
```

**읽는 법**

- `daily_prices`에는 아무것도 쓰지 않는다. 몰 가격을 정가로 덮을 뿐이라 두 번 돌아도 결과가 같다.
- 잠금 차액 코드는 여기서 만들지 않는다(S3에서 발급).
- 이 시각 이후 오전가가 나올 때까지(S2) 몰과 화면은 정가다.

---

## S5. 가격 잠금 (`visitor_token` 발급 포함)

**요약:** 오전장에 손님이 빵 하나의 현재 오전가를 잠근다. 쿠키가 없으면 이때 `visitor_token`을 발급하고, 오후가가 이미 나와 있으면 그 자리에서 차액 코드를 발급한다.

**근거 코드:** `app/api/locks/route.ts:POST·tickerToProductId·protectionWindow`, `lib/market/calendar.ts:kstNow`, `lib/bread-market/reward-policy.ts:lockOpensOn`, `lib/pricing/current-price.ts:currentPriceOf`, `lib/visitor.ts:getOrCreateVisitorHash`, `lib/locks/lock-codes.ts:issueLockCodes`, `components/bread-market/sheets.tsx:confirm`

**코드 대조일:** 2026-09-23

```mermaid
sequenceDiagram
    autonumber
    participant B as 브라우저
    participant R as /api/locks
    participant V as lib/visitor
    participant SB as Supabase
    participant C24 as Cafe24 Admin API

    B->>R: POST /api/locks {ticker}
    alt ticker 와 productId 모두 없음
        R-->>B: 400 "ticker 또는 productId 가 필요합니다."
    end
    R->>R: kstNow() (시장 날짜는 02:00 에 바뀜)
    alt 06시 전 또는 16시 이후
        R-->>B: 409 "가격 잠금은 오전장(06:00~15:59)에만 할 수 있습니다."
    else 토요일·일요일
        R-->>B: 409 "주말에는 오후가가 나오지 않아 가격 잠금을 받지 않습니다. 월요일 06:00에 다시 열려요."
    end
    R->>SB: products select id (ticker, active=true)
    alt 상품 없음
        R-->>B: 404 "상품을 찾을 수 없습니다: {ticker}"
    end
    R->>SB: daily_prices select (상품, 오늘) 오전가
    alt 오늘 오전가 없음
        R-->>B: 409 "오늘 가격이 아직 나오지 않았어요. 잠시 뒤 다시 시도해주세요."
    end
    R->>V: getOrCreateVisitorHash()
    alt visitor_token 쿠키 없음 (또는 32자 미만)
        V->>V: 무작위 32바이트 토큰 생성
        V-->>B: Set-Cookie visitor_token (HttpOnly, SameSite=Lax, 1년)
        V->>V: HMAC-SHA256(VISITOR_TOKEN_HMAC_SECRET)
        V->>SB: anonymous_visitors insert (visitor_hash)
    else 쿠키 있음
        V->>V: HMAC-SHA256
        V->>SB: anonymous_visitors upsert (last_seen_at)
    end
    V-->>R: visitor_hash
    R->>SB: price_locks insert (active, 잠금가=서버가 읽은 오전가, 보호 16:00~다음 날 01:59:59)
    alt 23505 유니크 위반 (visitor_hash, lock_date)
        R-->>B: 409 "오늘은 이미 잠금을 사용했습니다. 하루에 한 번, 빵 한 개만 잠글 수 있습니다."
    else 그 밖의 오류
        R-->>B: 502 {error}
    end
    R->>SB: daily_prices select (상품, 오늘) 오후가 확인
    opt 오후가가 이미 있음 (오후 크론 이후 15:59 까지)
        R->>SB: price_locks select (이 잠금, reward_claim_id is null)
        R->>C24: POST /api/v2/admin/discountcodes (차액, S3와 같은 분기)
        R->>SB: reward_claims insert, price_locks update (protecting)
        Note over R: 발급이 실패해도 잠금은 되돌리지 않고 console.error 만 남김
    end
    R-->>B: 201 {lock, protectLabel:"오늘 16:00–새벽 01:59"}
    B->>B: localStorage 에 잠금 기록, 토스트 표시
```

**읽는 법**

- 잠금가는 브라우저가 보내지 않는다. 서버가 `daily_prices`에서 읽는다.
- 하루 1회 제한은 앱 코드가 아니라 `price_locks (visitor_hash, lock_date)` 유니크 제약이 막고, 라우트는 `23505`를 409로 바꿔 돌려준다.
- 즉시 발급은 오후가가 실제로 있을 때만 한다. 주말처럼 오전가로 대신 채워진 경우(`session`이 am)는 대상이 아니다.

---

## S6. 가격 예측 제출과 바로 받기

**요약:** 손님은 한 회차에 "내일 06:00 오전가가 오를까 내릴까" 예측과 "바로 받기"(확정 쿠폰) 중 하나만 고를 수 있다. 예측 판정과 보상 발급은 S2 오전 크론에서 한다.

**근거 코드:** `app/api/predictions/route.ts:POST·GET`, `app/api/predictions/instant/route.ts:POST`, `lib/predictions/schedule.ts:predictionSchedule`, `lib/pricing/current-price.ts:currentPriceOf`, `lib/bread-market/reward-policy.ts:rollPredictionRewardPct·instantRewardPct·couponAmountWon·instantCodeValidUntil`, `lib/visitor.ts:getOrCreateVisitorHash`, `lib/rewards/discount-code.ts:createDiscountCode`, `components/bread-market/sheets.tsx:vote·takeNow`

**코드 대조일:** 2026-09-23

### S6-a. 예측 제출

```mermaid
sequenceDiagram
    autonumber
    participant B as 브라우저
    participant R as /api/predictions
    participant V as lib/visitor
    participant SB as Supabase

    B->>R: POST /api/predictions {ticker, direction}
    alt direction 이 up·down 이 아님
        R-->>B: 400 "direction 은 up 또는 down 이어야 합니다."
    else ticker 와 productId 모두 없음
        R-->>B: 400 "ticker 또는 productId 가 필요합니다."
    end
    R->>R: kstNow() (00~01시는 전날 24·25시로 계산)
    alt 06시 전 (02:00~05:59 정가 구간)
        R-->>B: 409 "정가 시간에는 예측할 수 없습니다. 06:00 오전가부터 가능합니다."
    end
    R->>R: predictionSchedule (기준가=지금 장, 판정=다음 날 06:00 오전가)
    R->>SB: products select id (ticker)
    alt 상품 없음
        R-->>B: 404 "상품을 찾을 수 없습니다: {ticker}"
    end
    R->>SB: daily_prices select (오늘, 지금 장, 오후장이면 오전가로 대신)
    alt 오늘 확정가 없음
        R-->>B: 409 "오늘 가격이 아직 나오지 않았어요. 잠시 뒤 다시 시도해주세요."
    end
    R->>SB: prediction_rounds upsert (id=날짜-am, open)
    alt 오류
        R-->>B: 502 {error}
    end
    R->>V: getOrCreateVisitorHash() (S5와 같은 쿠키 발급)
    V-->>R: visitor_hash
    R->>SB: reward_claims select (round_id, visitor_hash)
    alt 이 회차에 바로 받기를 이미 받음
        R-->>B: 409 "이번 회차에는 이미 할인코드를 받았어요. 다음 장에 예측할 수 있어요."
    end
    R->>R: rollPredictionRewardPct() 로 적중 보상률(5~20%)을 제출 때 확정
    R->>SB: prediction_entries insert (general, pending, reference_price_won, reward_rate_pct)
    alt 23505 유니크 위반 (round_id, visitor_hash)
        R-->>B: 409 "이번 회차에는 이미 예측했습니다. 다음 장에 다시 참여할 수 있어요."
    else 그 밖의 오류
        R-->>B: 502 {error}
    end
    R-->>B: 201 {entry, targetLabel:"내일 06:00 오전가", rewardOnHitPct}
    B->>R: GET /api/predictions
    R->>SB: loadPredictions (S1과 같은 조회)
    R-->>B: 200 {predictions}
    Note over R: 미구현 — 구매 후 기준가 예측은 Cafe24 주문과 방문자를 잇는 다리가 생긴 뒤 판단
```

### S6-b. 바로 받기

```mermaid
sequenceDiagram
    autonumber
    participant B as 브라우저
    participant R as /api/predictions/instant
    participant V as lib/visitor
    participant SB as Supabase
    participant C24 as Cafe24 Admin API

    B->>R: POST /api/predictions/instant {ticker}
    alt ticker 와 productId 모두 없음
        R-->>B: 400 "ticker 또는 productId 가 필요합니다."
    end
    alt 06시 전
        R-->>B: 409 "정가 시간에는 받을 수 없습니다. 06:00 오전가부터 가능합니다."
    end
    R->>SB: products select (ticker 또는 id, active=true)
    alt 상품 없음
        R-->>B: 404 "상품을 찾을 수 없습니다: {ticker}"
    else cafe24_product_no 없음
        R-->>B: 409 "이 상품은 아직 쿠폰을 발급할 수 없어요."
    end
    R->>SB: daily_prices select (오늘 확정가)
    alt 없음
        R-->>B: 409 "오늘 가격이 아직 나오지 않았어요. 잠시 뒤 다시 시도해주세요."
    end
    R->>V: getOrCreateVisitorHash()
    V-->>R: visitor_hash
    R->>SB: prediction_entries select (round_id, visitor_hash)
    alt 이 회차에 이미 예측함
        R-->>B: 409 "이번 회차에는 이미 예측했어요. 결과는 내일 06:00에 나와요."
    end
    R->>R: instantRewardPct (회차에서 정해지는 10~15%), couponAmountWon (총할인 38% 상한)
    alt 쿠폰 금액 0원 이하
        R-->>B: 409 "지금은 할인 여력이 없어요. 잠시 뒤 다시 시도해주세요."
    end
    R->>SB: prediction_rounds upsert (예측과 같은 회차)
    alt 오류
        R-->>B: 502 {error}
    end
    alt CAFE24_WRITES_ENABLED 가 false
        R->>R: 코드 문자열만 생성 (codeNo=null)
    else
        R->>C24: POST /api/v2/admin/discountcodes (정액, 상품 1개, 1회, 3시간)
        alt 실패
            R-->>B: 502 {error: 오류 메시지 또는 "쿠폰을 만들지 못했어요."}
        end
    end
    R->>SB: reward_claims insert (round_id, product_id, 암호화한 코드)
    alt 23505 유니크 위반 (round_id, visitor_hash)
        R-->>B: 409 "이번 회차에는 이미 받았어요."
    else 그 밖의 오류
        R-->>B: 502 {error}
    end
    R-->>B: 201 {code, amountWon, ratePct, validUntil, validHours:3, productName}
    B->>B: router.refresh() 와 GET /api/predictions 로 화면 갱신
    Note over R: 미구현 — 구매 확인 수단이 없어 "지금 사면"이 아니라<br/>"오늘 예측을 넘기고 확정 쿠폰 받기"로만 동작
```

**읽는 법**

- 두 라우트는 서로의 기록을 먼저 조회해 막고, 동시에 들어온 요청은 DB 부분 유니크 인덱스(`prediction_entries`, `reward_claims`의 `(round_id, visitor_hash)`)가 최종으로 막는다.
- 회차 ID는 `{시장 날짜}-am` 하나뿐이다. 오후장(16:00~다음 날 01:59) 제출도 같은 날 회차이고, 판정은 모두 다음 날 06:00 오전가다.
- 바로 받기는 Cafe24 코드를 먼저 만들고 나서 `reward_claims`에 저장한다. 저장 단계에서 23505가 나면 몰에 만든 코드는 DB에 기록되지 않은 채 남는다.
- 적중·무승부(같은 가격) 판정과 예측 보상 코드 발급은 S2의 `resolvePredictions` 구간을 본다.

---

## S7. Cafe24 OAuth 연결과 토큰 자동 갱신

**요약:** 운영자가 한 번 동의하면 토큰을 암호화해 `cafe24_tokens`에 저장하고, 이후 모든 Admin API 호출은 만료 5분 전 자동 갱신과 401 재시도를 거친다.

**근거 코드:** `app/api/auth/cafe24/start/route.ts:GET`, `app/api/auth/cafe24/callback/route.ts:GET`, `lib/cafe24/client.ts:requestToken·save·exchangeCodeForTokens·getAccessToken·cafe24Request·parseCafe24Time`, `lib/crypto.ts:encryptSecret·decryptSecret`

**코드 대조일:** 2026-09-23

### S7-a. 최초 연결

```mermaid
sequenceDiagram
    autonumber
    participant O as 운영자 브라우저
    participant S as /api/auth/cafe24/start
    participant CB as /api/auth/cafe24/callback
    participant OA as Cafe24 OAuth
    participant SB as Supabase

    O->>S: GET /api/auth/cafe24/start
    S->>S: state 무작위 16바이트
    S-->>O: Set-Cookie cafe24_oauth_state (HttpOnly, 10분, path=/api/auth/cafe24)
    S-->>O: 302 /api/v2/oauth/authorize (code, client_id, state, redirect_uri, scope)
    Note over S,O: scope = mall.read_product, mall.write_product,<br/>mall.read_promotion, mall.write_promotion
    O->>OA: 동의 화면
    OA-->>O: 302 callback?code=...&state=...
    O->>CB: GET /api/auth/cafe24/callback
    alt error 파라미터 있음
        CB-->>O: 400 "인증이 취소됐습니다"
    else state 가 쿠키 값과 다름 (또는 쿠키 만료)
        CB-->>O: 400 "state 검증 실패"
    end
    CB->>CB: state 쿠키 삭제
    alt code 없음
        CB-->>O: 400 "code 가 없습니다"
    end
    CB->>OA: POST /api/v2/oauth/token (authorization_code, Basic 인증)
    alt 4xx
        CB->>OA: POST /api/v2/oauth/token (client_id·secret 을 body 에 넣어 재시도)
    end
    Note over CB: 미구현(ponytail) — 두 방식 중 실제로 되는 쪽을 확인하면 하나만 남길 예정
    alt 두 방식 모두 실패 또는 5xx
        CB-->>O: 502 "토큰 교환 실패" (Cafe24 토큰 요청 실패 — ...)
    end
    CB->>CB: 만료 시각에 +09:00 부여, 두 토큰 암호화
    CB->>SB: cafe24_tokens upsert (mall_id 한 행)
    alt 저장 오류
        CB-->>O: 502 "토큰 교환 실패" (토큰 저장 실패: ...)
    end
    CB-->>O: 200 "Cafe24 연결 완료" (만료 시각 표시)
```

### S7-b. Admin API 호출 때 토큰 자동 갱신 (`cafe24Request`)

```mermaid
sequenceDiagram
    autonumber
    participant X as 호출처<br/>(S2·S3·S4·S5·S6·S9)
    participant CL as cafe24Request
    participant SB as Supabase
    participant OA as Cafe24 OAuth
    participant C24 as Cafe24 Admin API

    X->>CL: cafe24Request(path, method)
    alt GET 이 아니고 CAFE24_WRITES_ENABLED 가 false
        CL-->>X: throw "로컬에서는 Cafe24 쓰기를 보내지 않습니다 (...)"
    end
    CL->>SB: cafe24_tokens select (mall_id)
    alt 행 없음
        CL-->>X: throw "Cafe24 토큰이 없습니다. /api/auth/cafe24/start 로 인증을 먼저 진행하세요."
    else access_token 만료까지 5분 넘게 남음
        CL->>CL: access_token 복호화
    else refresh_token 도 만료
        CL-->>X: throw "refresh_token 이 만료됐습니다. /api/auth/cafe24/start 로 다시 인증하세요."
    else 갱신 필요
        CL->>OA: POST /api/v2/oauth/token (refresh_token, S7-a와 같은 재시도)
        CL->>SB: cafe24_tokens upsert (새 access·refresh 토큰 암호문)
    end
    CL->>C24: 요청 (Authorization Bearer)
    opt 401
        CL->>SB: cafe24_tokens update (access_token_expires_at = 1970-01-01)
        CL->>OA: POST /api/v2/oauth/token (refresh_token)
        CL->>SB: cafe24_tokens upsert
        CL->>C24: 같은 요청 한 번 더
    end
    alt 응답이 2xx 가 아님
        CL-->>X: throw "Cafe24 {path} {status}: ..."
    end
    CL-->>X: JSON
```

**읽는 법**

- 토큰 원문은 DB에 두지 않고 `*_ciphertext` 컬럼에 암호문으로만 저장한다.
- 갱신 때 refresh_token도 새로 내려오므로 두 토큰을 함께 덮어쓴다.
- 로컬·프리뷰에서 실몰 쓰기를 막는 최종 방어선은 각 호출처가 아니라 `cafe24Request` 첫머리다. `NODE_ENV=production`이거나 `CAFE24_ALLOW_LOCAL_WRITES=1`일 때만 쓰기가 나간다.

---

## S8. 구매 이동 (`/api/out/cafe24/[productId]`)

**요약:** 구매 버튼은 우리 서버를 거쳐 Cafe24 상품 상세로 302 이동한다. 목적지는 서버가 DB·설정 파일로 조립한다.

**근거 코드:** `app/api/out/cafe24/[productId]/route.ts:GET`, `config/cafe24-product-map.json`, `components/bread-market/sheets.tsx`·`MyPanel.tsx`(`window.open`)

**코드 대조일:** 2026-09-23

```mermaid
sequenceDiagram
    autonumber
    participant B as 브라우저 (새 탭)
    participant R as /api/out/cafe24/[productId]
    participant SB as Supabase
    participant M as 데모몰 또는 자사몰

    B->>R: GET /api/out/cafe24/{ticker 또는 product_id}
    alt 경로 끝이 비어 있음
        R-->>B: 400 "상품이 지정되지 않았습니다."
    end
    R->>R: SHOP_TARGET 이 live 면 live, 아니면 demo
    R->>SB: products select (id 또는 ticker 일치, active=true)
    Note over R,SB: shop_url 컬럼은 live 일 때만 조회
    alt 조회 오류
        R-->>B: 502 {error}
    else 상품 없음
        R-->>B: 404 "상품을 찾을 수 없습니다: {key}"
    end
    alt live
        alt shop_url 있음
            R-->>B: 302 shop_url
        else
            R-->>B: 302 https://makji.kr/
        end
    else demo
        R->>R: mallId = cafe24-product-map.json 의 _mallId 또는 CAFE24_MALL_ID
        alt mallId 없음
            R-->>B: 500 "CAFE24_MALL_ID 가 없습니다."
        end
        R->>R: productNo = 수동 매핑 우선, 없으면 products.cafe24_product_no
        alt productNo 없음
            R-->>B: 302 https://{mall}.cafe24.com/
        else
            R-->>B: 302 https://{mall}.cafe24.com/product/detail.html?product_no={no}
        end
    end
    B->>M: 상품 상세 열기
    Note over R: 미구현 — 구매 링크 이동을 events 에 남기는 일은 나중에 한다.<br/>지금은 이동만 한다
```

**읽는 법**

- 브라우저가 보낸 URL을 그대로 쓰지 않고 상품 키로 DB를 찾아 목적지를 만들므로, 임의 주소로 보내는 오픈 리다이렉트가 생기지 않는다.
- 데모 모드는 DB 상품번호보다 `config/cafe24-product-map.json` 수동 매핑을 먼저 쓴다. DB 동기화(S9) 전이어도 의도한 샘플 상품으로 간다.
- 방문자 식별·클릭 기록은 하지 않는다. `visitor_token`도 읽지 않는다.

---

## S9. 상품번호 동기화

**요약:** 운영자가 Cafe24 상품 목록을 읽어 `products.cafe24_product_no`를 채운다. GET은 드라이런, POST는 실제 반영이다.

**근거 코드:** `app/api/internal/sync-products/route.ts:GET·POST·buildPlan·normalize`, `config/cafe24-product-map.json`, `lib/cafe24/client.ts:cafe24Request`

**코드 대조일:** 2026-09-23

```mermaid
sequenceDiagram
    autonumber
    participant O as 운영자 (curl 등)
    participant R as /api/internal/sync-products
    participant C24 as Cafe24 Admin API
    participant SB as Supabase

    O->>R: GET 또는 POST (Authorization Bearer CRON_SECRET)
    alt 인증 실패
        R-->>O: 401 {"error":"unauthorized"}
    end
    R->>C24: GET /api/v2/admin/products?shop_no=...&limit=100&fields=product_no,product_name,price
    Note over R,C24: 토큰 처리는 S7-b
    R->>SB: products select (active 조건 없이 전체)
    loop 우리 상품마다
        alt cafe24-product-map.json 에 수동 매핑 있음
            R->>R: 몰 목록에 그 번호가 있으면 manual, 없으면 none
        else
            R->>R: 이름 정규화 후 완전 일치(exact), 포함 관계(loose), 없으면 none
        end
    end
    Note over R: 미구현 — 데모몰 임시 수동 매핑. 실제 상품이 등록되면<br/>매핑 파일을 지워 이름 매칭으로 전환할 예정
    alt GET
        R-->>O: 200 {mode:"dry-run", matches, unmatched, note:"반영하려면 같은 경로로 POST 하세요."}
    else POST
        alt 매칭된 상품 0건
            R-->>O: 409 {error:"매칭된 상품이 없습니다.", ...plan}
        end
        loop 매칭된 상품마다
            R->>SB: products update (cafe24_product_no)
            alt 오류
                R-->>O: 502 {error:"{ticker} 저장 실패: ..."}
            end
        end
        R-->>O: 200 {mode:"committed", updated, unmatched}
    end
    Note over R: Cafe24 조회 등에서 예외가 나면 502
```

**읽는 법**

- 크론에 등록되지 않은 수동 작업이다. 인증은 크론과 같은 `CRON_SECRET`을 쓴다.
- Cafe24에는 GET만 보낸다. 상품 등록이나 내용 변경은 하지 않는다.
- 몰 상품 목록은 `limit=100` 한 페이지만 읽는다. 100개가 넘는 몰에서는 뒤쪽 상품이 매칭 후보에서 빠진다.
