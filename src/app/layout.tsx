import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VC Tycoon · 创投大富翁",
  description: "用大富翁玩法重温真实历史投资案例：Insta360、字节跳动、Theranos、WeWork… 投或不投，揭晓真相。",
  applicationName: "VC Tycoon",
  keywords: ["VC", "创投", "大富翁", "游戏", "投资", "字节跳动", "Theranos", "WeWork", "FTX"],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "VC Tycoon",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "VC Tycoon · 创投大富翁",
    description: "投或不投？真实历史案例的大富翁游戏。",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0a0e0d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
