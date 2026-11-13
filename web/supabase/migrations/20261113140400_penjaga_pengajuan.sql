-- Pembatalan, ganti bidan, dan penjaga pengajuan bertagihan (tugas B4, spec
-- §6.3 batal klien, §6.5, §6.7 `status_bayar`).
--
-- Isi:
--   (1) permintaan_melepas_tagihan     SATU daftar status yang melepas tagihan
--                                       pengajuan (dipakai kedua trigger di bawah)
--   (1b) masukan_harga_berubah         SATU daftar masukan harga (dipakai (3) dan (3b))
--   (2) guard_batal_permintaan_beruang  BEFORE UPDATE OF status: menolak
--                                       pelepasan bila uang sudah masuk
--   (3) tutup_pesanan_sesi_terbuka      AFTER UPDATE: menutup pesanan terbuka
--                                       saat pengajuan dilepas atau masukan
--                                       harganya berubah
--   (3b) guard_masukan_harga_warisan   BEFORE UPDATE: baris warisan QRIS yang uangnya
--                                       sudah masuk tidak boleh diubah masukan harganya
--   (4) guard_status_bayar_permintaan   status_bayar tidak lagi ditulis peran API
--   (5) batalkan_pengajuan_saya         RPC klien (auth.uid)
--   (6) batalkan_pengajuan_staf         RPC staf: menunggu_bayar -> dibatalkan_tenggat
--   (7) ganti_bidan_permintaan          RPC staf: ganti bidan selama menunggu_bayar
--   (8) verifikasi_bukti_warisan        RPC staf: verifikasi bukti QRIS warisan
--
-- ===== URUTAN KUNCI (Ruling 4 dan 7, rencana B) =====
-- Urutan seragam di seluruh rencana B adalah PESANAN lalu PENGAJUAN: webhook
-- (`terapkan_notifikasi_gateway`) mengunci pesanannya, lalu `salurkan_sesi`
-- mengunci pengajuannya; `terbitkan_tagihan_sesi` mengunci semua pesanan
-- pengajuan lalu barisnya. Trigger (3) berjalan SESUDAH baris pengajuan
-- terkunci oleh UPDATE, lalu mengunci pesanan: pengajuan -> pesanan, kebalikan
-- webhook. Karena itu setiap RPC di berkas ini yang mengubah `booking_requests`
-- mengunci SEMUA pesanan pengajuan itu lebih dulu (urut id), baru barisnya,
-- baru UPDATE — dan predikat uang (dinilai trigger (2) di dalam UPDATE itu)
-- membaca keadaan SESUDAH kedua kunci dipegang. Webhook yang sedang melunasi
-- pesanan karena itu membuat RPC MENUNGGU, lalu predikatnya melihat
-- pelunasan yang sudah commit; tanpa urutan ini keduanya saling menunggu.
--
-- Trigger (2) dan (3) tetap ada sebagai JARING untuk jalur tulis REST langsung
-- (policy "booking: staf" FOR ALL, policy klien "membatalkan miliknya", service
-- role). Di jalur itu urutannya tetap pengajuan -> pesanan, dan sisa risikonya
-- deadlock dengan webhook yang sedang berjalan. Postgres mendeteksinya dan
-- menggagalkan SATU transaksi dengan bersih (40P01): tidak ada yang tertulis
-- setengah. Bila yang gagal tulisan staf, ia cukup mengulang; bila yang gagal
-- webhook, rute menjawab non-2xx sehingga DOKU mengirim ulang notifikasinya,
-- dan rekonsiliasi Check Status menjadi lapis kedua.

-- ---------------------------------------------------------------------------
-- (1) permintaan_melepas_tagihan
-- ---------------------------------------------------------------------------
-- Status tujuan yang MELEPAS tagihan pengajuan: dua pembatalan, dan mundur ke
-- `mencari_mitra` (bidan dilepas; tagihan berikutnya dihitung dari bidan lain).
-- Satu daftar untuk dua trigger yang wajib sepakat: bila penutup pesanan
-- mengenal status yang tidak dikenal penjaga uang (atau sebaliknya), pengajuan
-- bisa lepas sementara pesanannya masih bisa dibayar, atau uang yang sudah
-- masuk ditinggal pengajuan yang batal. Daftar ditulis sebagai HIMPUNAN
-- eksplisit: nilai enum baru harus diputuskan masuk atau tidak.
create or replace function public.permintaan_melepas_tagihan(p_status public.booking_status)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_status = any (
    array['dibatalkan_klien', 'dibatalkan_tenggat', 'mencari_mitra']::public.booking_status[]
  );
$$;

comment on function public.permintaan_melepas_tagihan(public.booking_status) is
  'Status tujuan yang melepas tagihan pengajuan (dua pembatalan + mencari_mitra). '
  'Satu daftar untuk guard_batal_permintaan_beruang dan tutup_pesanan_sesi_terbuka.';

revoke all on function public.permintaan_melepas_tagihan(public.booking_status)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- (1b) masukan_harga_berubah
-- ---------------------------------------------------------------------------
-- Kolom pengajuan yang menentukan HARGA tagihan sesi: bidan dan titik alamat
-- (jenjang jarak), layanan dan varian (tarif), tanggal (tarif berlaku per
-- tanggal sesi), dan jam (tenggat = least(24 jam, jam kunjungan)). Memulangkan
-- nama manusia dari yang berubah, kosong bila tidak ada.
--
-- SATU daftar untuk dua trigger yang wajib sepakat: penutup pesanan terbuka
-- (3) dan penjaga baris warisan (3b). Kolom yang dikenal satu tetapi tidak
-- dikenal yang lain berarti harga yang bergeser diam-diam di salah satu jalur.
-- Teks `alamat` sengaja TIDAK masuk: harga dihitung dari titiknya.
create or replace function public.masukan_harga_berubah(
  p_lama public.booking_requests,
  p_baru public.booking_requests
)
returns text[]
language sql
immutable
set search_path = public
as $$
  select array_remove(array[
    case when p_baru.partner_id is distinct from p_lama.partner_id then 'bidan' end,
    case when p_baru.service_id is distinct from p_lama.service_id then 'layanan' end,
    case when p_baru.variant_id is distinct from p_lama.variant_id then 'varian' end,
    case when p_baru.tanggal    is distinct from p_lama.tanggal    then 'tanggal' end,
    case when p_baru.jam_mulai  is distinct from p_lama.jam_mulai  then 'jam' end,
    case when p_baru.alamat_lat is distinct from p_lama.alamat_lat then 'titik alamat (lat)' end,
    case when p_baru.alamat_lon is distinct from p_lama.alamat_lon then 'titik alamat (lon)' end
  ], null);
$$;

comment on function public.masukan_harga_berubah(public.booking_requests, public.booking_requests) is
  'Masukan harga pengajuan yang berubah (bidan, layanan, varian, tanggal, jam, titik '
  'alamat). Satu daftar untuk tutup_pesanan_sesi_terbuka dan guard_masukan_harga_warisan.';

revoke all on function public.masukan_harga_berubah(public.booking_requests, public.booking_requests)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- (2) guard_batal_permintaan_beruang
-- ---------------------------------------------------------------------------
-- BERLAKU UNTUK SEMUA PERAN — sengaja tanpa `current_user in (...)`, berbeda
-- dari penjaga lain di tabel ini. Yang dijaga bukan wewenang pemanggil
-- melainkan UANG ORANG: pengajuan yang pembayarannya sudah masuk (pesanan
-- lunas/ditahan, lunas_setelah_tutup yang belum ditutup staf, atau bukti QRIS
-- warisan) tidak boleh lepas dari tagihannya lewat jalan apa pun — klien,
-- admin, RPC security definer (`batalkan_pengajuan_staf` berjalan sebagai
-- pemilik fungsi, BUKAN peran API), maupun service role. Pengajuan seperti itu
-- diselesaikan lewat tinjauan: buat sesinya, lalu bila perlu batalkan sesinya
-- lewat jenjang C3-a (§6.5).
--
-- Security definer karena predikat `uang_sudah_masuk_permintaan` tertutup bagi
-- peran API (Ruling 1) — tanpa ini UPDATE klien dan staf lewat REST gagal
-- "permission denied" alih-alih ditolak dengan kalimat.
create or replace function public.guard_batal_permintaan_beruang()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and public.permintaan_melepas_tagihan(new.status)
     and public.uang_sudah_masuk_permintaan(new.id) then
    raise exception 'Pembayaran pengajuan ini sudah masuk dan sedang diperiksa admin.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function public.guard_batal_permintaan_beruang() is
  'Menolak pembatalan / mundur ke mencari_mitra atas pengajuan yang uangnya sudah '
  'masuk (uang_sudah_masuk_permintaan). Berlaku untuk SEMUA peran.';

revoke all on function public.guard_batal_permintaan_beruang() from public, anon, authenticated;

drop trigger if exists trg_guard_batal_permintaan_beruang on public.booking_requests;
create trigger trg_guard_batal_permintaan_beruang
  before update of status on public.booking_requests
  for each row execute function public.guard_batal_permintaan_beruang();

-- ---------------------------------------------------------------------------
-- (3) tutup_pesanan_sesi_terbuka
-- ---------------------------------------------------------------------------
-- Pesanan sesi `menunggu_bayar` membawa harga yang DIBEKUKAN dari bidan,
-- varian, layanan, tanggal sesi (tarif berlaku per tanggal), dan titik alamat
-- (jenjang jarak) pada saat terbit. Begitu salah satunya berubah, harga beku
-- itu bukan lagi harga kunjungan yang akan terjadi — dan pesanannya masih bisa
-- dibayar di DOKU. Karena itu setiap perubahan masukan harga MENUTUP pesanan
-- terbuka, dan admin wajib menerbitkan ulang (§6.5: "tidak ada jalan mengubah
-- masukan harga sementara pesanan lama masih bisa dibayar"). Jam masuk daftar
-- karena tenggat pesanan = least(24 jam, jam kunjungan): jam yang bergeser
-- membuat tenggat beku itu salah. Daftarnya hidup di `masukan_harga_berubah`.
-- Teks alamat TIDAK masuk: harga dihitung dari titiknya, dan membetulkan salah
-- ketik tidak boleh membatalkan tagihan. Agar itu benar juga di layar,
-- `perbaruiPermintaan` TIDAK menggeocode ulang selama `menunggu_bayar`
-- (koordinat lama dipertahankan kecuali admin menyentuh pin di peta); tanpa
-- itu salah ketik yang dibetulkan menggeser atau mengosongkan titiknya lewat
-- Nominatim, dan pesanan terbuka tertutup lewat cabang titik alamat di sini.
--
-- Ditegakkan sebagai TRIGGER supaya berlaku untuk SETIAP jalur tulis: RPC di
-- berkas ini, `perbaruiPermintaan` (REST staf), REST langsung, service role.
--
-- Pesanan `lunas`/`ditahan` TIDAK disentuh: uangnya sudah masuk dan harganya
-- tetap beku (ganti bidan sesudah lunas tidak mengubah nominal, keputusan
-- pemilik butir 2). Uang yang tetap mendarat di pesanan yang baru ditutup
-- tertangkap `terapkan_notifikasi_gateway` sebagai lunas_setelah_tutup.
--
-- Urutan kunci di sini pengajuan -> pesanan (baris pengajuan sudah dikunci
-- UPDATE pemicunya). RPC di berkas ini sudah memegang kunci pesanan lebih dulu,
-- jadi `for update` di bawah tidak menunggu apa pun bagi mereka; lihat
-- dokblok kepala berkas untuk sisa risiko di jalur REST langsung.
create or replace function public.tutup_pesanan_sesi_terbuka()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ubah text[];
  v_sebab text;
  v_padma_id text;
  v_pesanan uuid;
begin
  if new.status is distinct from old.status and public.permintaan_melepas_tagihan(new.status) then
    v_sebab := case new.status
      when 'dibatalkan_klien' then 'pengajuan dibatalkan klien'
      when 'dibatalkan_tenggat' then 'pengajuan dibatalkan admin'
      when 'mencari_mitra' then 'bidan pengajuan dilepas (mencari bidan lagi)'
      else format('pengajuan berpindah ke %s', new.status)
    end;
  else
    v_ubah := public.masukan_harga_berubah(old, new);
    if coalesce(cardinality(v_ubah), 0) = 0 then
      return null;
    end if;
    v_sebab := format('masukan harga pengajuan berubah (%s); tagihan perlu diterbitkan ulang',
                      array_to_string(v_ubah, ', '));
  end if;

  select c.padma_id into v_padma_id from public.clients c where c.id = new.client_id;

  for v_pesanan in
    select o.id
      from public.orders o
     where o.booking_request_id = new.id
       and o.status = 'menunggu_bayar'
     order by o.id
     for update
  loop
    if not coalesce(
      public.perpindahan_pesanan_sah('menunggu_bayar'::public.order_status,
                                     'dibatalkan'::public.order_status), false) then
      raise exception 'Mesin status menolak menutup pesanan pengajuan.' using errcode = 'P0001';
    end if;

    update public.orders o
       set status = 'dibatalkan',
           ditutup_pada = now()
     where o.id = v_pesanan
       and o.status = any (array['menunggu_bayar']::public.order_status[]);

    insert into public.jejak_pesanan (pesanan_id, padma_id, kejadian, keterangan)
    values (v_pesanan, v_padma_id, 'dibatalkan', v_sebab);
  end loop;

  return null;
end;
$$;

comment on function public.tutup_pesanan_sesi_terbuka() is
  'Menutup (dibatalkan + jejak bersebab) setiap pesanan sesi menunggu_bayar sebuah '
  'pengajuan saat pengajuan dibatalkan / mundur ke mencari_mitra, atau saat bidan, '
  'layanan, varian, tanggal, jam, atau titik alamatnya berubah.';

revoke all on function public.tutup_pesanan_sesi_terbuka() from public, anon, authenticated;

drop trigger if exists trg_tutup_pesanan_sesi_terbuka on public.booking_requests;
create trigger trg_tutup_pesanan_sesi_terbuka
  after update on public.booking_requests
  for each row execute function public.tutup_pesanan_sesi_terbuka();

-- ---------------------------------------------------------------------------
-- (3b) guard_masukan_harga_warisan
-- ---------------------------------------------------------------------------
-- Ruling 8. Baris WARISAN QRIS (§7) — pengajuan tanpa satu pun pesanan — yang
-- uangnya sudah masuk (`status_bayar` menunggu_verifikasi/lunas) tidak punya
-- harga beku: angka yang admin cocokkan dengan mutasi rekening, dan jenjang
-- transport yang kelak dihitung `konfirmasi_permintaan`, DITURUNKAN dari bidan,
-- varian, tanggal, dan titik alamat saat ini. Mengubahnya diam-diam membuat
-- transfer yang sudah dibayar klien tidak lagi cocok dengan tagihannya, atau
-- sesi lahir dengan jenjang yang bukan yang dibayar. Jalan yang benar:
-- konfirmasi jadwalnya dulu (sesi lahir dari angka yang dibayar), lalu jadwal
-- ulang dari sesinya.
--
-- Berlaku untuk SEMUA peran, alasan yang sama dengan penjaga (2): yang dijaga
-- uang orang, bukan wewenang pemanggil. Pengajuan BERPESANAN tidak disentuh:
-- harganya beku di `order_items`, dan pengajuan tertahan (pesanan lunas, sesi
-- belum lahir) WAJIB tetap bisa dipulihkan lewat ganti bidan atau ubah jadwal.
-- "Uang sudah masuk" dibaca dari predikat tunggal (Ruling 1), tidak ditulis
-- ulang di sini. Security definer karena predikat itu tertutup bagi peran API.
create or replace function public.guard_masukan_harga_warisan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(cardinality(public.masukan_harga_berubah(old, new)), 0) > 0
     and not exists (select 1 from public.orders o where o.booking_request_id = new.id)
     and public.uang_sudah_masuk_permintaan(new.id) then
    raise exception 'Pembayaran QRIS pengajuan ini sudah masuk. Konfirmasi jadwalnya dulu, lalu jadwal ulang dari sesi.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function public.guard_masukan_harga_warisan() is
  'Menolak perubahan masukan harga (masukan_harga_berubah) pada pengajuan TANPA pesanan '
  'yang uangnya sudah masuk (bukti QRIS warisan). Berlaku untuk SEMUA peran.';

revoke all on function public.guard_masukan_harga_warisan() from public, anon, authenticated;

drop trigger if exists trg_guard_masukan_harga_warisan on public.booking_requests;
create trigger trg_guard_masukan_harga_warisan
  before update on public.booking_requests
  for each row execute function public.guard_masukan_harga_warisan();

-- ---------------------------------------------------------------------------
-- (4) guard_status_bayar_permintaan
-- ---------------------------------------------------------------------------
-- §6.7: untuk jalur 1, `status_bayar` hanya ditulis fungsi mesin (penerbit
-- tagihan, penyalur sesi, verifikasi warisan). Sebelum ini staf bisa
-- menulisnya lewat REST langsung — policy "booking: staf" FOR ALL + hak
-- UPDATE, tanpa penjaga transisi, tanpa jejak — dan `status_bayar = 'lunas'`
-- adalah satu-satunya syarat uang `konfirmasi_permintaan` warisan.
--
-- SECURITY INVOKER (bawaan), dan itu wajib: `current_user` di trigger invoker
-- adalah peran pemanggil. Di dalam fungsi security definer ia pemilik fungsi,
-- sehingga fungsi mesin lolos; dari PostgREST ia `authenticated`/`anon`.
-- Service role (seed, uji, dan rute bukti warisan) tidak dijaga, sama dengan
-- penjaga status_bayar sesi (`guard_transisi_status_bayar`).
--
-- INSERT ikut dijaga (pola `guard_insert_status_bayar` milik sesi): tanpa itu
-- staf cukup MENYISIPKAN pengajuan `menunggu_bayar` ber-status_bayar 'lunas'
-- lalu mengonfirmasinya lewat jalur warisan.
create or replace function public.guard_status_bayar_permintaan()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if tg_op = 'INSERT' and new.status_bayar is distinct from 'belum'::public.pay_status then
      raise exception 'status bayar pengajuan hanya ditulis mesin pembayaran'
        using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.status_bayar is distinct from old.status_bayar then
      raise exception 'status bayar pengajuan hanya ditulis mesin pembayaran'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.guard_status_bayar_permintaan() is
  'booking_requests.status_bayar tidak bisa ditulis peran API (insert selain belum, '
  'atau perubahan nilai); hanya fungsi mesin security definer dan service role.';

revoke all on function public.guard_status_bayar_permintaan() from public, anon, authenticated;

drop trigger if exists trg_guard_status_bayar_permintaan on public.booking_requests;
create trigger trg_guard_status_bayar_permintaan
  before insert or update on public.booking_requests
  for each row execute function public.guard_status_bayar_permintaan();

-- ---------------------------------------------------------------------------
-- (5) batalkan_pengajuan_saya — RPC klien
-- ---------------------------------------------------------------------------
-- Menggantikan UPDATE langsung di `batalkanPengajuan` (Ruling 7): UPDATE REST
-- tidak bisa mengunci pesanan lebih dulu. Policy klien "membatalkan miliknya"
-- dan ketiga triggernya TETAP ada, jadi jalur lama tetap terjaga.
--
-- Security definer, maka seluruh penjaga peran-API (`guard_booking_status`,
-- `guard_booking_klien_batal`) tidak berlaku di dalamnya. Yang menggantikannya
-- ditulis di sini: baris dipilih dari `auth.uid()` (bukan dari payload), hanya
-- dari keadaan antrean, dan HANYA kolom `status` yang ditulis — skrining tidak
-- dilepas (C1 J3: pembatalan oleh klien adalah keputusan, bukan tenggat).
--
-- Daftar keadaan asal = STATUS_ANTRE (src/lib/jadwal/status.ts). Dua daftar
-- yang harus sepakat; tests/penjaga-pengajuan-db.test.ts membandingkannya
-- untuk setiap status.
create or replace function public.batalkan_pengajuan_saya(p_permintaan_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_status public.booking_status;
begin
  select c.id into v_client_id from public.clients c where c.user_id = auth.uid();
  if v_client_id is null then
    raise exception 'Akun ini belum terhubung ke data klien.' using errcode = '42501';
  end if;

  -- Kepemilikan diperiksa TANPA kunci sebelum mengunci apa pun, supaya
  -- pemanggil tidak bisa menahan pesanan orang lain walau sekejap.
  -- `client_id` pengajuan tidak pernah berubah, jadi bacaan ini tidak basi.
  -- Pengajuan milik orang lain dijawab sama dengan yang tidak ada.
  if not exists (
    select 1 from public.booking_requests b
     where b.id = p_permintaan_id and b.client_id = v_client_id
  ) then
    raise exception 'Pengajuan ini sudah dikonfirmasi atau sudah dibatalkan sebelumnya.'
      using errcode = 'P0001';
  end if;

  -- URUTAN KUNCI: semua pesanan pengajuan (urut id), lalu barisnya (lihat
  -- dokblok kepala berkas).
  perform 1
     from public.orders o
    where o.booking_request_id = p_permintaan_id
    order by o.id
    for update;

  select b.status into v_status
    from public.booking_requests b
   where b.id = p_permintaan_id
     and b.client_id = v_client_id
   for update;

  if not found or not (v_status = any (
    array['diminta', 'mencari_mitra', 'mitra_siap', 'menunggu_bayar']::public.booking_status[]
  )) then
    raise exception 'Pengajuan ini sudah dikonfirmasi atau sudah dibatalkan sebelumnya.'
      using errcode = 'P0001';
  end if;

  -- Predikat uang dinilai `guard_batal_permintaan_beruang` di dalam UPDATE
  -- ini, SESUDAH kedua kunci dipegang; pesanan terbukanya ditutup
  -- `tutup_pesanan_sesi_terbuka` di transaksi yang sama (§6.3).
  update public.booking_requests b
     set status = 'dibatalkan_klien'
   where b.id = p_permintaan_id;
end;
$$;

comment on function public.batalkan_pengajuan_saya(uuid) is
  'Klien membatalkan pengajuannya sendiri (keadaan antrean). Pesanan terbuka ikut '
  'ditutup di transaksi yang sama; ditolak bila uang sudah masuk.';

revoke all on function public.batalkan_pengajuan_saya(uuid) from public, anon;
grant execute on function public.batalkan_pengajuan_saya(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- (6) batalkan_pengajuan_staf — RPC staf
-- ---------------------------------------------------------------------------
-- §6.5 "Batalkan pengajuan": hanya dari `menunggu_bayar`, menjadi
-- `dibatalkan_tenggat` (nilai enum yang sudah ada; status adalah catatan
-- tentang SIAPA, dan ini bukan klien) dengan SKRINING DILEPAS — seperti
-- `batalkan_lewat_tenggat`, yang tidak pernah punya penulis hidup sehingga
-- skrining pengajuan macet tidak pernah lepas. Berlaku juga untuk baris
-- warisan tanpa pesanan (§7). Tidak ada pembatalan massal: satu baris per
-- panggilan, diputuskan manusia.
create or replace function public.batalkan_pengajuan_staf(p_permintaan_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_status public.booking_status;
begin
  if public.user_role() not in ('admin', 'owner') then
    raise exception 'Hanya staf yang boleh membatalkan pengajuan.' using errcode = '42501';
  end if;

  -- URUTAN KUNCI: semua pesanan pengajuan (urut id), lalu barisnya.
  perform 1
     from public.orders o
    where o.booking_request_id = p_permintaan_id
    order by o.id
    for update;

  select b.status into v_status
    from public.booking_requests b
   where b.id = p_permintaan_id
   for update;

  if not found or v_status is distinct from 'menunggu_bayar' then
    raise exception 'Pengajuan ini tidak sedang menunggu pembayaran, jadi tidak bisa dibatalkan dari sini.'
      using errcode = 'P0001';
  end if;

  -- Predikat uang dinilai `guard_batal_permintaan_beruang` di dalam UPDATE
  -- ini, sesudah kedua kunci dipegang. SATU tempat penolakan untuk semua
  -- jalur, dan karena itu penjaga tersebut wajib berlaku juga di dalam fungsi
  -- security definer seperti ini.
  update public.booking_requests b
     set status = 'dibatalkan_tenggat',
         screening_id = null
   where b.id = p_permintaan_id;
end;
$$;

comment on function public.batalkan_pengajuan_staf(uuid) is
  'Staf membatalkan pengajuan menunggu_bayar (berpesanan atau warisan) menjadi '
  'dibatalkan_tenggat dan melepas skriningnya. Ditolak bila uang sudah masuk.';

revoke all on function public.batalkan_pengajuan_staf(uuid) from public, anon;
grant execute on function public.batalkan_pengajuan_staf(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- (7) ganti_bidan_permintaan — RPC staf
-- ---------------------------------------------------------------------------
-- Ganti bidan TANPA mundur ke `mencari_mitra` (yang melepas tagihan dan
-- ditolak bila uang sudah masuk). Dua kegunaan:
--   - pesanan masih terbuka: harga dihitung dari titik bidan, jadi pesanan
--     lama ditutup trigger (3) dan admin menerbitkan ulang;
--   - pengajuan TERTAHAN (pesanan lunas, sesi tidak lahir karena bidannya
--     nonaktif): bidan diganti, pesanan lunas tidak disentuh dan harganya
--     tetap beku, lalu admin menekan "Terbitkan akses / Buat sesi" (§6.4).
-- Karena kegunaan kedua, uang yang sudah masuk BUKAN alasan menolak di sini.
create or replace function public.ganti_bidan_permintaan(p_permintaan_id uuid, p_partner_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_status public.booking_status;
  v_partner_lama uuid;
  v_aktif boolean;
begin
  if public.user_role() not in ('admin', 'owner') then
    raise exception 'Hanya staf yang boleh mengganti bidan.' using errcode = '42501';
  end if;

  -- URUTAN KUNCI: semua pesanan pengajuan (urut id), lalu barisnya. Trigger
  -- penutup pesanan terpicu oleh UPDATE di bawah.
  perform 1
     from public.orders o
    where o.booking_request_id = p_permintaan_id
    order by o.id
    for update;

  select b.status, b.partner_id into v_status, v_partner_lama
    from public.booking_requests b
   where b.id = p_permintaan_id
   for update;

  if not found or v_status is distinct from 'menunggu_bayar' then
    raise exception 'Bidan hanya bisa diganti di sini selama pengajuan menunggu pembayaran.'
      using errcode = 'P0001';
  end if;

  -- Foreign key hanya menolak bidan yang TIDAK ADA, bukan yang sudah pensiun.
  select m.aktif into v_aktif from public.partners m where m.id = p_partner_id;
  if not coalesce(v_aktif, false) then
    raise exception 'Bidan itu tidak aktif. Pilih bidan yang aktif.' using errcode = 'P0001';
  end if;

  if p_partner_id = v_partner_lama then
    raise exception 'Bidan itu sudah ditugaskan untuk pengajuan ini.' using errcode = 'P0001';
  end if;

  update public.booking_requests b
     set partner_id = p_partner_id
   where b.id = p_permintaan_id;
end;
$$;

comment on function public.ganti_bidan_permintaan(uuid, uuid) is
  'Staf mengganti bidan pengajuan menunggu_bayar (bidan aktif). Pesanan terbuka '
  'ditutup trigger; pesanan lunas tidak tersentuh dan harganya tetap beku.';

revoke all on function public.ganti_bidan_permintaan(uuid, uuid) from public, anon;
grant execute on function public.ganti_bidan_permintaan(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- (8) verifikasi_bukti_warisan — RPC staf
-- ---------------------------------------------------------------------------
-- Pengganti UPDATE REST `verifikasiPengajuan`, yang kini ditolak penjaga (4).
-- KHUSUS baris warisan QRIS (§7): pengajuan tanpa satu pun pesanan yang buktinya
-- sudah diunggah. Pengajuan berpesanan dibayar lewat DOKU; "memverifikasi"
-- status_bayar-nya akan membuka jalan konfirmasi tangan tanpa pelunasan.
create or replace function public.verifikasi_bukti_warisan(p_permintaan_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_status public.booking_status;
  v_status_bayar public.pay_status;
begin
  if public.user_role() not in ('admin', 'owner') then
    raise exception 'Hanya staf yang boleh memverifikasi pembayaran.' using errcode = '42501';
  end if;

  -- Urutan kunci yang sama dengan fungsi lain di berkas ini.
  perform 1
     from public.orders o
    where o.booking_request_id = p_permintaan_id
    order by o.id
    for update;

  select b.status, b.status_bayar into v_status, v_status_bayar
    from public.booking_requests b
   where b.id = p_permintaan_id
   for update;

  if exists (select 1 from public.orders o where o.booking_request_id = p_permintaan_id) then
    raise exception 'Pengajuan ini dibayar lewat DOKU; tidak ada bukti transfer untuk diverifikasi.'
      using errcode = 'P0001';
  end if;

  -- Hanya dari `menunggu_verifikasi`: menandai lunas sesuatu yang buktinya
  -- belum pernah masuk melewati langkah yang seluruh rantai ini tegakkan.
  if v_status is distinct from 'menunggu_bayar'
     or v_status_bayar is distinct from 'menunggu_verifikasi' then
    raise exception 'Tagihan ini tidak sedang menunggu verifikasi.' using errcode = 'P0001';
  end if;

  update public.booking_requests b
     set status_bayar = 'lunas'
   where b.id = p_permintaan_id;
end;
$$;

comment on function public.verifikasi_bukti_warisan(uuid) is
  'Staf menandai lunas bukti QRIS baris warisan (tanpa pesanan, menunggu_bayar, '
  'menunggu_verifikasi). Pengajuan berpesanan ditolak.';

revoke all on function public.verifikasi_bukti_warisan(uuid) from public, anon;
grant execute on function public.verifikasi_bukti_warisan(uuid) to authenticated;
