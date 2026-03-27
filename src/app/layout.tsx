import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tic-Tac-Toe Tactical 3D Shooter",
  description: "Dominate the 3x3 grid. Control sectors. Win by strategy. A tactical 3D multiplayer shooter game.",
  keywords: ["Tic-Tac-Toe", "3D Shooter", "Multiplayer", "Strategy Game", "Three.js", "Next.js", "TypeScript"],
  authors: [{ name: "Z.ai Team" }],
  openGraph: {
    title: "Tic-Tac-Toe Tactical 3D Shooter",
    description: "A tactical 3D multiplayer shooter with sector control and team strategy",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tic-Tac-Toe Tactical 3D Shooter",
    description: "A tactical 3D multiplayer shooter with sector control and team strategy",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
