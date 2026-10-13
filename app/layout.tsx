import type { Metadata } from "next";
import "./globals.css";
import SiteAnalytics from "@/components/SiteAnalytics";
import {websiteSchema, serializeJsonLd} from "@/lib/seo/jsonld";
import {DM_Sans, DM_Mono, Space_Grotesk} from "next/font/google";

const sans = DM_Sans({subsets: ["latin"], display: "swap", variable: "--font-sans"});
const mono = DM_Mono({subsets: ["latin"], weight: ["400", "500"], display: "swap", variable: "--font-mono", preload: false});
const display = Space_Grotesk({subsets: ["latin"], display: "swap", variable: "--font-display"});

export const metadata: Metadata = {
  metadataBase: new URL("https://symtri.com"),
  title: "SYMTRI — Technology research and connected ideas",
  description: "Explore a living knowledge map of AI, software, and research. Follow original sources, discover connected ideas, and read evidence-grounded weekly reports.",
  alternates: { canonical: "/", types: {"application/rss+xml": "/signal/feed.xml"} },
  openGraph: {
    title: "SYMTRI — Technology research and connected ideas",
    description: "Explore AI, software, and research through original sources and a living map of connected ideas.",
    siteName: "SYMTRI",
    url: "/",
    type: "website",
    images: [{url: "/opengraph-image.png", width:1200, height:630}],
  },
  twitter: {
    card: "summary_large_image",
    title: "SYMTRI — Technology research and connected ideas",
    description: "Explore AI, software, and research through original sources and a living map of connected ideas.",
    images: [{
      url: "https://symtri.com/opengraph-image.png",
      alt: "SYMTRI — The Internet Is Thinking, a constellation of connected ideas",
    }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable}`}><body>{children}<SiteAnalytics /><script type="application/ld+json" dangerouslySetInnerHTML={{__html: serializeJsonLd(websiteSchema())}} /></body></html>;
}
