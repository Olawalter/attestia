import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, Newsreader } from "next/font/google";

import "./globals.css";
import { Providers } from "./providers";
import { Shell } from "@/components/Shell";

/**
 * §36 — three typefaces, each with a job.
 *
 * Archivo runs the interface. Newsreader sets claim text, because a
 * claim is a statement being read rather than a UI string. IBM Plex Mono
 * carries every identifier, label and figure, so protocol data always
 * looks like protocol data.
 */
const archivo = Archivo({
  subsets: ["latin"], variable: "--font-archivo", display: "swap",
});
const newsreader = Newsreader({
  subsets: ["latin"], variable: "--font-newsreader", display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"], weight: ["400", "500"],
  variable: "--font-plex-mono", display: "swap",
});

export const metadata: Metadata = {
  title: "Attestia — evidence and adjudication",
  description:
    "Claims connected to evidence. Judgment secured by consensus. "
    + "A GenLayer protocol turning disputed claims into versioned, "
    + "consensus-backed attestations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"
          className={`${archivo.variable} ${newsreader.variable} ${plexMono.variable}`}>
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
