export type NaverProduct = { id: string; ticker: string; keywords: string[] };
export type TrendResult = {
  /** 상품 id → { "YYYY-MM-DD": ratio } */
  seriesByProduct: Record<string, Record<string, number>>;
  rawByProduct: Record<string, unknown>;
  timings: unknown[];
};
export function fetchTrendsSeparately(options: {
  products: NaverProduct[];
  startDate: string;
  endDate: string;
  provider?: string;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}): Promise<TrendResult>;
