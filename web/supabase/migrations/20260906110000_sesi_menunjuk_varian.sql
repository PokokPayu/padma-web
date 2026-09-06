-- ============================================================================
-- SESI & PERMINTAAN JADWAL MENUNJUK VARIAN
-- ============================================================================
-- Harga menempel di varian, jadi sesi yang hanya tahu layanannya tidak bisa
-- ditagihkan. Yang ditambahkan bukan pengganti `service_id` melainkan
-- PASANGANNYA: setiap query yang menyaring per layanan — agenda, tren sesi,
-- gating materi, rekap owner — tetap jalan tanpa satu baris pun diubah.
--
-- Bahaya menyimpan dua kolom adalah keduanya berpisah: sesi Garbha Relief
-- dengan varian Purnama Rest. Itu dijaga foreign key GABUNGAN, bukan validator
-- aplikasi — REST /rest/v1/sessions selalu jalur yang melewati validator.
--
-- NULLABLE dulu, sengaja. `not null` dipasang di migrasi Task 9, sesudah
-- ajukanJadwal() dan buatSesi() benar-benar mengirim varian. Memasangnya
-- sekarang mematikan pengajuan jadwal klien seketika.

alter table public.sessions         add column variant_id uuid;
alter table public.booking_requests add column variant_id uuid;

-- Backfill: varian BAKU layanan masing-masing (satu-satunya varian yang ada
-- sesudah migrasi Task 1, dipilih deterministik agar migrasi bisa diulang).
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

alter table public.sessions
  add constraint sessions_varian_milik_layanan
  foreign key (service_id, variant_id)
  references public.service_variants (service_id, id);

alter table public.booking_requests
  add constraint booking_requests_varian_milik_layanan
  foreign key (service_id, variant_id)
  references public.service_variants (service_id, id);

create index sessions_variant_idx         on public.sessions(variant_id);
create index booking_requests_variant_idx on public.booking_requests(variant_id);

comment on column public.sessions.variant_id is
  'Varian layanan yang dipesan — sumber harga sesi ini. Berpasangan dengan '
  'service_id lewat FK gabungan sessions_varian_milik_layanan, sehingga varian '
  'milik layanan LAIN ditolak basis data, bukan sekadar oleh validator.';
