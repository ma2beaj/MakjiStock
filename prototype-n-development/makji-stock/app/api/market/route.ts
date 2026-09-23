import { loadMarketData } from "@/lib/bread-market/market-data";

export const dynamic = "force-dynamic";

/* 화면은 이제 서버 렌더에서 loadMarketData 를 직접 부른다.
   이 경로는 같은 값을 밖에서 들여다보기 위해 남겨 둔다. */
export async function GET() {
  try {
    return Response.json(await loadMarketData(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
