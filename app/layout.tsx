import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://symtri.com"),
  title: "SYMTRI — The Internet Is Thinking",
  description: "Enter a living map of technology and the ideas connecting it.",
  openGraph: {
    title: "SYMTRI — The Internet Is Thinking",
    description: "Enter a living map of technology and the ideas connecting it.",
    siteName: "SYMTRI",
    url: "/",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SYMTRI — The Internet Is Thinking",
    description: "Enter a living map of technology and the ideas connecting it.",
    images: [{
      url: "https://symtri.com/opengraph-image.png",
      alt: "SYMTRI — The Internet Is Thinking, a constellation of connected ideas",
    }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
