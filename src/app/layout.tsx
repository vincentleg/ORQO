import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getRequestLocale } from "@/lib/server/i18n";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ORQO — You meet the person. ORQO finds the business.",
  description: "Autonomous business development network. Business Agents turn professional relationships into qualified, bilateral business opportunities.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
