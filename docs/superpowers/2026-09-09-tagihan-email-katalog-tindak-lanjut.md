# Tagihan bernominal, email tagihan, & katalog pesan layanan — Tindak Lanjut

**Tanggal:** 9 September 2026
**Spec:** `docs/superpowers/specs/2026-09-09-padma-tagihan-email-katalog-design.md`
**Rencana:** `docs/superpowers/plans/2026-09-09-padma-tagihan-email-katalog.md`
**Commit:** `d7b9216` … `d21818a` (11 commit, 7 tugas)

Dikerjakan dalam **mode nol uji baru** atas keputusan pemilik repo: pembuktian dilakukan
manual demi kecepatan. Dokumen ini adalah bagian yang tidak boleh ikut hilang bersama
keputusan itu — ia satu-satunya catatan bahwa mode itu dipilih **sadar**, dan apa harganya.

---

## A. Angka suite saat merge

| Perintah | Hasil |
|---|---|
| `npx tsc --noEmit` | 1 galat **pra-ada** di `src/app/layout.tsx` (`LayoutProps` tidak dikenal) — sudah merah sebelum cabang ini dimulai, tidak disentuh. |
| `npm run lint` | **0 error, 11 warning** — sama persis dengan baseline. |
| `npm test` | **2598 uji, 171 berkas.** Hijau kecuali dua kelas yang keduanya BUKAN kerusakan pekerjaan ini (lihat di bawah). |
| E2E (`test:e2e:passport`, `test:e2e:funnel`, `test:e2e:bayar`, …) | **TIDAK dijalankan** — skrip E2E dan `npm run dev` diblokir di lingkungan pengerjaan. |
| `npm run build` | **TIDAK berhasil dijalankan** di worktree ini: Turbopack menolak `node_modules` yang ter-symlink keluar akar filesystem (`Symlink [project]/node_modules is invalid`). Batasan lingkungan, bukan kode. **Wajib dijalankan sekali di checkout utama sebelum merge.** |

### Dua kelas merah yang bukan kerusakan pekerjaan ini

1. **`tests/paket-tersembunyi.test.tsx`** — sudah merah di baseline sebelum cabang ini dimulai.
2. **Pencemaran basis data lokal yang DIPAKAI BERSAMA.** Menjalankan `npm test` penuh sementara
   sesi lain memakai basis data yang sama menghasilkan kegagalan yang **berpindah-pindah antar
   jalannya**: satu jalan memerahkan `admin-klien`/`admin-mitra`/`admin-rantai-mitra`, jalan
   berikutnya memerahkan `passport-bayar-ajukan`, dan seluruhnya **hijau bila berkasnya
   dijalankan sendirian**. `tests/owner-rekap-halaman.test.ts` punya sifat yang sama dan sudah
   tercatat sebelumnya.

   Selain itu, beberapa berkas uji **me-NULL-kan koordinat mitra seed**. Sesudah `npm test`
   penuh, terapkan ulang:

   ```sql
   update partners set lat = -7.966620, lon = 112.632632 where id = '33333333-3333-3333-3333-333333333301';
   update partners set lat = -7.947500, lon = 112.615000 where id = '33333333-3333-3333-3333-333333333302';
   ```

   Ini bukan kenyamanan: mitra tanpa pin adalah penyebab asli bug "total tagihan selalu kosong"
   (§1.1 spec). Membiarkannya NULL menghidupkan kembali gejala yang seluruh pekerjaan ini tutup.

---

## B. Doktrin `di_atas_20` yang BERUBAH — jangan dibaca sebagai kelalaian

Constraint `transport_rates_bukan_per_kasus check (jenjang <> 'di_atas_20')` **DICABUT** dalam
pekerjaan ini. Pembaca berikutnya yang menemukan constraint itu tidak ada lagi harus membaca
bagian ini sebelum menyimpulkan apa pun.

Doktrin **lama**: "`di_atas_20` adalah ketiadaan tarif — jaraknya terlalu beragam untuk satu
angka, jadi setiap kasus ditawar sendiri." Doktrin itu lahir dari review red-team (Ruling 6) dan
constraint-nya ditambahkan justru karena doktrin yang hanya hidup sebagai komentar tabel tidak
menghalangi apa pun.

Masalahnya: doktrin itu **membuntukan** penerbitan tagihan. Sesi >20 km tidak punya jenjang
bertarif, jadi totalnya tidak pernah bisa dihitung, jadi tagihannya tidak pernah bisa terbit —
dan kegagalannya senyap di layar admin (§1.3 spec).

Yang diambil **bukan pembalikan, melainkan pelapisan**:

- `transport_rates` kini boleh memuat baris `di_atas_20` sebagai **tarif dasar**, supaya tagihan
  >20 km selalu bisa terbit;
- `transport_khusus` **tetap hidup** sebagai penimpa per kasus milik owner, dan ia **menang**
  atas tarif dasar bila ada — itulah yang menjaga 80 km tetap bisa ditagih berbeda dari 25 km.

Doktrin **baru**, yang sudah ditulis sebagai komentar tabel di migrasinya:

> **`di_atas_20` punya tarif dasar supaya tagihan bisa terbit; owner menimpanya per kasus ketika
> jaraknya menuntut.**

Menyetel tarif dasar itu adalah **tugas owner, bukan migrasi** — lihat §C.

---

## C. Yang perlu disiapkan SEBELUM produksi

1. **`RESEND_API_KEY`** — tanpa ini tidak ada satu pun email tagihan yang keluar. Tagihan tetap
   terbit dan tetap bisa dikirim lewat WhatsApp, dan sebabnya dicatat di log server (fungsi kirim
   sengaja tidak melempar), tetapi klien tidak menerima apa pun lewat email.
2. **`EMAIL_PENGIRIM`** + **verifikasi DNS domain pengirim** di dashboard Resend. Sebelum
   domainnya terverifikasi, Resend **menolak setiap kiriman** ke alamat selain milik pemilik akun
   — artinya di produksi semua email tagihan gagal, dan gagalnya tidak terlihat oleh klien.
3. **`NEXT_PUBLIC_BASIS_URL`** — dipakai merangkai tautan di badan email. Gerbangnya
   gagal-tertutup: bila kosong (atau hanya spasi), email tidak dikirim sama sekali daripada
   mengirim tautan yang patah.
4. **Tarif `di_atas_20` ditetapkan owner lewat `/owner/transport`.** Migrasi hanya membuka
   kemungkinannya; angkanya keputusan bisnis. Selama barisnya belum ada, sesi >20 km kembali
   buntu persis seperti sebelum pekerjaan ini.
5. **Setiap mitra produksi WAJIB punya pin di peta.** Ongkos transport dihitung dari domisili
   mitra ke alamat klien; mitra tanpa `lat`/`lon` menghasilkan jenjang kosong, total kosong, dan
   tagihan yang tidak bisa terbit. Inilah penyebab asli laporan "totalnya tidak pernah ada".

---

## D. Yang TIDAK diuji — salinan §4 spec, apa adanya

Ditulis di sini supaya tidak diklaim sebaliknya kelak:

1. **Tarif menurut tanggal.** Menaikkan tarif hari ini tidak boleh menggeser tagihan yang sudah
   terbit. Ini hanya terlihat dengan dua baris tarif ber-`berlaku_sejak` berbeda dan satu tagihan
   bertanggal lama — keadaan yang tidak akan tercipta sendiri saat mengklik layar.
2. **Kegagalan kirim email yang tertelan.** Fungsi kirim sengaja tidak melempar. Menguji manual
   berarti sengaja merusak `RESEND_API_KEY` dan membaca log — langkah yang tidak akan dilakukan
   siapa pun secara rutin.
3. **Kebocoran nominal ke permukaan admin yang salah.** Yang menjaganya adalah pemindai sumber,
   dan mode ini tidak menambah pemindai untuk berkas baru.
4. **Rincian sisi klien vs sisi admin berselisih.** C2 mengunci kesamaan label klien & admin lewat
   uji parity; rincian nominal yang baru tidak punya pasangan seperti itu.

---

## E. Daftar periksa manual — WAJIB dijalankan sekali

Tanpa uji baru, inilah satu-satunya yang membuktikan pekerjaan ini benar.

1. **Tagihan bernominal.** Satu permintaan dengan mitra ber-pin, jarak ≤20 km: terbitkan tagihan
   → total muncul dengan rincian layanan + transport, di panel admin **dan** di kartu klien
   `/passport/bayar`.
2. **Jalur >20 km.** Setel tarif dasar `di_atas_20` di `/owner/transport`, lalu terbitkan tagihan
   untuk sesi berjarak jauh. Harapan: **terbit**, bukan tertahan tanpa sebab.
3. **Penimpa per kasus menang.** Isi `transport_khusus` untuk sesi yang sama; totalnya berubah
   mengikuti penimpa, bukan tarif dasar.
4. **Gerbang penerbitan.** Sesi tanpa jenjang (mitra tanpa pin) → tombol terbitkan tagihan
   menolak dengan **sebab yang terbaca**, bukan diam.
5. **Email.** Terbitkan satu tagihan dengan `RESEND_API_KEY` terisi; periksa kotak masuk klien,
   lalu periksa status kirim & tombol kirim ulang di panel admin.
6. **Katalog pesan layanan (Task 7).** Masuk sebagai klien dengan skrining hijau, buka
   `/passport/ajukan`:
   - harga tampil per varian, dikelompokkan per fase dalam urutan yang sama dengan landing;
   - varian baku tampil **"Standar"**;
   - blok ringkasan berkata **"Perkiraan"** dengan tanda **`+`**, tidak pernah "Total";
   - **BUTIR YANG PALING PENTING:** pilih varian dari **layanan KEDUA**, lalu kirim. Periksa di
     `/admin/sesi` bahwa layanan **dan** varian yang tersimpan keduanya benar. Ini pembuktian
     bahwa `fd.set("layanan", …)` di handler benar-benar menggantikan
     `<select name="layanan">` yang dihapus — tanpa baris itu setiap pengajuan ditolak, dan
     dengan satu penyetel yang lupa menggeser layanan, yang lahir adalah pasangan
     `(service_id, variant_id)` yang ditolak FK gabungan.
7. **Skrip E2E.** `npm run test:e2e:passport`, `test:e2e:funnel`, dan `test:e2e:bayar` belum
   pernah dijalankan terhadap katalog. Ketiganya tidak pernah memilih layanan secara eksplisit —
   mereka menyandarkan diri pada pilihan awal formulir, yang di katalog tetap ada (varian pertama
   dari layanan pertama yang punya varian). Secara pembacaan kode ketiganya aman, tetapi itu
   **pembacaan, bukan bukti**: jalankan sekali di lingkungan yang mengizinkannya.
