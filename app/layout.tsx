import type { Metadata } from "next";
import "./globals.css";
import SiteAnalytics from "@/components/SiteAnalytics";
import {websiteSchema, serializeJsonLd} from "@/lib/seo/jsonld";

export const metadata: Metadata = {
  metadataBase: new URL("https://symtri.com"),
  title: "SYMTRI — The Internet Is Thinking",
  description: "Enter a living map of technology and the ideas connecting it.",
  alternates: { canonical: "/", types: {"application/rss+xml": "/signal/feed.xml"} },
  openGraph: {
    title: "SYMTRI — The Internet Is Thinking",
    description: "Enter a living map of technology and the ideas connecting it.",
    siteName: "SYMTRI",
    url: "/",
    type: "website",
    images: [{url: "/opengraph-image.png", width:1200, height:630}],
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
  return <html lang="en"><body>{children}<SiteAnalytics /><script type="application/ld+json" dangerouslySetInnerHTML={{__html: serializeJsonLd(websiteSchema())}} /></body></html>;
}
