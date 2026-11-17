-- Tagihan sesi milik klien, dibaca dari Digital Passport (tugas B6, spec §6.3,
-- §7 sisi klien).
--
-- Kenapa RPC security definer, bukan SELECT biasa dari halaman:
--   - `order_items` lahir NOL grant bagi `authenticated` (angka beku hanya
--     keluar lewat fungsi), dan rinciannya wajib angka BEKU — angka yang
--     sama dengan yang ditagihkan DOKU, bukan rumus tarif hari ini;
--   - "uang sudah masuk" adalah `uang_sudah_masuk_permintaan` (Ruling 1),
--     tertutup bagi peran API. Tombol Bayar dan rute bayar membaca kolomnya
--     dari sini, jadi aturannya tetap tertulis SATU kali;
--   - service role di halaman klien adalah pagar yang hilang: yang memilih
--     baris di sini adalah `auth.uid()`, dan dua tempat yang memegang satu
--     aturan (halaman dan rute bayar) melihat data yang sama (pelajaran P1).
--
-- Baris yang dipulangkan: pengajuan milik pemanggil yang `menunggu_bayar`, ATAU
-- yang pesanan terkininya `lunas`/`ditahan` (halaman kembali dari DOKU harus
-- tetap bisa berkata "Lunas" sesudah pengajuan menjadi `dikonfirmasi`).
-- Pesanan = yang TERBARU per pengajuan. Baris warisan QRIS (§7) ikut dengan
-- kolom pesanan null.
--
-- Tidak menulis apa pun, jadi tidak masuk daftar fungsi-mesin-tertutup.
create or replace function public.tagihan_sesi_saya(p_permintaan_id uuid default null)
returns table (
  permintaan_id uuid,
  nama_layanan text,
  tanggal date,
  jam_mulai time,
  status_permintaan public.booking_status,
  status_bayar public.pay_status,
  pesanan_id uuid,
  kode text,
  status_pesanan public.order_status,
  kedaluwarsa_pada timestamptz,
  butuh_tinjauan boolean,
  uang_sudah_masuk boolean,
  tautan_baru boolean,
  sesi_id uuid,
  items jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    s.nama,
    b.tanggal,
    b.jam_mulai,
    b.status,
    b.status_bayar,
    o.id,
    o.kode,
    o.status,
    o.kedaluwarsa_pada,
    coalesce(o.butuh_tinjauan_pada is not null, false),
    public.uang_sudah_masuk_permintaan(b.id),
    -- "Baru kembali dari DOKU": tautan dicatat dalam 30 menit terakhir dan
    -- pesanannya masih terbuka. Halaman kembali tidak membaca satu parameter
    -- pun dari DOKU (K11); keadaan "sedang diproses" lahir dari kolom ini saja.
    coalesce(
      o.status = any (array['menunggu_bayar']::public.order_status[])
        and o.tautan_terbit_pada > now() - interval '30 minutes',
      false
    ),
    (select ss.id
       from public.sessions ss
      where ss.booking_request_id = b.id
      order by ss.created_at desc, ss.id
      limit 1),
    coalesce(
      (select jsonb_agg(jsonb_build_object('judul', i.judul_beku, 'harga', i.harga_beku)
                        order by i.urutan)
         from public.order_items i
        where i.pesanan_id = o.id),
      '[]'::jsonb
    )
  from public.clients c
  join public.booking_requests b on b.client_id = c.id
  join public.services s on s.id = b.service_id
  left join lateral (
    select o2.*
      from public.orders o2
     where o2.booking_request_id = b.id
       and o2.client_id = c.id
     order by o2.dibuat_pada desc, o2.id desc
     limit 1
  ) o on true
  where c.user_id = auth.uid()
    and (p_permintaan_id is null or b.id = p_permintaan_id)
    and (
      b.status = 'menunggu_bayar'
      or o.status = any (array['lunas', 'ditahan']::public.order_status[])
    )
  order by b.tanggal, b.jam_mulai, b.id;
$$;

comment on function public.tagihan_sesi_saya(uuid) is
  'Tagihan sesi milik pemanggil (auth.uid) untuk Digital Passport: pesanan terbaru '
  'per pengajuan, items dari harga_beku, uang_sudah_masuk dari predikat tunggal. '
  'Pengajuan menunggu_bayar, atau yang pesanan terkininya lunas/ditahan.';

revoke all on function public.tagihan_sesi_saya(uuid) from public, anon;
grant execute on function public.tagihan_sesi_saya(uuid) to authenticated;
