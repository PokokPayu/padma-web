-- ============================================================================
-- PEMANGGIL KEENAM: `klaim_sudah_bayar` MASIH MENYANDERA SATU NILAI "batal"
-- ============================================================================
-- C3-a menambah `dibatalkan_klien` di sebelah `dibatalkan_padma`. Sisi
-- TypeScript sudah diperbaiki — konstanta tunggal `SESI_DIBATALKAN` diganti
-- himpunan menyeluruh `SESI_TIDAK_TERJADI` (`src/lib/jadwal/status.ts`),
-- sehingga anggota enum berikutnya MEMAKSA keputusan alih-alih ikut terlewat.
-- Satu pemanggil ketinggalan, dan ia ada di SQL: fungsi ini.
--
-- Barisnya berbunyi `and s.status <> 'dibatalkan_padma'` — satu literal tunggal
-- yang berarti "sesi yang dibatalkan tidak menagih apa pun". Ketika komentar
-- itu ditulis, `dibatalkan_klien` belum ada dan kalimatnya benar. Sekarang ia
-- ada, dan jalurnya baru sekarang terjangkau.
--
-- ===== AKIBAT NYATANYA, DAN KENAPA INI BUKAN SEKADAR KERAPIAN =====
-- `klaim_sudah_bayar` di-`grant` ke `authenticated`. Klien karena itu bisa
-- memanggilnya atas sesinya SENDIRI yang berstatus `dibatalkan_klien` dengan
-- `status_bayar = 'belum'`, dan barisnya berpindah ke `menunggu_verifikasi`.
--
-- Sesudah itu baris tersebut MACET PERMANEN — tidak bisa dipulihkan dari layar
-- mana pun. `lib/admin/tagihan.ts` dan `app/admin/bayar/aksi.ts` sama-sama
-- menyaring sesi batal keluar lewat `FILTER_SESI_BATAL`, dan Passport
-- menyaringnya lewat `sesiBatal()`. Jadi admin tidak akan pernah melihat baris
-- itu untuk memverifikasi ATAU menolaknya, dan klien tidak melihatnya juga.
-- Bukan uang yang hilang, melainkan baris yang tidak punya jalan keluar plus
-- permukaan tulis klien yang memang tidak pernah dimaksudkan ada.
--
-- ===== `tidak_hadir` TETAP DI LUAR — JANGAN MENDAHULUI KEPUTUSAN C3 =====
-- Komentar aslinya menyebutkan bahwa `tidak_hadir` SENGAJA tidak ikut
-- dikecualikan: "apakah sesi yang kliennya tidak hadir tetap ditagih" adalah
-- keputusan C3 yang belum diambil. Keputusan itu MASIH belum diambil. Yang
-- ditambahkan berkas ini HANYA `dibatalkan_klien` — nilai yang maknanya sudah
-- pasti (sesi tidak terjadi, dan akibat uangnya ditentukan jenjang, bukan oleh
-- klien yang menekan "saya sudah bayar"). Menambahkan `tidak_hadir` sekalian
-- akan menyelundupkan keputusan produk ke dalam perbaikan bug, dengan cara
-- yang tidak terlihat siapa pun. Pilihan yang sama persis dipakai sisi
-- TypeScript: `SESI_TIDAK_TERJADI.tidak_hadir` bernilai `false`.
--
-- ===== BENTUKNYA TIDAK LAGI MENYANDERA SATU NILAI =====
-- `<> 'satu-nilai'` diganti `not in (…)` berisi SELURUH status "sesi tidak
-- terjadi" yang relevan. SQL tidak punya padanan `Record<StatusSesi, …>` yang
-- menolak dipasang ketika anggota enum baru lahir, jadi yang bisa dilakukan
-- adalah membuat daftarnya kelihatan sebagai DAFTAR — dan menjaganya dari
-- sisi uji (`tests/klaim-sesi-lepas.test.ts` menguji kedua status batal
-- sebagai pasangan).
--
-- ===== SELURUH BADAN DISALIN APA ADANYA =====
-- `create or replace function` mengganti SELURUH badan: apa yang tidak
-- disalin, hilang. Pelajaran ini sudah dibayar mahal di repo ini — draf
-- pertama `20260909145000_literal_batal_tertinggal` menulis ulang fungsi INI
-- dari ingatan dan kehilangan empat perilaku sekaligus, termasuk penolakan
-- `jenis` di luar 'paket'/'sesi' (yang membuat argumen tak dikenal diam-diam
-- diperlakukan sebagai klaim PAKET). Badan di bawah disalin verbatim dari
-- `20260909145000_literal_batal_tertinggal.sql` — tipe kembalian, validasi
-- `jenis`, `limit 1`, filter `p.status = 'aktif'`, dan seluruh komentarnya.
-- HANYA satu baris predikat yang berubah.
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
         -- Sesi yang dibatalkan tidak menagih apa pun — KEDUA nilai "batal",
         -- bukan satu. Yang dibatalkan klien pun tidak menagih: akibat uangnya
         -- sudah ditentukan jenjang saat pembatalan (refund penuh, hak sesi,
         -- atau hangus), dan tidak satu pun di antaranya berbentuk klien
         -- menekan "saya sudah bayar" setelahnya.
         --
         -- `tidak_hadir` SENGAJA tetap di luar daftar ini: apakah sesi yang
         -- kliennya tidak hadir tetap ditagih adalah keputusan C3 yang belum
         -- diambil, dan mengubahnya diam-diam di sini akan mendahului
         -- keputusan itu dengan cara yang tidak terlihat siapa pun. Sisi
         -- TypeScript memegang pilihan yang sama (`SESI_TIDAK_TERJADI`).
         and s.status not in ('dibatalkan_padma', 'dibatalkan_klien')
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
