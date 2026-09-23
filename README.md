
# MakjiStock
MVP 앱인 **막지 스톡(MAKJI-STOCK)** 과 기획 자료가 함께 들어 있습니다.

## 프로젝트 구성

```text
MakjiStock
├── README.md                          # 이 문서
├── docs/                              # 설계·구현 계획 문서
│   ├── 기업_요구사항.md
│   ├── PRD-브레드마켓.md
│   ├── DESIGN.md
│   ├── NextJS-Supabase-MARKET-ME-로직구조.md
│   ├── 가격-잠금-1회-사유.md · 매수가-기준-예측-제외-사유.md
│   ├── 기획-정리-2026-09-19.md · 기획-정리-2026-09-21.md
│   └── diagrams/                      # 아키텍처·ERD·시퀀스·플로우차트
├── research/                          # 리서치·분석
│   ├── 할인율-결정-리포트.md
│   ├── 네이버-검색지수-도착시각.md
│   └── 가격정책-마진연동-계산안.md
├── knowledge-base/                    # 내부 구조 안내
│   └── 산식과-쿠폰-공부노트.md
├── assets/                            # 미디어 재료
│   ├── brand/makji-logo.png
│   ├── diagrams/시스템 아키텍처.pdf
│   └── images/bread-market-products-v1.png
└── prototype-n-development/           # 프로토타입·앱 구현
    ├── first-prototype/               # 1차 프로토타입 (HTML)
    └── makji-stock/                   # MVP 앱 (Next.js + Supabase)
        ├── app/
        │   ├── (bread)/market/        # 마켓 화면
        │   ├── (bread)/me/            # MY 화면
        │   └── api/                   # 서버 API
        ├── components/bread-market/   # 화면 컴포넌트
        ├── lib/
        │   ├── pricing/               # 가격 산식
        │   ├── cafe24/                # Cafe24 연동
        │   ├── locks/                 # 가격 잠금
        │   ├── predictions/           # 가격 예측
        │   └── bread-market/          # 화면 데이터 조립
        ├── config/                    # 상품·산식 설정
        ├── supabase/                  # DB 스키마
        ├── backtest/                  # 90일 백테스트
        ├── tests/                     # 단위 테스트
        ├── docs/                      # 앱 운영 문서
        ├── reports/                   # 테스트·품질·데이터 분석 보고서
        ├── vercel.json                # 자동 실행 일정
        ├── README.md                  # 앱 상세 안내
        └── UPSTREAM.md                # 원본 GitHub 저장소 링크
```

## 경로별 설명

### 저장소 전체

| 경로 | 설명 |
|---|---|
| `docs/기업_요구사항.md` | 고객사가 요청한 요구사항을 정리한 문서입니다. 기능 범위를 판단하는 출발점입니다. |
| `docs/PRD-브레드마켓.md` | 제품 기준 문서입니다. 다른 문서와 내용이 다르면 이 문서를 따릅니다. |
| `docs/DESIGN.md` | 브랜드, 화면 구성(IA), 컴포넌트, 접근성 기준을 정한 디자인 문서입니다. |
| `docs/NextJS-Supabase-MARKET-ME-로직구조.md` | 마켓·MY 화면 로직을 Next.js와 Supabase로 어떻게 구현할지 정리한 명세입니다. |
| `docs/가격-잠금-1회-사유.md`, `docs/매수가-기준-예측-제외-사유.md` | 기능 범위를 줄인 결정과 그 이유입니다. |
| `docs/diagrams/` | 시스템 아키텍처, DB ERD, 기능별 시퀀스 다이어그램과 플로우차트입니다. 현재 구현(01~04)과 앞으로 만들 기능의 설계안(05)으로 나뉩니다. **구조를 처음 파악할 때 먼저 보면 좋습니다.** [목록](docs/diagrams/README.md) |
| `docs/기획-정리-*.md` | 날짜별 기획 회의에서 확정·변경·미결정된 내용을 정리한 기록입니다. |
| `research/할인율-결정-리포트.md` | 할인율 산식 v1.0의 계수를 어떻게 정했는지 실데이터로 비교한 분석 보고서입니다. |
| `research/네이버-검색지수-도착시각.md` | 네이버 검색지수가 하루 중 언제 갱신되는지 측정한 기록입니다. 자동 작업 시각을 정하는 근거입니다. |
| `research/가격정책-마진연동-계산안.md` | 초기에 검토했다가 제외한 가격 인상 모델입니다. 마진 하한 부분은 지금도 참고합니다. |
| `knowledge-base/산식과-쿠폰-공부노트.md` | 산식과 쿠폰의 숫자마다 근거 문서, 코드, 테스트 위치를 이어 둔 안내서입니다. 코드를 처음 보는 사람이 먼저 읽기 좋습니다. |
| `assets/` | 로고, 시스템 아키텍처 도식, 상품 이미지 등 발표와 문서에 쓰는 미디어 재료입니다. |
| `prototype-n-development/first-prototype/` | 1차 프로토타입 화면입니다. 현재 앱 화면의 출발점이며, 정책의 근거로 쓰지는 않습니다. |
| `prototype-n-development/makji-stock/` | 실제로 동작하는 MVP 앱입니다. 설치와 실행 방법은 이 폴더의 [README](prototype-n-development/makji-stock/README.md)에 있습니다. |

### MVP 앱 (`prototype-n-development/makji-stock/`)

빵 6종의 할인가를 **네이버 검색 관심도**와 **원/달러 환율**로 매일 두 번 다시 계산해 주식 시세처럼 보여주는 모바일 웹앱입니다. 결제와 회원은 Cafe24가 맡고, 이 앱은 가격 계산과 이벤트(잠금·예측)만 담당합니다.

| 경로 | 설명 |
|---|---|
| `app/(bread)/market/` | 손님이 처음 보는 마켓 화면입니다. 6종의 현재가, 등락률, 막지지수, 급등 상품을 보여줍니다. |
| `app/(bread)/me/` | MY 화면입니다. 내가 잠근 가격, 예측 결과, 받은 할인코드를 확인합니다. |
| `app/api/market/` | 화면에 보이는 현재 시세를 외부에서 JSON으로 확인할 수 있는 조회용 API입니다. |
| `app/api/locks/` | 가격 잠금 API입니다. 오전장에 하루 한 번 가격을 잠그고, 오후에 가격이 오르면 차액만큼 할인코드를 발급합니다. |
| `app/api/predictions/` | 가격 예측 API입니다. 다음 가격이 오를지 내릴지 맞히면 정가의 5% 할인코드를 발급합니다. |
| `app/api/internal/` | 매일 자동으로 도는 내부 작업입니다. 가격 계산, Cafe24 상품가 반영, 새벽 정가 복귀, 상품번호 동기화를 합니다. `CRON_SECRET` 값이 없으면 호출할 수 없습니다. |
| `app/api/auth/cafe24/` | Cafe24 관리자 연동(OAuth) 시작과 콜백을 처리합니다. 처음 한 번 몰을 연결할 때 씁니다. |
| `app/api/out/cafe24/` | 손님을 Cafe24 상품 상세 페이지로 보내는 경로입니다. `SHOP_TARGET` 값에 따라 데모몰이나 실제 자사몰로 연결합니다. |
| `components/bread-market/` | 마켓·MY 화면을 이루는 UI 부품입니다. |
| `lib/pricing/` | 가격 산식의 핵심입니다. 검색지수·환율 수집과 할인율 계산이 여기에 있고, 앱·자동 작업·백테스트가 같은 코드를 씁니다. |
| `lib/cafe24/` | Cafe24 Admin API 클라이언트입니다. 토큰 암호화 저장과 자동 갱신, 상품가·옵션가 반영, 할인코드 발급을 맡습니다. |
| `lib/locks/`, `lib/predictions/`, `lib/rewards/` | 잠금, 예측 판정, 할인코드 규칙입니다. |
| `lib/bread-market/` | DB와 산식 결과를 모아 화면에 필요한 형태로 조립합니다. |
| `config/pricing-products.json` | 상품 6종, 상품별 검색어, 산식 파라미터입니다. **가격 정책을 바꿀 때 먼저 보는 파일**입니다. |
| `config/cafe24-option-prices.ts` | Cafe24 옵션별 정가입니다. 옵션가에도 같은 할인율을 적용할 때 씁니다. |
| `supabase/` | DB 테이블(`schema.sql`), 변경 이력(`migrations/`), 접근 권한(`rls.sql`)입니다. |
| `backtest/` | 운영과 같은 산식으로 과거 90일을 다시 계산해 보는 도구입니다. 산식이 실제로 어떤 가격을 냈을지 검증할 때 씁니다. |
| `tests/` | 산식, 장 시간, 자동 작업 일정, 예측 판정, 보상, 암호화 단위 테스트입니다. 코드를 올릴 때마다 CI가 자동으로 실행합니다. |
| `docs/` | 가격 자동화 운영 가이드, 산식 버전 관리 규칙, 상품별 검색어 등 앱을 운영할 때 보는 문서입니다. `docs/reference/`에는 할인율 산식 시뮬레이터가 있습니다. |
| `reports/` | 시스템 테스트(`system-test/`), 코드 품질(`code-quality/`), 고객 데이터 분석(`customer-data-analysis/`) 보고서를 모아 두는 곳입니다. |
| `vercel.json` | 가격 계산과 정가 복귀가 매일 몇 시에 실행되는지 정한 일정표입니다. |
| `UPSTREAM.md` | 앱을 처음 개발한 원본 GitHub 저장소(maybeaj/MakjiStock) 링크입니다. |

`references/`(참고 자료), `prototype-n-development/design-references/`(디자인 레퍼런스), `misc/`(기타 자료), `reports/` 하위 폴더 등 내용이 없는 폴더는 이후 작업을 위해 만들어 둔 빈 폴더입니다.
