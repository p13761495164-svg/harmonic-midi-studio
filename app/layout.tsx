import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harmonic Studio — MIDI Editor",
  description: "A focused browser MIDI arranger with region editing, piano roll, tempo and key automation.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
