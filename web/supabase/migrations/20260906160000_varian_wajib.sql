-- ============================================================================
-- VARIAN WAJIB — menutup jendela yang sengaja dibuka
-- ============================================================================
-- Kolomnya dibiarkan NULLABLE sejak migration sesi_menunjuk_varian supaya
-- jalur tulis punya waktu pindah tanpa mematikan pengajuan jadwal klien. Jalur
-- itu sudah pindah (`ajukanJadwal()` mewajibkan & memvalidasi varian,
-- `konfirmasiPermintaan()` meneruskannya dari permintaan asal, `jadwalkanSesi()`
-- menerima pilihan admin), jadi jendelanya ditutup di sini.
--
-- Sesudah ini, sesi tanpa varian tidak bisa ada — termasuk lewat REST, dan
-- termasuk lewat service role. Harga sesi karena itu selalu punya satuan.

-- Jaring pengaman: baris yang lolos di antara dua migrasi (mis. ditulis
-- lewat REST atau service role sebelum jalur aplikasi sempat pindah) diisi
-- varian baku layanannya masing-masing — pola yang SAMA dengan backfill
-- migrasi `sesi_menunjuk_varian`.
update public.sessions s
   set variant_id = (select v.id from public.service_variants v
                      where v.service_id = s.service_id
                      order by v.urutan, v.created_at, v.id limit 1)
 where s.variant_id is null;

update public.booking_requests b
   set variant_id = (select v.id from public.service_variants v
                      where v.service_id = b.service_id
                      order by v.urutan, v.created_at, v.id limit 1)
 where b.variant_id is null;

alter table public.sessions         alter column variant_id set not null;
alter table public.booking_requests alter column variant_id set not null;
