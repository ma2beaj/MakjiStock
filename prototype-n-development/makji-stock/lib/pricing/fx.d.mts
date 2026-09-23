export type RatesByDate = Record<string, number>;
export function fetchUsdKrwOpenCloseRates(options: {
  startDate: string;
  endDate: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}): Promise<{
  closesByDate: RatesByDate;
  opensByDate: RatesByDate;
  rawPayloads: { close: unknown[]; open: unknown[] };
  timings: unknown[];
}>;
