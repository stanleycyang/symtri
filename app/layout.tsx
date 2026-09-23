import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SYMTRI — The Internet Is Thinking",
  description: "Enter a living map of technology and the ideas connecting it.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
