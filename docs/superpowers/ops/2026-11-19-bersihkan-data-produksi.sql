-- Pembersihan data klien & transaksi produksi PADMA — 19 Nov 2026.
--
-- Keputusan pemilik repo (19 Nov): data produksi adalah data uji coba;
-- dibersihkan SEBELUM rilis DOKU supaya produksi mulai dari bersih. Backup
-- penuh diambil lebih dulu dan terbukti pulih (runbook rilis §0b;
-- backups/padma-produksi-20261119.tar.age, terenkripsi age).
--
-- DIPERTAHANKAN: akun & profil owner/admin, katalog (fase, layanan, varian,
-- tarif varian & transport), 11 mitra, materi edukasi (materi, halaman,
-- video, tautan layanan), pengaturan aplikasi.
--
-- DIHAPUS di berkas ini: seluruh data klien & transaksi di skema public.
-- Akun auth 12 klien (profil ikut terhapus lewat cascade) dan objek Storage
-- `bukti-bayar` & `sertifikat` dihapus TERPISAH lewat Auth Admin API dan
-- Storage API, SESUDAH berkas ini — bukan lewat SQL, supaya GoTrue & Storage
-- tidak meninggalkan login atau berkas yatim.
--
-- Urutan mengikuti foreign key NO ACTION: sesi → pengajuan → skrining → klien.
-- Diukur di skema produksi 20260915100000: tidak ada trigger DELETE di
-- public, tidak ada FORCE RLS, peran eksekusi `postgres` (pemilik tabel).
--
-- Dijalankan sebagai SATU transaksi. Pagar pembuka menolak bila skemanya bukan
-- yang diharapkan atau datanya berubah sejak backup; pagar penutup menolak
-- bila masih ada sisa.

begin;

do $$
begin
  if (select max(version) from supabase_migrations.schema_migrations) <> '20260915100000' then
    raise exception 'Skema bukan produksi 20260915100000 — berhenti.';
  end if;
  if (select count(*) from public.clients) <> 12
     or (select count(*) from public.screenings) <> 28
     or (select count(*) from public.booking_requests) <> 17
     or (select count(*) from public.sessions) <> 9
     or (select count(*) from public.profiles where role = 'klien') <> 12 then
    raise exception 'Data berubah sejak backup 19 Nov — ambil backup baru dulu.';
  end if;
end $$;

delete from public.session_ratings;
delete from public.certificates;
delete from public.transport_khusus;
delete from public.honor_marks;
delete from public.sessions;
delete from public.jejak_status_bayar;
delete from public.jejak_jadwal;
delete from public.booking_requests;
delete from public.screening_claims;
delete from public.screenings;
delete from public.hak_sesi;
delete from public.material_assignments;
delete from public.client_invites;
delete from public.client_packages;
delete from public.clients;
delete from public.geocode_cache;

do $$
begin
  if exists (select 1 from public.clients)
     or exists (select 1 from public.screenings)
     or exists (select 1 from public.booking_requests)
     or exists (select 1 from public.sessions)
     or exists (select 1 from public.certificates)
     or exists (select 1 from public.geocode_cache) then
    raise exception 'Masih ada sisa data klien — dibatalkan.';
  end if;
  -- Yang dipertahankan HARUS utuh.
  if (select count(*) from public.services) <> 15
     or (select count(*) from public.service_variants) <> 46
     or (select count(*) from public.variant_rates) <> 32
     or (select count(*) from public.partners) <> 11
     or (select count(*) from public.materials) <> 10
     or (select count(*) from public.material_pages) <> 66
     or (select count(*) from public.profiles where role in ('owner', 'admin')) <> 2 then
    raise exception 'Data master ikut berubah — dibatalkan.';
  end if;
end $$;

commit;
