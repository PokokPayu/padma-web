-- ============================================================================
-- SWASUNTING PROFIL KLIEN — satu pintu sempit, bukan policy UPDATE baru
-- ============================================================================
-- Halaman /passport/profil selama ini read-only, dan itu keputusan keamanan
-- yang ditulis panjang di kepala berkasnya. Kebutuhan yang mengubahnya nyata:
-- alamat rumah adalah bahan baku tarif transport DAN penunjuk jalan bagi mitra,
-- tetapi hari ini hanya admin yang bisa mengisinya. Akibatnya klien mengetik
-- ulang alamat yang sama pada SETIAP pengajuan jadwal — lihat pesan bantuan di
-- `passport/ajukan/form.tsx` yang berbunyi "belum ada alamat tersimpan".
--
-- ===== KENAPA RPC, BUKAN POLICY UPDATE UNTUK KLIEN =====
-- Alasannya sama persis dengan yang sudah ditulis dua kali sebelumnya
-- (`kunci_kolom_penautan_klien`, `kunci_kolom_identitas`): RLS Postgres tidak
-- mengenal pembatasan per-KOLOM untuk UPDATE. Satu policy
--
--   create policy "clients: swasunting" on clients for update
--     using (user_id = auth.uid());
--
-- akan menyerahkan SELURUH baris kepada klien, termasuk tiga kolom yang bukan
-- data operasional melainkan keputusan identitas:
--   - `email`   — dasar penautan akun (`linkClientByInvite` menuntut email
--                 cocok persis); klien yang bisa menulisnya bisa mengarahkan
--                 undangan orang lain ke dirinya;
--   - `phase_id`— penentu materi mana yang terbuka baginya (gating materi);
--   - `padma_id`— identitas yang dicetak di dokumen dan dicari admin.
--
-- Varian hak kolom (`revoke update ... grant update (nama, no_hp, alamat)`)
-- ditolak dengan alasan yang sudah tiga kali dipakai di repo ini: hak UPDATE
-- tingkat kolom baru berlaku setelah hak tingkat TABEL dicabut, dan begitu itu
-- dilakukan setiap kolom operasional harus di-grant satu per satu — daftar yang
-- basi setiap kali skema bertambah, dan basinya GAGAL-TERBUKA.
--
-- Fungsi ini menutup persoalan tanpa menyentuh policy mana pun: policy
-- `clients: milik sendiri` TETAP `for select` saja, sehingga pembuktian di
-- `tests/passport-profil.test.ts` ("klien TIDAK bisa mengubah barisnya sendiri")
-- tetap hijau apa adanya. Yang bertambah adalah SATU pintu bernama yang hanya
-- bisa dilewati dengan tiga kolom itu saja.
--
-- ===== KOORDINAT SENGAJA BUKAN PARAMETER =====
-- Fungsi yang boleh dipanggil `authenticated` juga bisa dipanggil LANGSUNG
-- lewat PostgREST dengan argumen apa pun — panel bukan penjaganya. Bila
-- `alamat_lat`/`alamat_lon` menjadi parameter, klien bisa menyetel titiknya
-- sendiri; koordinat itu menentukan jenjang jarak, dan jenjang menentukan tarif
-- transport yang ditagihkan serta honor mitra. Artinya klien akan memegang
-- kendali atas tagihannya sendiri.
--
-- Karena itu satu-satunya hal yang boleh dilakukan fungsi ini terhadap
-- koordinat adalah MENGOSONGKANNYA saat teks alamat berubah. Koordinat baru
-- diisi menyusul oleh server (service role, sesudah geocoding) — jalur yang
-- tidak bisa disentuh klien. Kosong berarti apa yang sudah berarti sejak
-- migration `alamat_dan_koordinat`: jenjangnya tidak disarankan, admin memilih
-- sendiri.
--
-- Perbandingan alamat memakai `is distinct from` pada nilai yang SUDAH
-- di-`btrim`: menambah spasi di ujung bukan pindah rumah, dan menghanguskan
-- koordinat yang sudah dibenarkan manusia karena satu spasi adalah kerugian
-- tanpa imbalan.
--
-- Cap waktu ditulis MANUAL dan lebih besar dari berkas terakhir
-- (20260907150000): `supabase migration new` memakai jam dinding dan pernah
-- menyelipkan migration ke tengah riwayat sehingga `db reset` gagal.

create or replace function public.perbarui_profil_klien(
  p_nama   text,
  p_no_hp  text,
  p_alamat text
)
returns void
language plpgsql
-- `security definer` DIPERLUKAN: peran `authenticated` sengaja tidak punya hak
-- UPDATE apa pun atas `clients` lewat policy, jadi badan fungsi harus berjalan
-- dengan hak pemiliknya.
security definer
-- `set search_path = public` BUKAN kosmetik, dan bukan pula sekadar konvensi
-- (17 fungsi security definer di repo ini memakainya tanpa kecuali). Tanpa
-- klausa ini pemanggil bisa menyisipkan skema miliknya sendiri di depan
-- `public`, sehingga `clients` di dalam badan fungsi menunjuk TABEL MILIK
-- PENYERANG — dan fungsi tetap mengeksekusinya dengan hak penuh pemilik.
set search_path = public
as $$
declare
  v_alamat_lama text;
  v_alamat_baru text := btrim(p_alamat);
begin
  select alamat into v_alamat_lama
  from clients
  where user_id = auth.uid();

  -- Pemanggil tanpa sesi (`auth.uid()` NULL) dan pemanggil yang punya sesi
  -- tetapi bukan klien (admin, owner) sama-sama mendarat di sini.
  --
  -- Melempar, bukan diam. `update ... where user_id = auth.uid()` yang tidak
  -- cocok satu baris pun sudah AMAN — tetapi aman secara senyap: pemanggil
  -- tidak bisa membedakan "tidak berhak" dari "tidak ada yang berubah", dan
  -- layar akan melaporkan sukses atas perubahan yang tidak pernah terjadi.
  if not found then
    raise exception 'tidak ada baris klien untuk akun ini'
      using errcode = '42501';
  end if;

  update clients set
    nama   = btrim(p_nama),
    no_hp  = btrim(p_no_hp),
    alamat = v_alamat_baru,
    -- Ditulis sebagai CASE, bukan dua UPDATE bercabang, supaya "koordinat
    -- hangus bersama alamat" terjadi dalam SATU pernyataan — tidak ada jendela
    -- waktu di mana alamat sudah baru sementara koordinatnya masih lama.
    alamat_lat = case when v_alamat_baru is distinct from v_alamat_lama
                      then null else alamat_lat end,
    alamat_lon = case when v_alamat_baru is distinct from v_alamat_lama
                      then null else alamat_lon end
  where user_id = auth.uid();
end;
$$;

comment on function public.perbarui_profil_klien(text, text, text) is
  'Satu-satunya jalur tulis KLIEN ke barisnya sendiri di clients, terbatas pada '
  'nama, no_hp, dan alamat. Koordinat bukan parameter (klien tidak boleh '
  'menentukan jenjang tarifnya sendiri) dan dikosongkan bila teks alamat '
  'berubah — pengisiannya kembali adalah jalur server ber-service-role sesudah '
  'geocoding. Email, phase_id, dan padma_id TIDAK tersentuh: ketiganya '
  'keputusan identitas, bukan data operasional.';

-- Aturan [F] migration `fail_closed_sequence_fungsi`: hak fungsi baru
-- dinyatakan EKSPLISIT dan dicabut lebih dulu. `grant` MENAMBAH alih-alih
-- menggantikan, jadi mengandalkan default privileges siapa pun berarti
-- mewarisi hak yang tidak pernah kita putuskan.
revoke all on function public.perbarui_profil_klien(text, text, text)
  from public, anon, authenticated;

-- `anon` sengaja TIDAK diberi hak: tanpa sesi tidak ada profil untuk disunting,
-- dan menolaknya di lapisan hak lebih murah daripada menolaknya di badan fungsi.
grant execute on function public.perbarui_profil_klien(text, text, text)
  to authenticated;
