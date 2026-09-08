-- ============================================================================
-- LITERAL 'batal' YANG TERTINGGAL DI DUA DEFINISI SQL
-- ============================================================================
-- Ditemukan saat menambal utang fixture uji, BUKAN oleh pagar yang seharusnya
-- menangkapnya — dan itu bagian terpenting dari catatan ini.
--
-- `20260909101000_rantai_status_pagar` menulis ulang dua fungsi yang menyimpan
-- literal `'menunggu'`, dan `tests/rantai-status-db.test.ts` memasang pagar
-- yang memindai `pg_proc.prosrc` untuk literal itu. Pagarnya hanya memeriksa
-- `booking_status`. Dua definisi lain menyimpan literal `'batal'` — nilai
-- `session_status` yang juga berganti nama — dan lolos sepenuhnya:
--
--   * fungsi `klaim_sudah_bayar` (20260830100000_klaim_hanya_sesi_lepas)
--   * view  `sesi_menunggu_tarif` (20260907140000_sesi_menunggu_tarif)
--
-- Keduanya GAGAL saat dijalankan (22P02: nilai enum tidak dikenal), bukan saat
-- migrasi — persis bentuk kegagalan yang diperingatkan spec C1: kode yang
-- membandingkan dengan nilai lama tidak error saat dipasang, ia menunggu
-- sampai ada yang memakainya. Yang memakainya di sini adalah klien yang
-- menekan "saya sudah bayar", dan owner yang membuka daftar sesi >20 km.
--
-- Pagar pemindainya ikut diperluas ke `session_status` di berkas uji yang sama.
-- Satu pagar yang hanya memeriksa separuh enum yang berubah adalah pagar yang
-- memberi rasa aman tanpa memberi keamanan.

-- ===== 1) `klaim_sudah_bayar` =====
-- DISALIN APA ADANYA dari 20260830100000_klaim_hanya_sesi_lepas — tipe
-- kembalian, validasi `jenis`, `limit 1`, filter `p.status = 'aktif'`, dan
-- seluruh komentarnya. HANYA nama statusnya yang berubah.
--
-- Draf pertama berkas ini menulis ulang fungsinya "dari ingatan" dan
-- kehilangan empat hal sekaligus, termasuk penolakan `jenis` di luar
-- 'paket'/'sesi' — yang membuat argumen tak dikenal diam-diam diperlakukan
-- sebagai klaim PAKET. Uji `passport-bayar-ajukan` menangkapnya. Ini persis
-- jebakan yang sudah ditulis di berkas migrasi sebelumnya dan tetap dilanggar:
-- `create or replace function` mengganti SELURUH badan, jadi apa yang tidak
-- disalin, hilang.
create or replace function public.klaim_sudah_bayar(jenis text, sasaran_id uuid)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pemilik uuid;
begin
  if jenis not in ('paket', 'sesi') then
    raise exception 'jenis klaim tidak dikenal: %', jenis using errcode = '22023';
  end if;

  -- Kepemilikan diturunkan dari SESI, tidak pernah dari argumen — itulah yang
  -- membuat filter di bawah bermakna.
  select c.id into pemilik
    from public.clients c
   where c.user_id = auth.uid()
   limit 1;
  if pemilik is null then
    return; -- akun belum tertaut: tidak ada baris yang boleh disentuh
  end if;

  if jenis = 'sesi' then
    return query
      update public.sessions s
         set status_bayar = 'menunggu_verifikasi'
       where s.id = sasaran_id
         and s.client_id = pemilik
         and s.status_bayar = 'belum'
         -- Sesi berpaket memikul status paketnya, bukan status sendiri.
         and s.client_package_id is null
         -- Sesi yang dibatalkan tidak menagih apa pun.
         --
         -- SENGAJA hanya `dibatalkan_padma`, bukan juga `tidak_hadir`: apakah
         -- sesi yang kliennya tidak hadir tetap ditagih adalah keputusan C3
         -- yang belum diambil, dan mengubahnya diam-diam di sini akan
         -- mendahului keputusan itu dengan cara yang tidak terlihat siapa pun.
         and s.status <> 'dibatalkan_padma'
      returning s.id;
  else
    return query
      update public.client_packages p
         set status_bayar = 'menunggu_verifikasi'
       where p.id = sasaran_id
         and p.client_id = pemilik
         and p.status_bayar = 'belum'
         -- Sejajar dengan `ambilPaket()`: paket yang sudah tidak aktif tidak
         -- pernah muncul di halaman Bayar, jadi ia juga tidak boleh bisa
         -- diklaim lewat endpoint RPC langsung.
         and p.status = 'aktif'
      returning p.id;
  end if;
end;
$$;

-- ===== 2) view `sesi_menunggu_tarif_transport` =====
-- NAMA VIEWNYA `sesi_menunggu_tarif_transport`, bukan `sesi_menunggu_tarif`.
-- Draf pertama berkas ini salah menyebutnya dan akibatnya BUKAN galat: ia
-- MELAHIRKAN view baru bernama `sesi_menunggu_tarif` yang tidak dipakai siapa
-- pun, sementara view yang sebenarnya rusak tetap rusak. Ketahuan lewat
-- `admin-pengerasan` — view baru itu lahir dengan hak tulis bawaan Supabase
-- untuk `authenticated`, dan pagar "tidak ada view yang boleh ditulis peran
-- API" menyala. Kalau bukan karena pagar itu, view hantu ini akan hidup
-- diam-diam sampai seseorang membacanya dan bertanya-tanya mana yang benar.
drop view if exists public.sesi_menunggu_tarif;

create or replace view public.sesi_menunggu_tarif_transport
  with (security_invoker = off) as
  select s.id, c.nama as nama_klien, s.tanggal
    from public.sessions s
    join public.clients c on c.id = s.client_id
   where s.jenjang = 'di_atas_20'
     and s.status <> 'dibatalkan_padma'
     and not exists (
       select 1 from public.transport_khusus tk where tk.session_id = s.id
     )
     and public.user_role() in ('admin', 'owner');

-- Hak DIPULIHKAN eksplisit, tidak dianggap terbawa: view yang lahir di skema
-- `public` mendapat INSERT/UPDATE bawaan untuk `authenticated`, dan hanya
-- `revoke` yang menutupnya. Disalin dari migration aslinya.
revoke all on public.sesi_menunggu_tarif_transport from public, anon, authenticated;
grant select on public.sesi_menunggu_tarif_transport to authenticated;

comment on view public.sesi_menunggu_tarif_transport is
  'Sesi >20 km, bukan dibatalkan, tanpa baris transport_khusus — satu-satunya '
  'definisi "menunggu tarif khusus" di sistem ini.';
