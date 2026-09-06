// ============================================================================
// FORMAT RUPIAH — landing publik
// ============================================================================
// Basis bersama untuk formatter rupiah non-owner: dipakai `_landing/lini-
// layanan.tsx` (harga publik di kartu layanan — keputusan sadar Task 8, spec
// V4 §4.4, BUKAN kebocoran yang dijaga di `lib/owner/rupiah.ts`) dan dipakai
// ULANG oleh `lib/owner/rupiah.ts` sendiri, supaya penjagaan `Number.isFinite`
// di bawah tidak pernah harus ditulis dua kali dengan dua nasib berbeda —
// persis yang terjadi sebelum berkas ini ada: `lini-layanan.tsx` menumbuhkan
// salinannya sendiri TANPA penjagaan itu.
//
// KENAPA BUKAN DIIMPOR LANGSUNG DARI `lib/owner/rupiah.ts`: landing publik
// tidak boleh mengimpor apa pun dari bawah `lib/owner/` — sebuah
// `import { formatRupiah } from "@/lib/owner/rupiah"` di `_landing/**` akan
// terlihat wajar dibaca sekilas, padahal itu justru rute paling gampang
// membocorkan asumsi kode milik panel owner ke halaman publik. Modul ini
// karena itu hidup NETRAL di `lib/`, tetapi nama filenya sendiri
// ("rupiah-PUBLIK") menjaga arah baca yang sama seperti "lib/owner/": siapa
// pun yang mengimpornya dari `src/app/admin/**` atau `src/lib/admin/**`
// semestinya terlihat SAMA ganjilnya seperti mengimpor `lib/owner/rupiah`
// langsung. Dan seandainya itu tetap terjadi, pagar money-firewall yang sudah
// ada (mis. tests/admin-tren.test.ts, tests/admin-agenda.test.ts,
// tests/panel-isi.test.ts, tests/panel-primitif.test.ts) tetap menangkapnya:
// semuanya memindai IDENTIFIER `formatRupiah` di sumber admin/panel, bukan
// jalur impornya — jadi tetap merah dari MANA PUN nama itu diimpor, karena
// nama exportnya sengaja dipertahankan SAMA persis dengan sebelum pemindahan.
//
// Nilai uang PADMA adalah RUPIAH BULAT (`variant_rates.harga_klien` dan
// `honor_mitra` bertipe `int`), jadi tidak ada sen yang perlu dibulatkan dan
// tidak ada pecahan yang boleh muncul.

/**
 * "Rp 425.000". Pemisah ribuan Indonesia lewat `toLocaleString("id-ID")` —
 * bukan regex sisipan titik buatan sendiri, yang selalu salah pada angka
 * negatif (margin owner bisa negatif bila honor melebihi harga).
 *
 * Penjagaan `Number.isFinite` bukan hiasan: input tak terduga (`NaN`,
 * `Infinity`) dari kalkulasi upstream tidak boleh lolos sebagai "Rp NaN" yang
 * tampil apa adanya ke pengguna — baik pengunjung landing maupun owner.
 */
export function formatRupiah(nilai: number): string {
  if (!Number.isFinite(nilai)) return "Rp –";
  return `Rp ${Math.round(nilai).toLocaleString("id-ID")}`;
}
