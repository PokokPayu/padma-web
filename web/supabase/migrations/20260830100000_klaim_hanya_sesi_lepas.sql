-- ============================================================================
-- KLAIM PEMBAYARAN HANYA UNTUK SESI LEPAS (DAN PAKET YANG MASIH AKTIF)
-- ============================================================================
-- Spec bagian 5: "status_bayar hanya relevan untuk sesi lepas; sesi dalam paket
-- mengikuti status paketnya." RPC klaim warisan Plan 4 hanya menyaring
-- `client_id` dan `status_bayar = 'belum'` — ia TIDAK menyaring
-- `client_package_id`. Padahal `susunTagihan()` di `@/lib/passport/turunan`
-- membuang sesi berpaket dan sesi batal, dan `ambilPaket()` hanya mengambil
-- paket berstatus 'aktif'. Selisih itulah lubangnya: item yang TIDAK PERNAH
-- tampil di halaman Bayar tetap bisa diklaim lewat endpoint RPC langsung.
--
-- Akibatnya bukan sekadar baris salah. Data seed sendiri kontradiktif (paket
-- sudah dibayar penuh, tujuh sesi anggotanya tetap 'belum'), sehingga tujuh
-- "tagihan hantu" bisa diklaim satu per satu. Setiap klaim menaikkan badge
-- antrean admin tanpa melahirkan baris apa pun di daftar verifikasi — badge
-- yang TIDAK BISA DIBERSIHKAN, karena tidak ada yang bisa admin sentuh untuk
-- memadamkannya.
--
-- Yang berubah hanya KLAUSA WHERE. Bentuk lain fungsi ini sengaja dipertahankan
-- persis: `security definer` (klien memang tidak punya policy UPDATE atas kedua
-- tabel), identitas dari `auth.uid()` dan tidak pernah dari argumen, tujuan
-- transisi hardcoded di dalam badan fungsi, dan tanda tangan
-- (jenis text, sasaran_id uuid) — `src/lib/passport/aksi.ts` sudah memanggilnya
-- dengan nama argumen itu, dan nama argumen RPC PostgREST bersifat mengikat
-- (salah nama menghasilkan 404 PGRST202, bukan 400 yang jelas).
--
-- Cap waktu ditulis MANUAL: `supabase migration new` memakai jam dinding dan
-- sudah pernah menyelipkan migration ke tengah riwayat sehingga `db reset`
-- gagal. Berkas terakhir sebelum ini: 20260829200000.

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
         -- Sesi batal tidak menagih apa pun.
         and s.status <> 'batal'
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

-- `create or replace` mempertahankan ACL, tetapi pencabutannya ditulis ulang
-- supaya berkas ini berdiri sendiri saat dibaca. PostgREST mengekspos setiap
-- fungsi `public` sebagai RPC, dan anon key tertanam di bundel browser.
revoke execute on function public.klaim_sudah_bayar(text, uuid) from public, anon;
grant execute on function public.klaim_sudah_bayar(text, uuid) to authenticated;
