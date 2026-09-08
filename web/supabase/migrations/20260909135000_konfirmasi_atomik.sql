-- ============================================================================
-- KONFIRMASI SEBAGAI SATU TRANSAKSI (spec C1 J1/J7)
-- ============================================================================
-- Konfirmasi adalah DUA tulisan yang harus berlaku sebagai SATU keputusan:
-- `booking_requests.status` menjadi 'dikonfirmasi', dan satu baris `sessions`
-- lahir. Dikerjakan dari TypeScript, keduanya adalah dua round-trip terpisah,
-- dan kegagalan di antaranya meninggalkan permintaan terkonfirmasi tanpa sesi
-- — hilang dari antrean admin sekaligus dari passport klien, tanpa error.
-- Kompensasi di sisi klien tidak menutupnya: kompensasinya bisa gagal juga.
--
-- Di dalam fungsi ini keduanya satu transaksi. Kegagalan parsial lenyap sebagai
-- KELAS masalah, bukan ditangani per kasus. Polanya sudah idiomatik di repo
-- ini: `klaim_sudah_bayar`, `ganti_halaman_materi`, `perbarui_profil_klien`.
--
-- YANG TIDAK BERUBAH, dan wajib tetap terbukti:
--   * SERIALISASI dua konfirmasi bersamaan. `update … where status='mitra_siap'`
--     di bawah mengunci baris; transaksi kedua menunggu, lalu menilai ulang
--     syaratnya terhadap baris yang sudah berubah dan tidak mengenai apa pun.
--     Indeks `sessions_booking_request_unik` tetap menjadi jaring KEDUA.
--   * IDENTITAS KLIEN DIBACA DARI BARIS PERMINTAAN, tidak pernah dari pemanggil.
--   * KEADAAN TUJUAN TIDAK PERNAH MENJADI PARAMETER.
--
-- `jenjang` dihitung di TypeScript dan DIOPER masuk, bukan dihitung di sini.
-- Menulis ulang haversine dalam SQL berarti dua salinan rumus jarak dalam dua
-- bahasa yang harus sepakat selamanya — persis jenis duplikasi yang sudah
-- ditolak Ruling 20 untuk `LABEL_JENJANG`. Yang dipindahkan ke basis data
-- adalah ATOMISITASnya, bukan domainnya.
--
-- ===== KENAPA HANYA SATU ARGUMEN, DAN KENAPA `jenjang_sumber` BUKAN =====
-- Sebelum RPC ini ada, jalur konfirmasi aman dari klaim palsu bukan karena
-- penjaga melainkan karena ia TIDAK PERNAH membaca FormData sama sekali —
-- komentarnya menyebutnya begitu: "tidak ada klaim pemanggil untuk dipercaya
-- atau ditolak" (src/app/admin/sesi/aksi.ts). Menjadikannya RPC ber-EXECUTE
-- untuk `authenticated` MENGHAPUS sifat itu: sekarang ADA pemanggil, admin bisa
-- memanggilnya langsung tanpa lewat server action, dan pemanggil bisa berbohong.
--
-- `jenjang_sumber` karena itu TIDAK BOLEH menjadi parameter. Satu-satunya
-- pagar yang ada — `sessions_alasan_penimpaan` (migration alamat_dan_koordinat)
-- — hanya menuntut alasan ketika sumbernya 'admin'; tidak ada apa pun yang
-- memaksa 'otomatis' jujur. Bila ia parameter, seorang admin bisa mencatat
-- jenjang pilihan tangan sebagai hasil hitungan otomatis, dan rekap transport
-- owner akan membacanya sebagai angka yang tidak pernah diperiksa siapa pun.
-- Fungsi ini menuliskannya sendiri: 'otomatis' bila ada saran, NULL bila tidak.
-- Penimpaan oleh admin tetap punya jalurnya sendiri (`tetapkanJenjang`), yang
-- memang menuntut alasan.
--
-- SECURITY DEFINER dengan penjaga peran DI DALAM: pola yang sama dengan
-- `klaim_sudah_bayar`. `search_path` dikunci supaya fungsi ber-definer tidak
-- bisa dibajak lewat skema bayangan.
create or replace function public.konfirmasi_permintaan(
  permintaan_id uuid,
  jenjang_saran jenjang_transport default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.booking_requests%rowtype;
  sesi_id uuid;
begin
  -- Penjaga peran DI DALAM fungsi: `security definer` mematikan RLS, jadi tanpa
  -- baris ini setiap klien yang login bisa mengonfirmasi permintaannya sendiri
  -- lewat RPC — celah yang pernah nyata di proyek ini.
  if user_role() not in ('admin', 'owner') then
    raise exception 'hanya staf yang boleh mengonfirmasi permintaan jadwal'
      using errcode = '42501';
  end if;

  update public.booking_requests
     set status = 'dikonfirmasi'
   where id = permintaan_id
     and status = 'mitra_siap'
  returning * into p;

  -- Tidak mengenai baris mana pun: sudah dikonfirmasi orang lain, dibatalkan
  -- klien, atau belum sampai 'mitra_siap'. NULL dibedakan dari galat oleh
  -- pemanggil, yang memulangkan kalimat untuk manusia.
  if not found then
    return null;
  end if;

  -- CHECK `booking_requests_mitra_siap_bermitra` sudah menjamin ini, tetapi
  -- membiarkannya lolos ke `insert` akan menghasilkan galat FK yang tidak
  -- menyebut sebabnya. Pagar yang berbicara lebih murah daripada pagar yang
  -- benar tetapi bisu.
  if p.partner_id is null then
    raise exception 'permintaan mitra_siap tanpa mitra: %', permintaan_id;
  end if;

  insert into public.sessions (
    client_id, service_id, variant_id, partner_id,
    tanggal, jam_mulai,
    alamat, alamat_lat, alamat_lon,
    jenjang, jenjang_sumber, jenjang_alasan,
    status, booking_request_id
  ) values (
    p.client_id, p.service_id, p.variant_id, p.partner_id,
    p.tanggal, p.jam_mulai,
    -- Alamat & koordinat DISALIN dari baris permintaan, tidak diambil ulang
    -- dari profil klien (spec T6): klien boleh memesan untuk alamat lain, dan
    -- mengambil ulang akan diam-diam mengubah ke mana mitra dikirim.
    p.alamat, p.alamat_lat, p.alamat_lon,
    jenjang_saran,
    -- `jenjang_sumber` DITULIS FUNGSI INI, tidak pernah diterima sebagai
    -- argumen. Lihat dokblok "kenapa hanya SATU argumen" di atas.
    case when jenjang_saran is null then null else 'otomatis'::sumber_jenjang end,
    '',
    'terjadwal', p.id
  )
  returning id into sesi_id;

  return sesi_id;
end;
$$;

-- Anon tidak pernah boleh memanggilnya: anon key tertanam di bundel peramban.
revoke execute on function public.konfirmasi_permintaan(uuid, jenjang_transport)
  from public, anon;
grant execute on function public.konfirmasi_permintaan(uuid, jenjang_transport)
  to authenticated;
