import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bread Market | MAKJI",
  description: "시장 데이터로 매일 달라지는 MAKJI의 오늘의 빵 할인",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

/* viewport-fit=cover 가 있어야 env(safe-area-inset-*) 가 실제 값을 갖는다.
   없으면 늘 0 으로 계산돼서 CSS 에 써둔 안전영역 패딩이 통째로 죽고,
   하단 탭 바가 아이폰 사파리의 주소 표시줄 뒤로 들어간다. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
