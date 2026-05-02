import type { Metadata, Viewport } from "next";
import { Newsreader, Inter } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Stori · 讲好你的故事",
  description: "Stori 是一位耐心的简历教练，通过自然对话引导你把模糊的经历变成清晰、量化、有说服力的简历素材。",
  applicationName: "Stori",
  keywords: ["简历", "求职", "AI 简历教练", "STAR", "故事卡", "JD 分析"],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Stori",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "Stori · 讲好你的故事",
    description: "对话式简历教练。一次只问一件事，五分钟整理一段经历。",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#F3EBE2",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${newsreader.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
