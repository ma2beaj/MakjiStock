# 01. 시스템 아키텍처

- 대상 코드: `prototype-n-development/makji-stock/` (아래 경로는 모두 이 폴더 기준)
- 이 파일의 다이어그램: A1 시스템 컨텍스트 · A2 배포·운영 구성도 · A3 코드 모듈 의존도
- 기존 `assets/diagrams/시스템 아키텍처.pdf`는 A1로 옮겼다. PDF와 코드가 다른 부분은 코드를 따랐다.

화살표 규칙 (세 다이어그램 공통)

| 모양 | 뜻 |
|---|---|
| `-->` 실선 | 읽기, 호출 |
| `==>` 굵은 선 | 쓰기 (DB 저장, Cafe24 가격·쿠폰 반영) |
| `-.->` 점선 | 사용자 이동, 리다이렉트, 타입만 가져오기 |

---

## A1. 시스템 컨텍스트

**요약:** 가격은 크론이 외부 데이터를 모아 계산해 DB와 Cafe24에 쓰고, 화면은 서버 렌더가 DB를 읽어 첫 HTML에 담아 보낸다.

**근거 코드**

- 화면: `app/(bread)/market/page.tsx`, `app/(bread)/me/page.tsx`, `app/page.tsx`(`/market`으로 리다이렉트), `lib/bread-market/page-data.ts`
- 공개 API: `app/api/market/route.ts`, `app/api/locks/route.ts`, `app/api/predictions/route.ts`, `app/api/predictions/instant/route.ts`, `app/api/out/cafe24/[productId]/route.ts`
- 내부 API: `app/api/internal/daily-pricing/route.ts`, `app/api/internal/reset-list-price/route.ts`, `app/api/internal/sync-products/route.ts`
- Cafe24: `app/api/auth/cafe24/start/route.ts`, `app/api/auth/cafe24/callback/route.ts`, `lib/cafe24/client.ts`, `lib/cafe24/price-sync.ts`, `lib/rewards/discount-code.ts`
- 외부 데이터: `lib/pricing/naver.mjs`, `lib/pricing/fx.mjs`
- DB: `lib/supabase/admin.ts`, `supabase/rls.sql`, `supabase/migrations/001_cafe24_tokens.sql`
- 브라우저 호출: `components/bread-market/Shell.tsx`, `components/bread-market/sheets.tsx`, `components/bread-market/MyPanel.tsx`

**코드 대조일:** 2026-09-23

```mermaid
flowchart LR
  subgraph Client["브라우저 · 익명 방문자"]
    B["/market · /me<br/>로그인 없음<br/>visitor_token HttpOnly 쿠키"]
    OP["운영자 브라우저"]
  end

  subgraph Vercel["Vercel · Next.js 16 App Router · React 19"]
    SSR["서버 렌더<br/>force-dynamic<br/>loadShellData()"]
    PUB["공개 API<br/>GET·POST /api/locks<br/>GET·POST /api/predictions<br/>POST /api/predictions/instant<br/>GET /api/out/cafe24/[productId]"]
    MKT["GET /api/market<br/>화면에서 호출하는 곳 없음"]
    INT["내부 API · Bearer CRON_SECRET<br/>/api/internal/daily-pricing<br/>/api/internal/reset-list-price<br/>/api/internal/sync-products"]
    OAUTH["Cafe24 OAuth<br/>/api/auth/cafe24/start<br/>/api/auth/cafe24/callback"]
    CRON["Vercel Cron · 8개<br/>reset-list-price 1개<br/>daily-pricing 7개"]
  end

  subgraph SB["Supabase · PostgreSQL · RLS 켜짐 · service role 키로만 접근"]
    T1["시세<br/>products · daily_prices<br/>trend_snapshots · fx_rates"]
    T2["방문자·참여<br/>anonymous_visitors · price_locks<br/>prediction_rounds · prediction_entries"]
    T3["보상·운영<br/>reward_claims · job_runs"]
    T4["인증<br/>cafe24_tokens · AES-256-GCM 암호문"]
    EV["events<br/>코드에서 쓰지 않음 · 미구현"]
  end

  NAVER["네이버 데이터랩 검색어 트렌드<br/>naverapihub.apigw.ntruss.com 기본<br/>openapi.naver.com 선택"]
  ECOS["한국은행 ECOS<br/>ecos.bok.or.kr · 731Y003<br/>원/달러 시가·종가"]

  subgraph C24["Cafe24 Admin API · CAFE24_MALL_ID.cafe24api.com"]
    C24R["읽기<br/>GET /api/v2/admin/products<br/>GET /api/v2/admin/products/{no}/variants"]
    C24W["쓰기<br/>PUT /api/v2/admin/products/{no}<br/>PUT /api/v2/admin/products/{no}/variants<br/>POST /api/v2/admin/discountcodes"]
    C24O["OAuth<br/>GET /api/v2/oauth/authorize<br/>POST /api/v2/oauth/token"]
  end

  SHOP["쇼핑몰 · 실제 결제<br/>SHOP_TARGET=demo: CAFE24_MALL_ID.cafe24.com 상품 상세<br/>SHOP_TARGET=live: products.shop_url, 없으면 makji.kr"]

  B -->|"페이지 요청"| SSR
  B -->|"fetch"| PUB
  SSR -->|"읽기"| T1
  SSR -->|"읽기"| T2
  SSR -->|"읽기"| T3
  PUB -->|"읽기"| T1
  PUB ==>|"쓰기"| T2
  PUB ==>|"쓰기 reward_claims"| T3
  PUB ==>|"바로 받기 쿠폰<br/>POST discountcodes"| C24W
  MKT -->|"읽기"| T1

  CRON -->|"GET + Authorization 헤더"| INT
  INT -->|"검색 지수 읽기"| NAVER
  INT -->|"환율 읽기"| ECOS
  INT ==>|"daily_prices · fx_rates<br/>trend_snapshots · products"| T1
  INT ==>|"예측 판정 · 잠금 코드 기록"| T2
  INT ==>|"reward_claims · job_runs"| T3
  INT -->|"상품 목록 · 옵션 읽기"| C24R
  INT ==>|"판매가 · 옵션가 · 할인코드"| C24W

  OP -.->|"연결 시작"| OAUTH
  OAUTH -.->|"302 동의 화면"| C24O
  OAUTH -->|"code를 토큰으로 교환"| C24O
  OAUTH ==>|"토큰 암호화 저장"| T4
  INT -->|"토큰 조회 · 만료 전 갱신"| T4
  PUB -->|"토큰 조회 · 만료 전 갱신"| T4

  B -.->|"구매 버튼"| PUB
  PUB -.->|"302 리다이렉트"| SHOP
  C24W ==>|"CAFE24_MALL_ID 몰의 판매가 · 쿠폰"| SHOP
```

**읽는 법**

- 가격을 만드는 쪽은 크론과 내부 API다. 네이버·ECOS를 읽고, DB에 쓰고, Cafe24에 판매가를 반영한다. 화면을 그리는 쪽은 서버 렌더와 공개 API이며 DB만 읽는다.
- 공개 API 중 Cafe24에 쓰는 곳이 하나 있다. `POST /api/predictions/instant`(바로 받기)가 할인코드를 바로 만든다. 브라우저는 Supabase·Cafe24·네이버·ECOS를 직접 부르지 않는다.
- `SHOP_TARGET`은 구매 버튼이 보내는 주소만 바꾼다. 가격 반영(PUT)과 쿠폰 발급은 언제나 `CAFE24_MALL_ID` 몰로 간다.
- `events` 테이블은 스키마에만 있고, `fx_rates`·`trend_snapshots`는 쓰기만 하고 앱에서 다시 읽지 않는다(기록용).

---

## A2. 배포·운영 구성도

**요약:** `main` 푸시와 PR마다 GitHub Actions가 `npm test`를 돌리고, Vercel 크론 8개가 하루 가격 주기를 돌린다. Cafe24 쓰기는 `NODE_ENV`와 `CAFE24_ALLOW_LOCAL_WRITES`로 정해진다.

**근거 코드**

- CI: `/.github/workflows/ci.yml`(저장소 루트), `package.json`의 `test` 스크립트
- 크론: `vercel.json`
- 크론 인증·실행 모드: `app/api/internal/daily-pricing/route.ts:47-75`, `app/api/internal/reset-list-price/route.ts:30-38`, `app/api/internal/sync-products/route.ts:12-16`, `:92-102`
- 환경변수: `.env.example`, `lib/supabase/admin.ts`, `lib/cafe24/client.ts`, `lib/pricing/naver.mjs`, `lib/pricing/fx.mjs`, `lib/crypto.ts`, `lib/visitor.ts`, `lib/market/calendar.ts`
- 스위치: `app/api/out/cafe24/[productId]/route.ts:21`, `lib/cafe24/client.ts:170-185`, `lib/rewards/discount-code.ts:19-52`, `app/api/internal/daily-pricing/route.ts:310`, `app/api/internal/reset-list-price/route.ts:88`

**코드 대조일:** 2026-09-23

```mermaid
flowchart TB
  subgraph GH["GitHub 저장소"]
    DEV["개발자 푸시 · PR"]
    CI["GitHub Actions · CI<br/>on: push main, pull_request<br/>ubuntu-latest · Node 22<br/>작업 폴더 prototype-n-development/makji-stock<br/>npm ci → npm test"]
    TEST["npm test =<br/>test:pricing · test:backtest<br/>typecheck · lint"]
  end

  VDEP["Vercel 배포<br/>Git 연동 설정은 저장소 밖에 있어<br/>코드로 확인 불가"]

  DEV --> CI --> TEST
  DEV -.->|"Vercel Git 연동 · CI 결과와 무관"| VDEP

  subgraph RUN["Vercel 런타임"]
    APP["Next.js 앱"]
    subgraph CRONS["vercel.json 크론 8개 · UTC 기준 · 괄호는 KST"]
      K1["0 17 * * * (02:00)<br/>reset-list-price"]
      K2["30 20 * * * (05:30)<br/>daily-pricing?session=am"]
      K3["0 21 · 0 22 · 0 23 · 0 0 · 0 1<br/>(06:00 · 07:00 · 08:00 · 09:00 · 10:00)<br/>daily-pricing?session=am&onlyIfMissing=1"]
      K4["0 6 * * * (15:00)<br/>daily-pricing?session=pm"]
    end
    MANUAL["수동 호출 전용 · 크론 없음<br/>sync-products<br/>GET 드라이런 · POST 반영"]
  end

  VDEP --> APP
  K1 & K2 & K3 & K4 -->|"GET · Bearer CRON_SECRET<br/>GET은 기본 반영, POST는 기본 드라이런"| APP
  MANUAL -->|"Bearer CRON_SECRET"| APP

  subgraph ENV["환경변수 그룹"]
    E1["Supabase<br/>NEXT_PUBLIC_SUPABASE_URL<br/>SUPABASE_SERVICE_ROLE_KEY"]
    E2["네이버 · ECOS<br/>NAVER_CLIENT_ID · NAVER_CLIENT_SECRET<br/>NAVER_PROVIDER hub 기본 · openapi<br/>BOK_ECOS_API_KEY"]
    E3["Cafe24<br/>CAFE24_MALL_ID · CAFE24_SHOP_NO<br/>CAFE24_CLIENT_ID · CAFE24_CLIENT_SECRET<br/>CAFE24_REDIRECT_BASE_URL"]
    E4["비밀키<br/>CRON_SECRET<br/>TOKEN_ENCRYPTION_KEY<br/>VISITOR_TOKEN_HMAC_SECRET"]
    E5["스위치<br/>SHOP_TARGET demo 기본 · live<br/>CAFE24_ALLOW_LOCAL_WRITES"]
    E6["개발 전용 · NODE_ENV가 production이 아닐 때만<br/>DEV_KST_DATE · DEV_KST_HOUR"]
    E7["Vercel 자동 주입<br/>NODE_ENV · VERCEL_PROJECT_PRODUCTION_URL"]
    E8[".env.example에만 있고 앱 코드가 읽지 않음<br/>NEXT_PUBLIC_SUPABASE_ANON_KEY · EMAIL_ENCRYPTION_KEY<br/>MAIL_API_KEY · MAIL_FROM<br/>NAVER_API_HUB_CLIENT_ID · SECRET는 scripts에서만"]
  end
  ENV --> APP

  subgraph SW["Cafe24 쓰기 스위치 · lib/cafe24/client.ts"]
    Q{"NODE_ENV = production<br/>또는<br/>CAFE24_ALLOW_LOCAL_WRITES = 1 ?"}
    ON["CAFE24_WRITES_ENABLED = true<br/>PUT 판매가·옵션가, POST 할인코드 전송"]
    OFF["CAFE24_WRITES_ENABLED = false<br/>daily-pricing: DB 저장만, cafe24_apply_status는 pending<br/>reset-list-price: 반영 건너뜀<br/>할인코드: 문자열만 DB에, codeNo null<br/>cafe24Request: GET 외 요청은 예외"]
    Q -->|"예"| ON
    Q -->|"아니오"| OFF
  end
  APP --> Q

  subgraph ST["구매 링크 스위치 · /api/out/cafe24/[productId]"]
    S1{"SHOP_TARGET = live ?"}
    SL["products.shop_url로 302<br/>없으면 https://makji.kr/"]
    SD["config/cafe24-product-map.json의 몰 ·<br/>상품번호로 302<br/>상품 상세 페이지"]
    S1 -->|"예"| SL
    S1 -->|"아니오 · 기본"| SD
  end
  APP --> S1
```

**크론 일정 (vercel.json)**

| UTC | KST | 경로 | 하는 일 |
|---|---|---|---|
| `0 17 * * *` | 02:00 | `/api/internal/reset-list-price` | Cafe24 판매가를 정가로 되돌린다 |
| `30 20 * * *` | 05:30 | `/api/internal/daily-pricing?session=am` | 오전가 계산·저장·반영, 전날 예측 판정 |
| `0 21 * * *` | 06:00 | `…?session=am&onlyIfMissing=1` | 오전가가 없는 상품만 다시 만든다 |
| `0 22 * * *` | 07:00 | 같음 | 같음 |
| `0 23 * * *` | 08:00 | 같음 | 같음 |
| `0 0 * * *` | 09:00 | 같음 | 같음 |
| `0 1 * * *` | 10:00 | 같음 | 같음 |
| `0 6 * * *` | 15:00 | `/api/internal/daily-pricing?session=pm` | 오후가 계산·저장·반영, 오전 잠금 차액 코드 발급, 예측 판정 |

**읽는 법**

- CI는 테스트만 돌린다. 배포 단계가 없으므로 Vercel 배포는 CI 성공과 묶여 있지 않다. Vercel 쪽 연동·루트 폴더 설정은 저장소에 없어 그리지 않았다.
- `CAFE24_WRITES_ENABLED`는 환경변수가 아니라 코드에서 계산하는 값이다. 실제로 켜고 끄는 환경변수는 `CAFE24_ALLOW_LOCAL_WRITES`다. 코드는 `NODE_ENV`만 보므로 `next dev`에서는 막히고, `NODE_ENV=production`으로 도는 배포에서는 열린다. Vercel은 프리뷰 배포도 기본으로 `NODE_ENV=production`으로 실행하므로, 코드 주석의 "로컬·프리뷰는 막는다"와 달리 프리뷰에서도 쓰기가 나갈 수 있다. 할인코드 접두사는 이 스위치와 별개로 `NODE_ENV`만 보고 정한다(production이면 `MJ`, 아니면 `MJT`).
- `SHOP_TARGET`은 구매 이동 라우트 한 곳에서만 읽는다. 가격 반영 대상 몰은 `CAFE24_MALL_ID`가 정한다. 내부 API는 헤더의 `CRON_SECRET`이 맞아야 실행되고, `CRON_SECRET`이 비어 있으면 모두 401을 돌려준다.

---

## A3. 코드 모듈 의존도

**요약:** 화면·라우트가 어떤 `lib/*` 모듈을 거쳐 Supabase·Cafe24·외부 API에 닿는지, 실제 `import` 문만 보고 그렸다. 요청 처리 경로(A3-1)와 자동 작업·운영 경로(A3-2)로 나눴다.

**근거 코드**

- `app/**/*.ts(x)`, `components/bread-market/*.tsx`, `lib/**/*.ts`, `lib/**/*.mjs`의 `import … from` 문 (grep으로 확인, 여러 줄 import 포함)
- 외부 호출 지점: `lib/supabase/admin.ts`(`createClient`), `lib/cafe24/client.ts`(`fetch …cafe24api.com`), `lib/pricing/naver.mjs`, `lib/pricing/fx.mjs`

**코드 대조일:** 2026-09-23

### A3-1. 요청 처리 경로 (화면 · 공개 API)

```mermaid
flowchart LR
  subgraph PAGES["app/(bread) 화면"]
    PM["market/page.tsx"]
    PME["me/page.tsx"]
  end

  subgraph COMP["components/bread-market · 클라이언트"]
    CS["Shell.tsx"]
    CMP["MarketPanel.tsx"]
    CMY["MyPanel.tsx"]
    CSH["sheets.tsx"]
    CCTX["context.ts"]
  end

  subgraph API["app/api 공개 라우트"]
    RM["market/route.ts"]
    RL["locks/route.ts"]
    RP["predictions/route.ts"]
    RI["predictions/instant/route.ts"]
    RO["out/cafe24/[productId]/route.ts"]
  end

  subgraph LIB["lib"]
    PD["bread-market/page-data.ts"]
    MD["bread-market/market-data.ts"]
    VD["bread-market/visitor-data.ts"]
    ENG["bread-market/engine.ts"]
    STO["bread-market/store.ts"]
    FLO["bread-market/flow.ts"]
    RWP["bread-market/reward-policy.ts"]
    SCH["predictions/schedule.ts"]
    CAL["market/calendar.ts"]
    CUR["pricing/current-price.ts"]
    VIS["visitor.ts"]
    CRY["crypto.ts"]
    LCK["locks/lock-codes.ts"]
    DSC["rewards/discount-code.ts"]
    C24["cafe24/client.ts"]
    ADM["supabase/admin.ts"]
  end

  CFGP["config/pricing-products.json"]
  CFGM["config/cafe24-product-map.json"]

  SUPA[("Supabase")]
  CAFE[["Cafe24 Admin API"]]

  PM --> PD
  PME --> PD
  PM --> CS
  PM --> CMP
  PME --> CS
  PME --> CMY

  CS --> ENG
  CS --> RWP
  CS --> STO
  CS --> CSH
  CS --> CCTX
  CS -.->|"타입"| PD
  CMP --> ENG
  CMP --> FLO
  CMP --> SCH
  CMP --> STO
  CMP --> RWP
  CMP --> CCTX
  CMP --> CSH
  CMY --> ENG
  CMY --> FLO
  CMY --> STO
  CMY --> RWP
  CMY --> CCTX
  CMY --> CSH
  CMY -.->|"타입"| VD
  CSH --> ENG
  CSH --> FLO
  CSH --> SCH
  CSH --> RWP
  CSH --> STO
  CSH --> CCTX
  CCTX -.->|"타입"| VD
  STO --> ENG
  STO --> RWP
  FLO -.->|"타입"| RWP
  FLO -.->|"타입"| STO

  CS -->|"fetch /api/predictions"| RP
  CSH -->|"fetch"| RL
  CSH -->|"fetch"| RP
  CSH -->|"fetch"| RI
  CSH -.->|"window.open"| RO
  CMY -.->|"window.open"| RO

  PD --> ENG
  PD --> MD
  PD --> VD
  MD --> CAL
  MD --> ADM
  MD --> RWP
  VD --> CRY
  VD --> RWP
  VD --> CAL
  VD --> ADM
  VD --> VIS

  RM --> MD
  RL --> RWP
  RL --> CFGP
  RL --> CUR
  RL --> CAL
  RL --> ADM
  RL --> VD
  RL --> LCK
  RL --> VIS
  RP --> RWP
  RP --> CUR
  RP --> CAL
  RP --> SCH
  RP --> ADM
  RP --> VD
  RP --> VIS
  RI --> RWP
  RI --> CRY
  RI --> CAL
  RI --> SCH
  RI --> CUR
  RI --> DSC
  RI --> ADM
  RI --> VIS
  RO --> CFGM
  RO --> ADM

  VIS --> ADM
  CUR --> ADM
  LCK --> CRY
  LCK --> DSC
  LCK --> ADM
  DSC --> C24
  C24 --> CRY
  C24 --> ADM

  ADM ==> SUPA
  C24 ==> CAFE
```

### A3-2. 자동 작업 · 운영 경로 (내부 API · Cafe24 OAuth)

```mermaid
flowchart LR
  subgraph API["app/api"]
    DP["internal/daily-pricing/route.ts"]
    RS["internal/reset-list-price/route.ts"]
    SP["internal/sync-products/route.ts"]
    OS["auth/cafe24/start/route.ts"]
    OC["auth/cafe24/callback/route.ts"]
  end

  subgraph LIB["lib"]
    DJ["pricing/daily-job.ts"]
    PR["pricing/pricing.mjs"]
    DT["pricing/dates.mjs"]
    FX["pricing/fx.mjs"]
    NV["pricing/naver.mjs"]
    ENV["pricing/env.mjs"]
    TM["pricing/time.mjs"]
    PS["cafe24/price-sync.ts"]
    VP["pricing/variant-pricing.ts"]
    LCK["locks/lock-codes.ts"]
    RES["predictions/resolve.ts"]
    RWP["bread-market/reward-policy.ts"]
    CUR["pricing/current-price.ts"]
    DSC["rewards/discount-code.ts"]
    C24["cafe24/client.ts"]
    CRY["crypto.ts"]
    ADM["supabase/admin.ts"]
  end

  CFGP["config/pricing-products.json"]
  CFGM["config/cafe24-product-map.json"]
  CFGO["config/cafe24-option-prices.ts"]

  SUPA[("Supabase")]
  CAFE[["Cafe24 Admin API"]]
  NAVER[["네이버 데이터랩"]]
  ECOS[["한국은행 ECOS"]]

  DP --> CFGP
  DP --> C24
  DP --> PS
  DP --> LCK
  DP --> RES
  DP --> DT
  DP --> DJ
  DP --> FX
  DP --> NV
  DP --> PR
  DP --> ADM

  RS --> C24
  RS --> PS
  RS --> CFGP
  RS --> DT
  RS --> ADM

  SP --> CFGM
  SP --> C24
  SP --> ADM

  OS --> C24
  OC --> C24

  DJ --> DT
  PR --> DT
  FX --> TM
  NV --> ENV
  NV --> TM
  PS --> CFGM
  PS --> CFGO
  PS --> C24
  PS --> VP
  LCK --> CRY
  LCK --> DSC
  LCK --> ADM
  RES --> RWP
  RES --> CRY
  RES --> CUR
  RES --> DSC
  RES --> ADM
  CUR --> ADM
  DSC --> C24
  C24 --> CRY
  C24 --> ADM

  ADM ==> SUPA
  C24 ==> CAFE
  NV -->|"fetch"| NAVER
  FX -->|"fetch"| ECOS
```

**읽는 법**

- Supabase에 닿는 길은 `lib/supabase/admin.ts` 하나, Cafe24에 닿는 길은 `lib/cafe24/client.ts` 하나다. 쓰기 차단(`CAFE24_WRITES_ENABLED`)도 이 파일에서 한 번에 건다.
- 할인코드는 잠금 차액(`lock-codes.ts`), 예측 보상(`resolve.ts`), 바로 받기(`predictions/instant/route.ts`) 세 곳이 모두 `rewards/discount-code.ts`를 거쳐 만든다.
- `components/*`는 브라우저에서 돈다. `lib/bread-market/engine.ts`·`store.ts`·`flow.ts` 같은 화면 계산 모듈만 가져오고, DB 모듈은 타입만 가져온다. 서버 데이터는 `fetch`로 공개 API를 부른다.
- `lib/pricing/*.mjs`는 백테스트(`backtest/`)와 테스트(`tests/`)도 함께 쓰는 순수 계산 모듈이다. 이 그림에는 앱에서 가져오는 관계만 그렸다.
