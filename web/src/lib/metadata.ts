import type { Metadata } from "next";
import { APP_NAME } from "@/lib/constants";

/** Bahasa dokumen: seluruh teks UI PADMA berbahasa Indonesia. */
export const HTML_LANG = "id";

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} · Homecare Promil & Perawatan Perempuan`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    "PADMA adalah layanan homecare pendampingan program hamil (promil) dan perawatan kesehatan perempuan, dijalankan tenaga profesional langsung di rumah Anda.",
  applicationName: APP_NAME,
};
