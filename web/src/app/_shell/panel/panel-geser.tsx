"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { pasangPenutup } from "./tutup-drawer";

/**
 * Panel geser dari kanan untuk mengubah SATU baris.
 *
 * Komponen ini klien, tetapi ISINYA tidak: `children` dirender di server dan
 * dioper masuk sudah jadi. Itu yang membuat formulir di dalamnya bisa diuji
 * dengan `renderToStaticMarkup` — suite proyek ini berjalan tanpa jsdom, jadi
 * apa pun yang hanya lahir setelah hidrasi tidak bisa diuji sama sekali.
 *
 * Yang benar-benar butuh klien hanya dua: tombol Escape, dan klik pada
 * overlay. Keduanya jalan keluar; keduanya tidak punya padanan server.
 *
 * Terbuka/tertutupnya ditentukan URL (`?ubah=<id>`), bukan state. Karena itu
 * tombol kembali browser menutup panel seperti yang orang harapkan, dan sebuah
 * baris yang sedang diubah bisa dikirim sebagai tautan.
 */
export function PanelGeser({
  judul,
  hrefTutup,
  children,
}: {
  judul: string;
  /** Alamat halaman TANPA `?ubah` — ke sinilah Escape dan overlay menuju. */
  hrefTutup: string;
  children: ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    // `pasangPenutup` lahir di rencana panel pertama untuk drawer navigasi,
    // lengkap dengan tipe dokumen minimal supaya bisa diuji dengan dokumen
    // palsu. Dipakai ulang di sini, bukan ditulis kedua kalinya.
    return pasangPenutup(document, () => router.push(hrefTutup));
  }, [router, hrefTutup]);

  return (
    <>
      <Link
        href={hrefTutup}
        aria-label="Tutup panel"
        className="fixed inset-0 z-40 bg-black/30"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={judul}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-panel-border bg-panel-surface shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-panel-border px-4 py-3">
          <h2 className="text-[13px] font-bold text-panel-ink">{judul}</h2>
          <Link href={hrefTutup} className="text-[13px] font-bold text-panel-muted">
            Tutup
          </Link>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </>
  );
}
