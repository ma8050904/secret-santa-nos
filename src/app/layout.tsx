import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "The Magic of Secret Santa | Premium Christmas Experience",
  description: "A little mystery. A lot of Christmas magic. Discover your Secret Santa recipient in a luxury, private holiday experience.",
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "The Magic of Secret Santa 🎄",
    description: "A little mystery. A lot of Christmas magic.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#05150d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#05150d] text-white selection:bg-amber-400 selection:text-slate-950">
        {children}
      </body>
    </html>
  );
}
