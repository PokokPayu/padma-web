# PADMA — Harga Klien Tampil di Master Layanan

**Tanggal:** 9 September 2026
**Sumber keputusan:** permintaan pemilik repo 9 September 2026, beserta tiga keputusan yang diambil
dalam percakapan yang sama (K2, K4, K5).

**Mode pengerjaan:** nol uji baru, sama seperti dua pekerjaan sebelumnya. Uji lama yang pecah
diperbarui — dan pada pekerjaan ini justru **diperketat**, lihat K5.

---

## Masalah

Admin tidak bisa menjawab pertanyaan harga dari klien tanpa meninggalkan panelnya. Halaman
`/admin/layanan` adalah katalog yang dibaca beranda dan wizard pengajuan, tetapi ia sengaja tidak
menampilkan satu pun angka: `service_rates` dan `variant_rates` tertutup policy `hanya owner`, dan
halamannya menuliskan itu sebagai kalimat — *"Tidak ada satu pun angka harga di sini — tarif adalah
wilayah Owner."*

Batasannya nyata, bukan kosmetik: harga klien **dan honor mitra hidup di kolom yang bersebelahan
pada tabel yang sama** (`variant_rates.harga_klien`, `variant_rates.honor_mitra`). Melonggarkan
policy tabelnya akan membuka keduanya sekaligus.

---

## Keputusan

### K1 — Batas kolomnya adalah SEBUAH VIEW, bukan policy yang dilonggarkan

Policy `variant_rates: hanya owner` **tidak disentuh**. Yang dibuat adalah view yang tidak pernah
menyebut `honor_mitra`:

```sql
create view public.varian_harga_staf with (security_invoker = off) as
  select distinct on (vr.variant_id)
         vr.variant_id, vr.harga_klien, vr.harga_coret, vr.berlaku_sejak
    from public.variant_rates vr
   where vr.berlaku_sejak <= (now() at time zone 'Asia/Jakarta')::date
     and public.user_role() in ('admin', 'owner')
   order by vr.variant_id, vr.berlaku_sejak desc;

grant select on public.varian_harga_staf to authenticated;
```

Pola ini sudah dipakai repo ini untuk `partner_publik`, yang migrasinya menuliskan alasannya:
*"security_invoker = off tetap dipertahankan: view inilah batas kolomnya."* `honor_mitra` tidak
disembunyikan di UI — ia **tidak pernah meninggalkan basis data**, lewat jalur mana pun yang
dilalui sisi admin.

`where public.user_role() in ('admin','owner')` membuat view kosong bagi klien — tapi ini
pertahanan LAPIS KEDUA, bukan batasnya. **Koreksi (review akhir):** klaim awal di sini — bahwa
predikat inilah yang mencegah `grant … to authenticated` "diam-diam membuka harga ke Passport" —
salah arah. Harga klien SUDAH publik sebelum pekerjaan ini: view `harga_publik`
(migration `20260906150000`) sudah men-grant `harga_klien`/`harga_coret` ke peran **anon**, dan
beranda merendernya. Batas yang sesungguhnya — dan satu-satunya — tetap seperti judul bagian ini:
DAFTAR KOLOM view (K1's judul), yang membuat `honor_mitra` tidak pernah ikut diproyeksikan.
Predikat `user_role()` di atas tidak menutup kebocoran harga (harga sudah bocor secara sengaja ke
publik); ia menutup jalur klien membaca `variant_rates` lewat view ini SAMA SEKALI — pertahanan
berlapis yang berharga (klien login sebagai `authenticated`, peran SQL yang sama dengan admin), tapi
bukan yang menjaga honor mitra. Yang menjaga honor mitra, sendirian, adalah `honor_mitra` tidak
pernah disebut di `select`-nya.

### K2 — Setiap staf admin boleh melihat SELURUH harga klien

Dikonfirmasi eksplisit oleh pemilik repo sesudah konsekuensinya disebutkan. Alasannya operasional:
admin yang ditanya klien harus bisa menjawab dari layar yang sedang ia buka.

Yang **tetap** tertutup dari admin: `honor_mitra`, margin, dan seluruh tabel uang lain
(`service_rates` tidak disentuh, `honor_marks` tidak disentuh, layar `/owner/*` tidak berubah).

### K3 — Tarif yang berlaku dipilih DI DALAM view, bukan di TypeScript

`distinct on (variant_id) … order by berlaku_sejak desc` memulangkan tepat satu baris per varian:
tarif terbaru yang tanggal berlakunya sudah lewat.

Dua alasan menolak memilihnya di TypeScript: `tarifPadaTanggal()` hidup di `src/lib/owner/rekap.ts`,
dan mengimpor modul owner ke sisi admin membalik pemisahan fisik yang justru sedang dijaga; menulis
pemilih kedua di sisi admin berarti dua salinan logika tanggal yang bisa berselisih.

Batas harinya memakai **kalender Asia/Jakarta**, bukan `current_date` — server berjalan UTC, dan
antara 17:00–24:00 UTC tanggalnya sudah besok. Tarif yang berlaku "mulai besok" tidak boleh muncul
tujuh jam lebih awal.

### K4 — TIDAK ADA keterangan apa pun di layar

Kalimat *"Tidak ada satu pun angka harga di sini — tarif adalah wilayah Owner"* **dihapus tanpa
pengganti**. Sisa blok Bantuan (nonaktif ≠ hapus, varian aktif terakhir) tetap.

Usulan awal adalah menggantinya dengan kalimat yang menyebut bahwa angka itu **harga klien**, bukan
honor mitra. Pemilik repo menolaknya sesudah alasannya disampaikan, dan itu keputusannya.

**Risiko yang diterima secara sadar:** tidak ada apa pun di layar yang menjawab "apakah angka ini
yang dibayarkan ke mitra?". Bila seorang admin menyimpulkannya salah dan menyebutkannya kepada
mitra atau klien, tidak ada satu pun titik di layar yang mengoreksinya. Dicatat di sini karena
keputusan yang dibuat sadar berhak punya jejak; bukan untuk diperdebatkan ulang.

### K5 — Pagar money firewall DIPERKETAT, bukan dilemahkan

**Koreksi (review akhir):** bukan tiga assertion di dua berkas — hanya **DUA** assertion, dan
KEDUANYA di `tests/admin-layanan-detail.test.tsx` (bukan di `tests/admin-layanan.test.ts`: halaman
daftar datar itu tidak pernah menampilkan nominal apa pun, sebelum maupun sesudah pekerjaan ini,
jadi pagar "nol nominal"-nya di sana tetap benar dan tetap hijau tanpa diubah). Yang berbunyi "nol
nominal di halaman ini" dan pasti merah sesudah pekerjaan ini hanya dua tempat di berkas detail
layanan itu — satu di describe utama, satu di describe "guarantee yang pindah dari Tugas 7".

Yang **dilarang**: menggantinya dengan assertion yang mengizinkan nominal apa pun. Itu menukar pagar
dengan ketiadaan pagar.

Yang **dikerjakan**: assertion diubah untuk menjaga hal yang sebenarnya penting —

1. **nilai `honor_mitra` dari fixture TIDAK muncul** di markup; dan
2. nilai `harga_klien` dari fixture **muncul**.

Butir 2 penting: tanpanya, view yang salah tulis dan memulangkan nol baris akan lolos sebagai
"tidak ada nominal bocor" — kegagalan senyap yang berbentuk kolom harga kosong.

**Tambahan (review akhir) — dua pagar STRUKTURAL yang juga tersentuh, tidak disebut di draf awal
bagian ini:**

3. `tests/money-firewall-struktural.test.ts` memindai `information_schema.columns` seluruh
   `BASE TABLE` **dan `VIEW`** untuk kolom bernuansa uang, dengan pengecualian yang dulu terpaku ke
   SATU nama view (`harga_publik`). View baru `varian_harga_staf` memerahkannya — diperbaiki dengan
   menambah pengecualian KEDUA yang dipersempit sama seperti yang pertama: nama view PLUS set kolom
   `{harga_klien, harga_coret}` yang persis, bukan melebarkan `TABEL_UANG` atau mengecualikan
   seluruh view.
4. `tests/admin-pengerasan.test.ts` menuntut `anon` & `authenticated` tidak memegang verba tulis
   pada VIEW mana pun di schema `public`. Migration `harga_klien_untuk_staf` awalnya men-`grant
   select ... to authenticated` TANPA `revoke all` di depannya — dan Supabase memberi hak PENUH
   (termasuk INSERT/UPDATE/DELETE/TRIGGER) atas setiap objek baru secara default, jadi tanpa revoke
   itu `authenticated` diam-diam memegang verba tulis atas view ini. Pola yang sama sudah pernah
   memerahkan pagar ini sekali sebelumnya (migration `sesi_menunggu_jenjang`); perbaikannya
   menambahkan `revoke all on public.varian_harga_staf from public, anon, authenticated;` tepat
   sebelum `grant`-nya.

### K6 — Cakupan

Hanya `variant_rates` lewat view baru, hanya halaman `/admin/layanan` (daftar) dan halaman detail
layanan. `service_rates` (tarif lama per-layanan) tidak disentuh. Tidak ada perubahan pada layar
owner, pada perhitungan honor, maupun pada `hitungTagihanPengajuan`.

---

## Lubang yang sengaja dibiarkan terbuka

1. **Nol uji baru** — tidak ada penjaga bagi klausa `user_role()` di dalam view. Bahwa view itu
   kosong bagi sesi klien hanya dibuktikan manual sekali (lihat daftar periksa di rencana).
   Kegagalan di sini berbentuk harga bocor ke Passport, dan bentuknya tidak berisik.
2. **`harga_coret` ikut ditarik** view tetapi belum tentu ditampilkan; ia harga sebelum diskon dan
   tetap harga klien, jadi tidak melanggar K1.
3. **K4** — lihat risiko yang diterima di sana.
