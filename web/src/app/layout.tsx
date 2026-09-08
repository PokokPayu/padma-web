import { IBM_Plex_Mono, Marcellus, Plus_Jakarta_Sans } from "next/font/google";
import { HTML_LANG, metadata } from "@/lib/metadata";
import "./globals.css";

// Font brand PADMA: Marcellus (display/serif), Plus Jakarta Sans (body), IBM Plex Mono (mono).
const marcellus = Marcellus({
  variable: "--font-marcellus",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
});

export { metadata };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang={HTML_LANG}
      className={`${jakarta.variable} ${marcellus.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
