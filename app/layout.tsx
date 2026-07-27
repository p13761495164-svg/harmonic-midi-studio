import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://p13761495164-svg.github.io/harmonic-midi-studio/"),
  title: "Harmonic — MIDI Track Player",
  description: "Import a MIDI file, split it into tracks, play it, and mute or solo each track directly in your browser.",
  openGraph: {
    title: "Harmonic — MIDI Track Player",
    description: "Import, play, mute and solo MIDI tracks directly in your browser.",
    images: [{ url: "og.png", width: 1729, height: 910 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Harmonic — MIDI Track Player",
    description: "Import, play, mute and solo MIDI tracks directly in your browser.",
    images: ["og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
