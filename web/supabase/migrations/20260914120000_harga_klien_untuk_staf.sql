-- Harga KLIEN untuk staf admin, tanpa honor mitra ikut keluar.
--
-- Policy `variant_rates: hanya owner` SENGAJA TIDAK DISENTUH. Yang melebar
-- bukan hak baca atas tabelnya, melainkan sebuah view yang tidak pernah
-- menyebut `honor_mitra` — pola yang sama dengan `partner_publik`, yang
-- migrasinya menulis alasannya: "view inilah batas kolomnya". Honor mitra
-- tidak disembunyikan di UI; ia tidak pernah meninggalkan basis data lewat
-- jalur yang dilalui sisi admin.
--
-- `where user_role() in ('admin','owner')` membuat view ini KOSONG bagi klien,
-- sehingga `grant ... to authenticated` tidak diam-diam membuka harga ke
-- Passport. Gagalnya menutup, bukan membuka.
--
-- `distinct on` memilih tarif yang berlaku HARI INI di dalam SQL. Memilihnya
-- di TypeScript menuntut `tarifPadaTanggal()` yang hidup di `lib/owner/` —
-- mengimpornya ke sisi admin membalik pemisahan fisik yang justru sedang
-- dijaga — atau menulis pemilih kedua yang bisa berselisih dengan yang pertama.
--
-- Batas harinya kalender ASIA/JAKARTA, bukan `current_date`: server berjalan
-- UTC, dan setiap dini hari WIB `current_date` masih kemarin. Tarif yang
-- sudah berlaku "mulai hari ini" menurut kalender Jakarta tidak boleh
-- tertunda tujuh jam gara-gara dicek dengan tanggal UTC.
create view public.varian_harga_staf with (security_invoker = off) as
  select distinct on (vr.variant_id)
         vr.variant_id,
         vr.harga_klien,
         vr.harga_coret,
         vr.berlaku_sejak
    from public.variant_rates vr
   where vr.berlaku_sejak <= (now() at time zone 'Asia/Jakarta')::date
     and public.user_role() in ('admin', 'owner')
   order by vr.variant_id, vr.berlaku_sejak desc;

-- WAJIB revoke SEBELUM grant: Supabase memberi hak bawaan PENUH atas SETIAP
-- objek baru di skema `public` — termasuk VIEW — kepada `anon` MAUPUN
-- `authenticated`, dan `grant select ... to authenticated` MENAMBAH, bukan
-- MENGGANTIKAN. Melewatkan urutan ini sudah sekali memerahkan
-- tests/admin-pengerasan.test.ts pada migrasi sebelumnya di branch ini
-- (lihat migration `sesi_menunggu_jenjang`).
revoke all on public.varian_harga_staf from public, anon, authenticated;
grant select on public.varian_harga_staf to authenticated;

comment on view public.varian_harga_staf is
  'Harga KLIEN per varian untuk staf admin. Kolom honor_mitra sengaja tidak '
  'ada di sini — view ini batas kolomnya, bukan UI. Kosong bagi peran klien.';
