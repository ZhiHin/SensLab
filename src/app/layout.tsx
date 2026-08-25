import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { intlLocale } from "@/core/preferences";
import { getPreferences } from "@/services/preferences-service";
import { getActor } from "@/services/session-context";
import "./globals.css";

/**
 * Root layout.
 *
 * Fonts are self-hosted through `next/font` rather than fetched from a third party at
 * runtime: it removes a request, removes a tracking vector, and — the reason that matters
 * here — guarantees no font swap can occur mid-session on the lab route
 * (`SENS-UX-008`, `SENS-NFR-011`).
 */

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
  weight: ["400", "500", "600"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "SensLab — find your true sens",
    template: "%s · SensLab",
  },
  description:
    "SensLab measures how you actually aim across several mouse sensitivities and finds the " +
    "range where you perform best. Not a converter — a calibration.",
  applicationName: "SensLab",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#08090b",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Resolved once, here, so `lang` and the motion override are correct in the first paint
  // rather than corrected after hydration — a language announced wrongly to a screen reader
  // for one frame is a language announced wrongly (doc 28 §28.10).
  const preferences = await getPreferences(await getActor());

  return (
    <html
      lang={intlLocale(preferences.locale)}
      data-motion={preferences.motion}
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-surface focus:px-4 focus:py-2 focus:text-text-1"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
