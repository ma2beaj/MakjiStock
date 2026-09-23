/**
 * Cafe24 옵션별 정가(옵션 추가금이 아닌, 구매자가 보는 옵션 총액).
 *
 * 일일 할인가는 이 정가에 상품과 같은 할인율을 적용해 매번 새로 계산한다.
 * 현재 Cafe24 데모 상품에는 옵션이 없어서 대표가만 바뀐다. 데모몰이나 실제 몰에
 * 아래와 같은 옵션이 생기면 option value를 variant_code와 연결해 반영한다.
 */
export type Cafe24OptionPrice = {
  optionValue: string;
  listPriceWon: number;
};

export const CAFE24_OPTION_PRICES: Record<string, readonly Cafe24OptionPrice[]> = {
  gluten_free_frozen_dough_set: [
    { optionValue: "피칸 휘낭시에 냉동생지", listPriceWon: 21_000 },
    { optionValue: "초코 휘낭시에 냉동생지", listPriceWon: 21_000 },
    { optionValue: "스콘 냉동생지 (+4000원)", listPriceWon: 25_000 },
  ],
  morning_roll: [
    { optionValue: "1개 ", listPriceWon: 4_500 },
    { optionValue: "3개 (+7700원)", listPriceWon: 12_200 },
    { optionValue: "5개 (+14700원)", listPriceWon: 19_200 },
  ],
  tetris_bread: [{ optionValue: "단일 옵션", listPriceWon: 11_000 }],
  english_muffin: [
    { optionValue: "비건", listPriceWon: 1_500 },
    { optionValue: "햄치즈 (+2300원)", listPriceWon: 3_800 },
    { optionValue: "햄치즈 4개 SET (10%↓)", listPriceWon: 13_700 },
    { optionValue: "비건 5개 SET (10%↓)", listPriceWon: 5_400 },
    { optionValue: "햄치즈 8개 SET (15%↓)", listPriceWon: 25_900 },
    { optionValue: "비건 10개 SET (10%↓)", listPriceWon: 12_800 },
  ],
  gluten_free_financier: [
    { optionValue: "피칸", listPriceWon: 3_800 },
    { optionValue: "코코넛", listPriceWon: 3_800 },
    { optionValue: "초코", listPriceWon: 3_800 },
  ],
  gluten_free_scone: [
    { optionValue: "막지 글루텐프리 스콘1개", listPriceWon: 3_800 },
    { optionValue: "막지 글루텐프리 스콘3개 set (+6400원)", listPriceWon: 10_200 },
    { optionValue: "막지 글루텐프리 스콘5개 set (+12400원)", listPriceWon: 16_200 },
  ],
};
