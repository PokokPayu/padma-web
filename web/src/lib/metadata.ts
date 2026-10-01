import type { Metadata } from "next";
import { APP_NAME } from "@/lib/constants";

/** Bahasa dokumen: seluruh teks UI PADMA berbahasa Indonesia. */
export const HTML_LANG = "id";

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} · Premium Women's Wellness`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    "Kelas & pijat kehamilan hingga setelah melahirkan. Online se-Indonesia, kunjungan ke rumah di Malang Raya & Batu.",
  applicationName: APP_NAME,
};
