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
// Implementasinya sendiri hidup di `@/lib/rupiah-publik` dan dipakai BERSAMA
// dengan landing publik (gelombang perbaikan varian-layanan: dua formatter
// rupiah identik pernah hidup berdampingan — satu di sini dengan penjagaan
// `Number.isFinite`, satu lagi tumbuh sendiri di `_landing/lini-layanan.tsx`
// TANPA penjagaan itu). Batas di atas tetap UTUH sesudah penggabungan ini:
// yang dipindah cuma ATURAN FORMATNYA (angka -> string "Rp ..."), BUKAN akses
// ke tabel uang atau ke kode panel owner — modul bersama itu murni fungsi,
// tanpa I/O, tanpa tahu siapa pemanggilnya, persis seperti sebelumnya. Berkas
// INI tetap satu-satunya pintu yang wajar dipakai kode owner, dan
// money-firewall yang sudah ada tetap memindai IDENTIFIER `formatRupiah` di
// sumber admin/panel — bukan jalur impornya — jadi kebocoran tetap tertangkap
// dari mana pun nama itu datang.
//
// Nilai uang PADMA adalah RUPIAH BULAT (`variant_rates.harga_klien` dan
// `honor_mitra` bertipe `int`), jadi tidak ada sen yang perlu dibulatkan dan
// tidak ada pecahan yang boleh muncul.
export { formatRupiah } from "@/lib/rupiah-publik";
