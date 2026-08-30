// ============================================================================
// FORMAT RUPIAH — hanya untuk panel owner
// ============================================================================
// Modul ini sengaja hidup di bawah `src/lib/owner/`, bukan di `src/lib/` umum.
// Money firewall PADMA bukan sekadar soal RLS: sebuah `formatRupiah` yang
// gampang diimpor dari mana saja adalah undangan permanen untuk menampilkan
// nominal di panel admin atau passport — persis kebocoran yang seluruh pagar
// basis data dibangun untuk mencegah. Letaknya di sini membuat impor dari luar
// wilayah owner terlihat ganjil pada saat ditulis, bukan setahun kemudian.
//
// Nilai uang PADMA adalah RUPIAH BULAT (`service_rates.harga_klien` dan
// `honor_mitra` bertipe `int`), jadi tidak ada sen yang perlu dibulatkan dan
// tidak ada pecahan yang boleh muncul.

/**
 * "Rp 425.000". Pemisah ribuan Indonesia lewat `toLocaleString("id-ID")` —
 * bukan regex sisipan titik buatan sendiri, yang selalu salah pada angka
 * negatif (margin bisa negatif bila honor melebihi harga).
 */
export function formatRupiah(nilai: number): string {
  if (!Number.isFinite(nilai)) return "Rp –";
  return `Rp ${Math.round(nilai).toLocaleString("id-ID")}`;
}
