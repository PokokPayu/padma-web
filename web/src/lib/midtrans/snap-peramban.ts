import { urlSkripSnap } from "./konfig";

/**
 * Pemuat skrip Snap — satu kali per halaman, dan satu kali saja.
 *
 * Skrip Snap tidak bisa diimpor sebagai modul: ia menempel `window.snap`
 * sesudah dimuat, dan atribut `data-client-key` pada tag <script>-nyalah yang
 * memberitahunya merchant mana ini.
 *
 * `produksi` DIOPER, tidak dibaca dari env. `MIDTRANS_PRODUKSI` tidak berprefix
 * `NEXT_PUBLIC_`, jadi membacanya di sini akan selalu memberi `undefined` dan
 * karenanya SELALU sandbox — di produksi, tanpa satu pun galat. Yang membacanya
 * adalah `/produk/[slug]/page.tsx` di server.
 *
 * Janji pemuatannya disimpan di modul: dua tombol di satu halaman (atau satu
 * tombol yang diklik dua kali) tidak boleh menyisipkan dua tag <script>. Pada
 * kegagalan, janjinya DILEPAS supaya klik berikutnya benar-benar mencoba lagi
 * alih-alih mewarisi kegagalan lama selamanya.
 */
declare global {
  interface Window {
    snap?: {
      pay: (
        token: string,
        opsi: {
          onSuccess?: () => void;
          onPending?: () => void;
          onError?: () => void;
          onClose?: () => void;
        },
      ) => void;
    };
  }
}

const ID_SKRIP = "midtrans-snap";

/**
 * Kalimat yang SAMA dengan yang dipulangkan `terbitkanTokenSnap` ketika
 * `MIDTRANS_SERVER_KEY` kosong. Satu keadaan — Midtrans belum dipasang — tidak
 * boleh punya dua kalimat hanya karena yang mendeteksinya kebetulan server
 * atau peramban.
 */
export const PESAN_PEMBAYARAN_BELUM_AKTIF = "Pembayaran belum aktif. Hubungi tim PADMA.";

let pemuatan: Promise<void> | null = null;

export async function muatSkripSnap(clientKey: string, produksi: boolean): Promise<void> {
  /**
   * FAIL CLOSED atas kunci kosong, dan DIPERIKSA SEBELUM pagar peramban.
   *
   * `page.tsx` mengoper `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY ?? ""` (dibaca DI
   * SERVER — lihat dokblok berkas), jadi env yang belum dipasang tiba di sini
   * sebagai string kosong. Tanpa
   * baris ini skripnya tetap disisipkan dengan `data-client-key=""`, Snap
   * memuat dirinya, popupnya terbuka, dan pembayarannya gagal tanpa menyebut
   * sebabnya — satu-satunya env Midtrans di repo ini yang TIDAK fail-closed
   * (bandingkan `serverKeyMidtrans()` kosong: adapter menolak menerbitkan
   * token, dan webhook menjawab 503).
   *
   * Urutannya sengaja mendahului pemeriksaan `window`: salah konfigurasi
   * punya jawaban yang sama di server maupun di peramban, dan mendahulukannya
   * membuat pagar ini bisa diuji tanpa DOM.
   */
  if (clientKey.trim() === "") {
    throw new Error(PESAN_PEMBAYARAN_BELUM_AKTIF);
  }
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("muatSkripSnap hanya hidup di peramban.");
  }
  if (window.snap) return;
  if (pemuatan) return pemuatan;

  pemuatan = new Promise<void>((selesai, gagal) => {
    const skrip = document.createElement("script");
    skrip.id = ID_SKRIP;
    skrip.src = urlSkripSnap(produksi);
    skrip.async = true;
    skrip.setAttribute("data-client-key", clientKey);
    skrip.onload = () => selesai();
    skrip.onerror = () => gagal(new Error("Skrip pembayaran gagal dimuat."));
    document.head.appendChild(skrip);
  });

  try {
    await pemuatan;
  } catch (galat) {
    pemuatan = null;
    document.getElementById(ID_SKRIP)?.remove();
    throw galat;
  }
}
