"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Identitas pemakai + jalan keluar, dilipat ke DALAM kartu nav.
 *
 * Sebelumnya ketiga panel punya satu baris teks mengapung di atas kartu nav
 * ("Masuk sebagai X · Admin    Keluar"). Baris itu tidak pernah ada di
 * prototipe yang ditunjukkan ke client — panel admin di sana memakai sidebar
 * berjudul "Panel Admin" tanpa strip apa pun — dan di mobile ia justru menjadi
 * elemen paling tidak app-like di layar, tepat di atas bottom bar gelap.
 *
 * Yang tidak boleh hilang bersamanya ada dua: tombol Keluar (satu-satunya jalan
 * keluar di admin & owner) dan penanda peran. Penanda itu penting karena owner
 * adalah superset admin dan boleh membuka /admin — tanpa suffix peran, ia tidak
 * punya cara tahu sedang memakai akun apa.
 *
 * Nama tampil pendek, tetapi frasa utuh "Masuk sebagai <nama> · <peran>" tetap
 * hidup sebagai nama aksesibel tombolnya, sehingga pembaca layar justru
 * mendapat konteks yang lebih lengkap daripada sebelumnya.
 *
 * DIPAKAI DI DALAM <nav>, jadi sengaja memakai <button>, bukan <a>: tiga berkas
 * test menghitung jumlah tag <a> di nav secara persis (admin 18, owner 8), dan
 * satu <a> tambahan akan memerahkan mereka. Tidak pula ber-`aria-current` —
 * jumlahnya juga dihitung, dan tombol ini memang bukan tujuan navigasi.
 */
export function MenuAkun({ nama, peran }: { nama: string; peran: string }) {
  const [buka, setBuka] = useState(false);
  const wadah = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!buka) return;
    // `pointerdown`, bukan `click`: menutup sebelum tombol lain sempat menerima
    // klik-nya membuat menu terasa seperti menu, bukan seperti panel yang
    // menelan satu ketukan pertama.
    const diLuar = (e: PointerEvent) => {
      if (!wadah.current?.contains(e.target as Node)) setBuka(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBuka(false);
    };
    document.addEventListener("pointerdown", diLuar);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", diLuar);
      document.removeEventListener("keydown", escape);
    };
  }, [buka]);

  return (
    <div ref={wadah} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={buka}
        aria-label={`Masuk sebagai ${nama} · ${peran}`}
        onClick={() => setBuka((v) => !v)}
        className="flex max-w-[11rem] items-center gap-1.5 rounded-xl px-2.5 py-2.5 text-[13px] font-bold text-ink-soft transition hover:text-night"
      >
        <span
          aria-hidden="true"
          className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-night text-[10px] font-extrabold text-gold-pale"
        >
          {nama.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <span className="truncate">{nama}</span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 transition ${buka ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
        >
          <path d="m6 9.5 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {buka && (
        <div
          role="menu"
          aria-label="Menu akun"
          className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-xl border border-black/10 bg-white p-1.5 shadow-[0_12px_28px_-12px_rgba(0,0,0,0.28)]"
        >
          <p className="px-2.5 pb-2 pt-1.5 text-[11.5px] leading-snug text-ink-soft">
            Masuk sebagai <b className="text-ink">{nama}</b>
            <br />
            {peran}
          </p>
          {/* Logout tetap <form method="post">: navigasi dokumen penuh
              menghapus Client Cache. Jangan diganti navigasi sisi klien —
              sisa data pemakai sebelumnya bisa ikut tertinggal, dan di panel
              owner sisa itu berupa nominal uang. */}
          <form action="/auth/keluar" method="post">
            <button
              role="menuitem"
              className="w-full rounded-lg border-t border-black/10 px-2.5 pb-1.5 pt-2.5 text-left text-[13px] font-bold text-leaf transition hover:bg-paper"
            >
              Keluar
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
