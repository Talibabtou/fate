import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fate — one draw at a time",
  description: "A SOL draw with a clear threshold, exact payout, and visible risk.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
