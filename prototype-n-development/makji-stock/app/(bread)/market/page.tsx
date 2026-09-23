import type { Metadata } from "next";
import { loadShellData } from "@/lib/bread-market/page-data";
import { BreadMarketShell } from "@/components/bread-market/Shell";
import { MarketPanel } from "@/components/bread-market/MarketPanel";

/* 시세·잠금·예측을 서버에서 받아 첫 HTML 에 실어 보낸다. 클라이언트에서 받으면
   그때까지 빈 화면이나 시드 값이 떠 있다.
   잠금·예측은 사람마다 다르다 — 이 페이지는 반드시 dynamic 이어야 한다. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "마켓 | MAKJI STOCK",
  description: "막지 빵 시세 · 가격 잠금 · 내일 가격 예측",
};

export default async function MarketPage() {
  const data = await loadShellData();
  return (
    <BreadMarketShell {...data}>
      <MarketPanel />
    </BreadMarketShell>
  );
}
