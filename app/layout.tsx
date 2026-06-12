import "./globals.css";
// The Flynet component theme. Import it once, at the root.
import "@flynetdev/react/styles.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { DevDrawer } from "../components/dev-drawer";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Flynet Starter",
  description: "A minimal app built on the Flynet SDK.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
        {/* Developer onboarding drawer — dev builds only, never shipped to prod. */}
        {process.env.NODE_ENV !== "production" ? <DevDrawer /> : null}
      </body>
    </html>
  );
}
