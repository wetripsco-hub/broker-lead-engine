import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted (latin, variable weight) so the build never has to download fonts:
// Vercel's builder started failing on next/font/google in Nov 2026.
const inter = localFont({
  src: "./fonts/Inter-Variable-latin.woff2",
  variable: "--font-geist-sans",
  weight: "400 700",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Broker Lead Engine",
  description: "Lead generation and outreach tool for freight brokers",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
