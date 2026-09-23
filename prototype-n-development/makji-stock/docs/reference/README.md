# 참고 자료

외부에서 받았거나 한 번 만들어 두고 열어보는 파일입니다. 앱이 읽지 않습니다.

| 파일 | 무엇 |
|---|---|
| `discount-formula-simulator-current.html` | **현행** 할인율 산식 시뮬레이터. `lib/pricing/pricing.mjs` 의 `calculateDay` 를 그대로 옮겨 실데이터 91일에 적용한다. `node scripts/build-discount-simulator.mjs` 로 다시 만든다. |
| `discount-formula-simulator.html` | 기업 발표 덱(슬라이드 8) 시절 산식. **운영과 다르다** — 환율 상승을 0%p 로 무시해 할증이 없고, 그래서 총 할인 하한도 없다. 남겨 두는 건 그때 무엇을 보여줬는지 알기 위해서다. |
| `프로토타입_1차_3팀.html` | 1차 프로토타입 화면. [prototype-n-development/first-prototype/](../../../first-prototype/프로토타입_1차_3팀.html) 로 옮겼다. |

## 두 시뮬레이터가 갈리는 곳

환율이 **오른 날**입니다. 구 산식은 상승을 버려 검색쿠폰만 남기고, 현 산식은
`fxRisePassThroughPct` 만큼 할인에서 깎습니다. 깎다 보면 할인율이 음수가 되어
판매가가 정가를 넘는데, `discountFloorPct: 0` 이 그걸 막습니다.

91일 936세션 기준으로 하한이 실제로 막은 적이 **3회** 있습니다. 시뮬레이터의
"하한 풀기" 프리셋을 누르면 그 3회가 정가 초과로 나타납니다.
