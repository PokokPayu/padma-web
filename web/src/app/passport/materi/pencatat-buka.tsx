"use client";

import { useEffect, useRef } from "react";
import { catatBukaMateri } from "./catat-buka";

/**
 * Menandai satu materi sebagai DIBUKA, sekali per pemuatan halaman.
 *
 * KENAPA KOMPONEN KLIEN, bukan sebaris panggilan di komponen server halaman
 * readernya: `<Link>` Next melakukan PREFETCH payload RSC ketika tautan masuk
 * viewport atau tersentuh kursor. Efek samping di komponen server karena itu
 * akan mencatat "sudah dibuka" untuk materi yang tidak pernah benar-benar
 * dibuka siapa pun — bukti palsu pada satu-satunya angka yang dibaca pemilik
 * klinik untuk memutuskan apakah materinya sudah sampai ke klien. `useEffect`
 * hanya berjalan di peramban yang sungguh-sungguh merender halamannya.
 *
 * `useRef` menjaga satu kali per pemuatan: React Strict Mode menjalankan efek
 * DUA KALI di pengembangan, dan tanpa penjaga ini setiap kunjungan akan
 * tercatat sebagai dua.
 *
 * Tidak merender apa pun yang terlihat. Atribut `data-catat-buka` ada supaya
 * keberadaannya bisa diuji — termasuk KETIADAANNYA di layar "materi belum
 * terbuka", yang justru hal terpenting untuk dijaga di sini.
 */
export function PencatatBuka({ materiId }: { materiId: string }) {
  const sudah = useRef(false);

  useEffect(() => {
    if (sudah.current) return;
    sudah.current = true;
    // Sengaja tanpa `await` dan tanpa penanganan galat: gagal mencatat jejak
    // tidak boleh terlihat oleh klien yang sedang membaca materinya.
    void catatBukaMateri(materiId);
  }, [materiId]);

  return <span data-catat-buka={materiId} hidden />;
}
