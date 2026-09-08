-- ============================================================================
-- BUCKET BUKTI BAYAR (spec C2 P3, P4)
-- ============================================================================
-- Bukti transfer memuat data yang PADMA TIDAK MINTA. Tangkapan layar m-banking
-- lazimnya menampilkan nama pemilik rekening, nomor rekening, dan sering kali
-- SALDO TERSISA. Begitu klien mengunggahnya, PADMA menyimpan data keuangan
-- pribadi yang tidak dibutuhkan untuk memverifikasi apa pun — dan menyimpannya
-- berarti bertanggung jawab atasnya.
--
-- Itu bukan alasan menolak unggahan; itu alasan merancangnya dengan sengaja.
--
-- SENGAJA TANPA SATU PUN POLICY pada storage.objects untuk bucket ini. Tanpa
-- policy, `anon` dan `authenticated` tidak bisa menyentuh objeknya sama sekali
-- — hanya service role, dari route handler kita, SESUDAH RLS memutuskan hak.
-- Ini pagar pertama dan yang paling murah: path yang bocor tetap tidak bisa
-- ditukar jadi byte. Pola yang sama persis dengan bucket `materi-halaman`.
--
-- Batas ukuran & jenis ditegakkan DI SINI, bukan hanya di peramban:
-- pengecilan gambar di sisi klien adalah kenyamanan, dan kenyamanan bisa
-- dilewati dengan satu panggilan langsung.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bukti-bayar', 'bukti-bayar', false, 2097152,
        array['image/webp','image/jpeg','image/png'])
on conflict (id) do nothing;

comment on column public.booking_requests.bukti_objek is
  'Kunci objek bukti bayar di bucket privat `bukti-bayar`. NULL = belum '
  'diunggah. Disimpan SAMPAI DIHAPUS MANUAL (keputusan pemilik repo 8 Sep '
  '2026) — panel admin karena itu WAJIB punya tombol hapus per baris dan '
  'saringan "lunas > 90 hari", karena tanpa alat, "manual" pada praktiknya '
  'berarti "tidak pernah". Menghapus bukti tidak menghapus jejak siapa '
  'memverifikasi dan kapan: itu hidup di tabel jejak status bayar.';
