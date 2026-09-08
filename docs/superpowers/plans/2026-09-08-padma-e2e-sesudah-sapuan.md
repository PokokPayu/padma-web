# E2E Sesudah Sapuan Panel — Rencana 3A

> **Untuk pekerja agentik:** SUB-SKILL WAJIB: pakai superpowers:subagent-driven-development
> (disarankan) atau superpowers:executing-plans untuk mengerjakan rencana ini tugas demi tugas.
> Langkah memakai sintaks kotak centang (`- [ ]`).

**Tujuan:** Mengembalikan keempat skrip E2E yang patah akibat sapuan panel rencana 2 menjadi hijau,
dan memasang satu pagar murah supaya kelas kepatahan yang sama tertangkap oleh `npm test` — bukan
oleh orang yang kebetulan menjalankan E2E berbulan-bulan kemudian.

**Arsitektur:** Skrip E2E di repo ini bukan Playwright test runner melainkan skrip `tsx` biasa yang
memanggil `chromium.launch()` sendiri dan melaporkan lewat `catat(nama, lolos, bukti)`. Ia berhenti
pada kegagalan pertama karena `waitFor` melempar. Karena itu tiap tugas di bawah berbentuk sama:
perbaiki titik patah yang diketahui, **jalankan lagi**, dan tangani apa pun yang muncul di
belakangnya — bukan berpura-pura daftar kepatahannya sudah lengkap sejak awal.

**Tumpukan:** Playwright (chromium) dijalankan lewat `tsx` · Supabase lokal · Next.js 16 di
`localhost:3000` (butuh `npm run start` atau `npm run dev` yang hidup).

**Spec:** `docs/superpowers/specs/2026-09-07-padma-panel-list-form-design.md`
**Runbook rencana 2 (utang & alasan):** `docs/superpowers/2026-09-08-panel-sapuan-tindak-lanjut.md`

---

## Global Constraints

1. **JANGAN PERNAH menjalankan `npm run test:e2e:video` atau `npm run test:e2e:semua`.** Keduanya
   mengunggah lalu menghapus objek di bucket Cloudflare R2 **produksi** milik klien. `test:e2e:semua`
   memanggil yang video. Ketujuh skrip lain aman dijalankan satu per satu.
2. **Skrip E2E butuh server hidup di `localhost:3000`.** `BASE = process.env.E2E_BASE_URL ??
   "http://localhost:3000"`. Jalankan `npm run build` lalu `npm run start` di terminal terpisah,
   atau `npm run dev`. Tanpa server, setiap skrip gagal dengan `ERR_CONNECTION_REFUSED` yang tidak
   ada hubungannya dengan kode.
3. **Basis data Supabase lokal dipakai bersama sesi kerja lain.** Bila kegagalan berpindah-pindah
   berkas antar run, curigai gangguan lebih dulu: `ps -Ao args | grep vitest` untuk melihat apakah
   sesi lain sedang menjalankan uji. Tunggu selesai, lalu ulangi.
4. **`docker restart supabase_auth_web` bila login menggantung** atau muncul `Processing this
   request timed out`. Gejalanya BUKAN galat auth melainkan seluruh run melambat berlipat.
   **JANGAN** `npm run db:recover` maupun `npx supabase db reset` — keduanya rusak di mesin ini.
5. **Tiap skrip membersihkan fixture-nya sendiri di blok `finally`.** Fixture yang tertinggal
   memerahkan berkas uji vitest yang tidak ada hubungannya — sudah terjadi di rencana sebelumnya.
6. **`npm run lint` wajib 0 error** sebelum tiap commit, bukan hanya `tsc`. Enam warning tersisa di
   berkas pra-ada (`src/app/masuk/form-masuk.tsx`, `src/app/passport/materi/[id]/reader-pdf.tsx`,
   `tests/e2e/passport.e2e.ts`, `tests/grant-anon.test.ts`, `tests/materi-video-r2.test.ts`,
   `tests/transport-geocode.test.ts`) — bukan urusan rencana ini.
7. **Bahasa Indonesia** untuk komentar, nama pemeriksaan, dan pesan commit.

---

## Keadaan terukur, bukan diperkirakan

Spec rencana 2 memperkirakan "delapan skrip E2E akan merah". Diukur pada `21c7f0e` dengan
menjalankan ketujuh skrip yang aman satu per satu, kenyataannya:

| Skrip | Hasil | Berhenti di | Sebab |
|---|---|---|---|
| `access-matrix.e2e.ts` | **hijau** | — | — |
| `funnel-skrining.e2e.ts` | **hijau** | — | — |
| `passport.e2e.ts` | **hijau** | — | — |
| `owner.e2e.ts` | **hijau** | — | panel owner belum disapu |
| `admin-operasional.e2e.ts` | merah | `:354`, sesudah 13 lolos | menunggu tombol `+ Jadwalkan sesi` |
| `admin-pelengkap.e2e.ts` | merah | `:690`, sesudah 20 lolos | `Nonaktifkan` di dalam `<li>` daftar materi |
| `materi-pdf.e2e.ts` | merah | `:264`, sebelum satu pun lolos | menunggu tombol `Materi baru` |
| `materi-video.e2e.ts` | **tak terukur** | — | menyentuh R2 produksi; terlarang dijalankan |

**Empat skrip, bukan delapan.** Dan karena tiap skrip berhenti di kegagalan PERTAMA, jumlah
kepatahan di belakangnya belum diketahui. Satu sudah pasti ada: `admin-operasional.e2e.ts:363`
menunggu teks `"Jadwal sesi tersimpan."` yang **sudah tidak ada di produk** — pesan itu hidup di
cabang tertutup `FormJadwalSesi` yang dibuang Tugas 3, dan kini hanya tersisa di skrip E2E itu
sendiri (diverifikasi: `grep -rn "Jadwal sesi tersimpan" src/ tests/` hanya menemukan satu, di
berkas E2E).

## Apa yang berubah di produk, dan karena itu di skripnya

| Dulu | Sekarang |
|---|---|
| `/admin/sesi`: tombol `+ Jadwalkan sesi` di header | tautan `+ Sesi baru` → `?ubah=baru`, formulir di panel geser |
| sukses jadwal → teks `Jadwal sesi tersimpan.` | panel menutup diri lewat `router.push(hrefTutup)`; tidak ada teks sukses |
| baris sesi: tombol `Tandai selesai` | baris punya tautan `Ubah` → panel geser berisi formulir selesai |
| `/admin/materi`: `<li>` per materi, tombol `Materi baru` | `<Tabel>` berbaris `<tr>`, tautan `+ Materi baru` → panel geser |
| `<li>` materi: tombol `Kelola isi`, `Kelola penugasan`, `Aktifkan`/`Nonaktifkan` | semuanya pindah ke `/admin/materi/[id]`, dan **tanpa gerbang** — tiap Kartu selalu tampil |
| judul materi teks biasa di `<li>` | judul menaut ke `/admin/materi/[id]` |

---

## Struktur berkas

**Diubah:** `web/tests/e2e/materi-pdf.e2e.ts`, `web/tests/e2e/admin-pelengkap.e2e.ts`,
`web/tests/e2e/admin-operasional.e2e.ts`, `web/tests/e2e/materi-video.e2e.ts`.
**Dibuat:** `web/tests/e2e-selektor.test.ts` (pagar), `docs/superpowers/2026-09-08-e2e-tindak-lanjut.md`.
**Tidak disentuh:** keempat skrip yang hijau, dan seluruh `src/` — rencana ini tidak mengubah produk.

---

## Tugas 1: `materi-pdf.e2e.ts` — alur materi lewat halaman detail

Dikerjakan pertama karena ia gagal SEBELUM satu pun pemeriksaan lolos: seluruh skripnya belum
terbukti, jadi ia yang paling banyak menyembunyikan kepatahan di belakang.

**Berkas:**
- Ubah: `web/tests/e2e/materi-pdf.e2e.ts:264`, `:286`, `:314`, `:360`

**Antarmuka:**
- Memakai: rute `/admin/materi` dan `/admin/materi/[id]` sebagaimana ada di `main`.
- Menghasilkan: pola navigasi daftar→detail yang Tugas 2 dan 4 tiru.

- [ ] **Langkah 1: Jalankan untuk melihat titik patah pertama**

Nyalakan server lebih dulu di terminal lain (`npm run build && npm run start`), lalu:

```bash
cd web
npm run test:e2e:materi > /tmp/m1.txt 2>&1; echo "EXIT=$?"; tail -20 /tmp/m1.txt
```

Diharapkan: GAGAL `TimeoutError` menunggu `getByRole('button', { name: 'Materi baru' })`.

- [ ] **Langkah 2: Ganti pembuatan materi dengan alur panel geser**

Di `materi-pdf.e2e.ts`, ganti blok pembuatan materi (sekitar `:264`):

```ts
    // "+ Materi baru" kini TAUTAN ke `?ubah=baru`, bukan tombol yang membuka
    // formulir inline: sejak sapuan rencana 2 keadaan panel hidup di URL.
    // Formulirnya langsung ada di dalam panel — gerbang keduanya (tombol
    // "+ Materi baru" di dalam panel) dibuang commit `747d330`, jadi jangan
    // menambahkan klik kedua di sini.
    await kerja.getByRole("link", { name: "+ Materi baru" }).click();
    await tungguIsi(kerja);
    await kerja.getByLabel("Judul materi").fill(JUDUL_MATERI);
    // Tipe sudah default "ebook", dan NOL checkbox layanan dicentang — materi
    // lahir sengaja tanpa satu pun layanan (bahan pemeriksaan 3, aturan M10).
    await kerja.getByRole("button", { name: "Simpan materi", exact: true }).click();
    // Sukses menutup panel lewat `router.push(hrefTutup)` — tidak ada teks
    // sukses untuk ditunggu. Yang membuktikan simpannya mendarat: panelnya
    // pergi, lalu judulnya muncul di tabel.
    await kerja.locator('[role="dialog"]').waitFor({ state: "detached", timeout: 20_000 });
    await kerja.getByText(JUDUL_MATERI).first().waitFor({ timeout: 20_000 });
```

Pastikan `tungguIsi` sudah diimpor dari `./_tunggu` di kepala berkas; bila belum, tambahkan.

- [ ] **Langkah 3: Ganti "Kelola isi" dengan navigasi ke halaman detail**

Ganti blok sekitar `:286`:

```ts
    // Isi materi kini hidup di halaman DETAIL, dan Kartu "Isi" SELALU tampil —
    // tombol "Kelola isi" tidak ada lagi (lihat dokblok `AksiMateri`). Baris
    // daftar menaut ke sana lewat judulnya.
    await kerja.getByRole("link", { name: JUDUL_MATERI }).click();
    await tungguIsi(kerja);
    await kerja
      .locator('input[type="file"][accept="application/pdf"]')
      .setInputFiles(berkasPdf);
    // Rasterisasi + unggah berjalan DI PERAMBAN dan menembak banyak permintaan
    // paralel — "networkidle" datang dan pergi berkali-kali sebelum baris
    // `material_pages` tercatat. Tunggu TEKS HASILNYA, bukan jaringan.
    // `.first()` MENGIKAT: "3 halaman tersimpan." muncul DUA KALI di halaman
    // yang sama — pesan sukses `<PengunggahPdf/>` (`role="status"`) dan
    // ringkasan `<IsiEbook/>` yang membaca `jumlahHalaman` dari server.
    await kerja.getByText(/3 halaman tersimpan/).first().waitFor({ timeout: 60_000 });
```

Perhatikan: `kartuMateri` (locator `li`) tidak dipakai lagi sesudah titik ini — hapus
deklarasinya bila tidak ada pemakai lain, jangan biarkan variabel mati.

- [ ] **Langkah 4: Ganti Aktifkan/Nonaktifkan menjadi kontrol halaman detail**

Sekitar `:314`, tombolnya kini di Kartu "Data materi" halaman detail — dan karena skrip sudah
berada di halaman itu sejak Langkah 3, tidak perlu navigasi lagi:

```ts
    // `exact: true` MENGIKAT: pencocokan nama `getByRole` bawaan Playwright
    // adalah SUBSTRING tanpa peduli huruf besar/kecil, sehingga
    // { name: "Aktifkan" } ikut mencocoki "NonAKTIFKAN". Tanpa `exact`,
    // `waitFor` selesai SEKETIKA pada tombol lama dan pemeriksaan berikutnya
    // membaca basis data sebelum server action-nya mendarat.
    await kerja.getByRole("button", { name: "Aktifkan", exact: true }).click();
    await kerja
      .getByRole("button", { name: "Nonaktifkan", exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });
```

- [ ] **Langkah 5: Ganti "Kelola penugasan" dengan Kartu penugasan**

Sekitar `:360` — Kartu "Penugasan manual" juga selalu tampil di halaman detail. Perubahannya
MINIMAL: buang klik `"Kelola penugasan"` dan pembungkus `kartuMateri`, pertahankan sisanya persis
apa adanya — konstanta `ANANDA_CLIENT_ID`, pemilihan lewat `value`, dan penungguan `<li>`:

```ts
    // Kartu "Penugasan manual" SELALU tampil di halaman detail; tombol
    // "Kelola penugasan" tidak ada lagi (lihat dokblok `AksiMateri`).
    await kerja
      .getByLabel(`Tugaskan materi ${JUDUL_MATERI} ke klien`)
      .selectOption({ value: ANANDA_CLIENT_ID });
    await kerja.getByRole("button", { name: "Tugaskan", exact: true }).click();
    // `li` MENGIKAT: sebelum diklik, "Ananda Putri" sudah ada di DOM sebagai
    // <option> pilihan dropdown (tidak pernah visible, tapi tetap dalam DOM).
    // Menunggu `<li>` yang memuat namanya membedakan baris "ditugaskan"
    // sungguhan dari opsi dropdown yang kebetulan memuat teks yang sama.
    await kerja
      .locator("li")
      .filter({ hasText: NAMA_ANANDA })
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });
```

`ANANDA_CLIENT_ID` dan `NAMA_ANANDA` sudah ada di kepala berkas ini — jangan mengarang konstanta
baru, dan jangan mengganti pemilihan `value` menjadi pencocokan label.

- [ ] **Langkah 6: Jalankan sampai hijau, ulangi setiap kali muncul patahan berikutnya**

```bash
npm run test:e2e:materi > /tmp/m2.txt 2>&1; echo "EXIT=$?"; tail -25 /tmp/m2.txt
```

Skrip berhenti di kegagalan PERTAMA. Setiap kali ia berhenti di titik baru, perbaiki titik itu dan
jalankan lagi. Ulangi sampai `EXIT=0`. Catat SETIAP patahan yang Anda temukan di laporan — daftar
di rencana ini disusun dari satu run, dan tidak mengklaim lengkap.

- [ ] **Langkah 7: Commit**

```bash
git add web/tests/e2e/materi-pdf.e2e.ts
git commit -m "test(e2e): materi-pdf mengikuti alur daftar→detail sesudah sapuan"
```

---

## Tugas 2: `admin-pelengkap.e2e.ts` — nonaktifkan materi menutup isinya

**Berkas:**
- Ubah: `web/tests/e2e/admin-pelengkap.e2e.ts:690`, `:692`, `:725`, `:727`

**Antarmuka:**
- Memakai: pola navigasi daftar→detail dari Tugas 1.

- [ ] **Langkah 1: Jalankan untuk melihat titik patah**

```bash
npm run test:e2e:pelengkap > /tmp/p1.txt 2>&1; echo "EXIT=$?"; tail -20 /tmp/p1.txt
```

Diharapkan: GAGAL menunggu `locator('li').filter({ hasText: … }).getByRole('button', { name:
'Nonaktifkan', exact: true })`, sesudah 20 pemeriksaan lolos.

- [ ] **Langkah 2: Buka halaman detail materi, lalu tekan tombolnya di sana**

Ganti blok sekitar `:690`:

```ts
    await kerja.goto(`${BASE}/admin/materi`, { waitUntil: "networkidle" });
    // Aksi per materi (Aktifkan/Nonaktifkan) pindah ke halaman DETAIL sejak
    // sapuan rencana 2: baris daftar MENAUT, ia tidak lagi membawa aksi
    // (pola B, spec K1). Judulnya adalah tautannya.
    await kerja.getByRole("link", { name: JUDUL_MATERI }).click();
    await tungguIsi(kerja);

    // `exact: true` MENGIKAT — lihat komentar aslinya: tanpa itu
    // { name: "Aktifkan" } ikut mencocoki "NonAKTIFKAN" yang masih terpampang,
    // `waitFor` selesai seketika pada tombol lama, dan pemeriksaan berikutnya
    // membaca basis data sebelum server action-nya mendarat — lalu melapor
    // "2 halaman masih terbaca" seolah gating materi jebol. Kegagalan harness
    // yang menyamar sebagai temuan keamanan.
    await kerja.getByRole("button", { name: "Nonaktifkan", exact: true }).click();
    await kerja
      .getByRole("button", { name: "Aktifkan", exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });
```

- [ ] **Langkah 3: Lakukan hal yang sama untuk blok pengaktifan kembali**

Sekitar `:725` — skrip sudah berada di halaman detail, jadi cukup buang pembungkus `kartuMateri`:

```ts
    await kerja.getByRole("button", { name: "Aktifkan", exact: true }).click();
    await kerja
      .getByRole("button", { name: "Nonaktifkan", exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });
```

Pastikan `kartuMateri` benar-benar tidak dipakai lagi sebelum menghapus deklarasinya.

- [ ] **Langkah 4: Jalankan sampai hijau, ulangi bila muncul patahan berikutnya**

```bash
npm run test:e2e:pelengkap > /tmp/p2.txt 2>&1; echo "EXIT=$?"; tail -25 /tmp/p2.txt
```

- [ ] **Langkah 5: Commit**

```bash
git add web/tests/e2e/admin-pelengkap.e2e.ts
git commit -m "test(e2e): admin-pelengkap menekan aksi materi di halaman detail"
```

---

## Tugas 3: `admin-operasional.e2e.ts` — sesi lewat panel geser

**Berkas:**
- Ubah: `web/tests/e2e/admin-operasional.e2e.ts:354`, `:363`, `:380`

**Antarmuka:**
- Memakai: rute `/admin/sesi` dengan `?ubah=baru` dan `?ubah=<id>`.

- [ ] **Langkah 1: Jalankan untuk melihat titik patah**

```bash
npm run test:e2e:admin > /tmp/a1.txt 2>&1; echo "EXIT=$?"; tail -20 /tmp/a1.txt
```

Diharapkan: GAGAL menunggu `getByRole('button', { name: '+ Jadwalkan sesi' })`, sesudah 13 lolos.

- [ ] **Langkah 2: Ganti penjadwalan sesi dengan alur panel geser**

Ganti blok sekitar `:354`–`:365`:

```ts
    await kerja.goto(`${BASE}/admin/sesi`, { waitUntil: "networkidle" });
    // "+ Sesi baru" kini TAUTAN ke `?ubah=baru`: keadaan panel hidup di URL,
    // jadi tombol kembali peramban menutupnya seperti yang orang harapkan.
    await kerja.getByRole("link", { name: "+ Sesi baru" }).click();
    await tungguIsi(kerja);
    await kerja.selectOption('select[name="client_id"]', {
      label: `${NAMA_KLIEN} (${PADMA_ID})`,
    });
    await kerja.selectOption('select[name="service_id"]', { label: LAYANAN });
    await kerja.selectOption('select[name="partner_id"]', { label: MITRA });
    await kerja.locator('input[name="tanggal"]').fill(TANGGAL_SESI);
    await kerja.getByRole("button", { name: /Simpan jadwal/i }).click();
    // Teks "Jadwal sesi tersimpan." SUDAH TIDAK ADA di produk: ia hidup di
    // cabang tertutup `FormJadwalSesi` yang dibuang Tugas 3 bersama gerbang
    // buka/tutupnya. Sukses kini menutup panel lewat `router.push(hrefTutup)`,
    // jadi yang ditunggu adalah panelnya PERGI.
    await kerja.locator('[role="dialog"]').waitFor({ state: "detached", timeout: 20_000 });
```

- [ ] **Langkah 3: Ganti "Tandai selesai" dengan panel geser baris**

Ganti blok sekitar `:380`:

```ts
    await kerja.goto(`${BASE}/admin/sesi`, { waitUntil: "networkidle" });
    const barisSesi = kerja.locator("tr", { hasText: PADMA_ID }).first();
    // Formulir "tandai selesai" pindah dari dalam SEL TABEL ke panel geser —
    // itu inti keluhan yang memulai seluruh pekerjaan ini. Barisnya kini
    // membawa tautan "Ubah" menuju `?ubah=<id>`.
    await barisSesi.getByRole("link", { name: "Ubah" }).click();
    await tungguIsi(kerja);
    await kerja.locator('textarea[name="catatan"]').fill(CATATAN);
    await kerja.locator('textarea[name="rekomendasi"]').fill(REKOMENDASI);
    await kerja.getByRole("button", { name: /Simpan · sesi selesai/i }).click();
    // Panelnya TIDAK menutup diri di sini (beda dari "Simpan jadwal"):
    // `selesaikanSesi` hanya menyetel pesan. Yang hilang adalah FORMULIRNYA —
    // ia hanya dirender selama `status === "terjadwal"`, jadi begitu statusnya
    // berubah, medan catatan lenyap. Itulah tanda yang ditunggu.
    await kerja
      .locator('textarea[name="catatan"]')
      .waitFor({ state: "hidden", timeout: 20_000 });
```

- [ ] **Langkah 4: Jalankan sampai hijau, ulangi bila muncul patahan berikutnya**

```bash
npm run test:e2e:admin > /tmp/a2.txt 2>&1; echo "EXIT=$?"; tail -25 /tmp/a2.txt
```

- [ ] **Langkah 5: Commit**

```bash
git add web/tests/e2e/admin-operasional.e2e.ts
git commit -m "test(e2e): admin-operasional menjadwalkan & menyelesaikan sesi lewat panel geser"
```

---

## Tugas 4: `materi-video.e2e.ts` — diperbaiki tanpa bisa dijalankan

**Berkas:**
- Ubah: `web/tests/e2e/materi-video.e2e.ts:327`–`:329`, `:348`

**Ini satu-satunya tugas yang TIDAK BISA diverifikasi dengan menjalankannya.** Skrip ini mengunggah
lalu menghapus objek di bucket Cloudflare R2 **produksi** milik klien. Menjalankannya untuk
memeriksa pekerjaan sendiri bukan tukar yang setara.

Yang bisa dilakukan: menyamakan alurnya dengan `materi-pdf.e2e.ts` yang SUDAH terbukti hijau di
Tugas 1, lalu menyatakan terang-terangan bahwa hasilnya belum teruji-eksekusi. Jangan menulis
laporan yang berbunyi seolah sudah.

- [ ] **Langkah 1: Baca hasil Tugas 1 sebagai acuan**

Buka `web/tests/e2e/materi-pdf.e2e.ts` sesudah Tugas 1 selesai. Kedua skrip membuat materi lewat
panel, lalu mengunggah isinya di halaman detail; bedanya hanya tipe materi dan jenis berkasnya.

- [ ] **Langkah 2: Ganti pembuatan materi video**

Sekitar `:327`–`:329`, ganti komentar lama yang menyebut "Formulir Materi baru mulai TERTUTUP"
(mekanisme itu sudah tidak ada) beserta kliknya:

```ts
    // "+ Materi baru" kini TAUTAN ke `?ubah=baru`; formulirnya langsung ada di
    // dalam panel. Komentar lama di sini menyebut formulir yang "mulai
    // TERTUTUP" — gerbang itu dibuang Tugas 3 (untuk sesi) dan commit
    // `747d330` (untuk materi & layanan).
    await kerja.getByRole("link", { name: "+ Materi baru" }).click();
    await tungguIsi(kerja);
    await kerja.locator('input[name="judul"]').fill(JUDUL);
    await kerja.locator('select[name="tipe"]').selectOption("video");
    // Nol checkbox layanan dicentang dengan sengaja: materi lahir "Tanpa
    // layanan", terbuka hanya lewat penugasan manual di bawah.
    await kerja.getByRole("button", { name: "Simpan materi", exact: true }).click();
    await kerja.locator('[role="dialog"]').waitFor({ state: "detached", timeout: 20_000 });
    await kerja.getByText(JUDUL).first().waitFor({ timeout: 20_000 });
```

- [ ] **Langkah 3: Ganti "Kelola isi" dengan navigasi ke halaman detail**

Sekitar `:348`:

```ts
    // Isi materi hidup di halaman DETAIL, dan Kartu "Isi" SELALU tampil.
    await kerja.getByRole("link", { name: JUDUL }).click();
    await tungguIsi(kerja);
    await kerja
      .locator('input[type="file"][accept="video/mp4,video/webm"]')
      .setInputFiles({ name: "uji.mp4", mimeType: "video/mp4", buffer: buatMp4Uji() });
    // Unggahan (presigned PUT ke R2 dari peramban) + pencatatan baris berjalan
    // sesudah "Simpan materi", di peramban admin sungguhan — inilah rantai
    // yang dibuktikan skrip ini, bukan dipotong lewat service role.
    await kerja.getByText("Video tersimpan.").first().waitFor({ timeout: 60_000 });
```

Pastikan `kartuMateri` tidak lagi dipakai sebelum menghapus deklarasinya, dan `tungguIsi` terimpor.

- [ ] **Langkah 4: Periksa dengan membaca, bukan dengan menjalankan**

Jalankan HANYA pemeriksaan statis:

```bash
npx tsc --noEmit > /tmp/v-tsc.txt 2>&1; echo "TSC=$?"
npm run lint > /tmp/v-lint.txt 2>&1; echo "LINT=$?"; tail -3 /tmp/v-lint.txt
```

Lalu bandingkan berdampingan dengan `materi-pdf.e2e.ts` yang sudah hijau: setiap selektor yang
dipakai kedua skrip harus identik bentuknya. Selisih apa pun antara keduanya adalah kandidat
kesalahan — sebutkan di laporan, jangan diamkan.

- [ ] **Langkah 5: Commit, dengan status verifikasi yang jujur di pesannya**

```bash
git add web/tests/e2e/materi-video.e2e.ts
git commit -m "test(e2e): materi-video mengikuti alur daftar→detail (BELUM teruji-eksekusi)

Skrip ini menyentuh bucket R2 produksi klien, jadi ia tidak dijalankan.
Alurnya disamakan dengan materi-pdf.e2e.ts yang sudah terbukti hijau.
Verifikasi sungguhannya menunggu keputusan pemilik repo."
```

---

## Tugas 5: Pagar selektor + jalankan seluruhnya + runbook

**Berkas:**
- Buat: `web/tests/e2e-selektor.test.ts`
- Buat: `docs/superpowers/2026-09-08-e2e-tindak-lanjut.md`

**Kenapa pagar ini ada.** Sapuan panel mengganti tiga label tombol menjadi tautan, dan `npm test`
tetap hijau berbulan-bulan seandainya tidak ada yang menjalankan E2E. Skrip E2E tidak ikut
`npm test` (butuh server), jadi tidak ada apa pun yang memberi tahu bahwa selektornya sudah basi.
Pagar di bawah menutup kelas itu dengan biaya nyaris nol: ia memeriksa bahwa setiap LABEL yang
dicari skrip E2E masih ada di suatu tempat di `src/app/`.

**Batasnya, DIUKUR bukan diperkirakan.** Regexnya dijalankan atas keadaan `main` sebelum rencana
ini: 38 label diperiksa, 4 tidak ditemukan di `src/app`. Dari ketiga skrip yang benar-benar patah,
pagar ini hanya menangkap SATU:

| Kepatahan | Tertangkap? | Sebab |
|---|---|---|
| `admin-operasional`: `+ Jadwalkan sesi`, `Tandai selesai` | **ya** | labelnya lenyap sama sekali dari `src/` |
| `materi-pdf`: `Materi baru` | **tidak** | `src/` memuat `+ Materi baru`; pencocokan substring lolos |
| `admin-pelengkap`: `Nonaktifkan` | **tidak** | labelnya utuh, ia hanya PINDAH halaman |

Jadi ini pagar EJAAN yang menangkap label yang **lenyap**, bukan yang berganti bentuk atau berpindah
tempat. Satu dari tiga. Tetap lebih baik daripada nol — kelas "label dihapus" nyata dan murah
dijaga — tetapi jangan menulis di runbook seolah ia menutup seluruh kelasnya. Pagar alur yang
sesungguhnya menuntut E2E berjalan di CI dengan server dan basis datanya sendiri.

**Dua positif-palsu sudah diketahui** dan harus masuk `DIKECUALIKAN` beserta alasannya, bukan
"diperbaiki": `funnel-skrining.e2e.ts` mencari tombol `"Kehamilan"` dan `"Menopause"` — keduanya
nama FASE yang datang dari kolom `phases.nama` di basis data, bukan literal di sumber. Label yang
memang tidak berasal dari `src/app/` adalah persis kasus yang daftar pengecualian itu ada untuknya.

- [ ] **Langkah 1: Tulis uji yang gagal**

Buat `web/tests/e2e-selektor.test.ts`:

```ts
/**
 * Pagar EJAAN selektor E2E.
 *
 * Skrip E2E tidak ikut `npm test` — ia butuh server hidup. Akibatnya sapuan
 * panel rencana 2 mengganti tiga label tombol menjadi tautan, dan seluruh suite
 * tetap hijau sampai seseorang kebetulan menjalankan E2E berminggu-minggu
 * kemudian. Pagar ini memeriksa satu hal murah: setiap LABEL yang dicari skrip
 * E2E masih benar-benar ada di `src/app/`.
 *
 * YANG TIDAK DIJAGA, dan ini penting supaya tidak ada yang mengira lebih:
 * pagar ini buta terhadap tombol yang PINDAH HALAMAN sambil mempertahankan
 * namanya. "Nonaktifkan" tetap ada di `src/` sesudah ia pindah dari daftar ke
 * halaman detail, jadi kepatahan `admin-pelengkap.e2e.ts` TIDAK akan tertangkap
 * di sini. Ini pagar ejaan, bukan pagar alur.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

function berkasSumber(rel: string): string[] {
  const hasil: string[] = [];
  for (const entri of readdirSync(path.join(AKAR, rel), { withFileTypes: true })) {
    const anak = `${rel}/${entri.name}`;
    if (entri.isDirectory()) hasil.push(...berkasSumber(anak));
    else if (/\.tsx?$/.test(entri.name)) hasil.push(anak);
  }
  return hasil;
}

/** Label literal yang dicari `getByRole("button"|"link", { name: "…" })`. */
export function labelDicari(isi: string): string[] {
  const pola = /getByRole\(\s*"(?:button|link)"\s*,\s*\{\s*name:\s*"([^"]+)"/g;
  return [...new Set([...isi.matchAll(pola)].map((m) => m[1]))];
}

const SUMBER_APP = berkasSumber("src/app")
  .map((f) => baca(f))
  .join("\n");

const SKRIP_E2E = readdirSync(path.join(AKAR, "tests/e2e"))
  .filter((n) => n.endsWith(".e2e.ts"))
  .map((n) => `tests/e2e/${n}`);

/**
 * Label yang SENGAJA tidak dicari di `src/app/`, beserta alasannya. Daftar ini
 * pendek dengan sengaja: setiap tambahan adalah lubang pada pagar ini.
 */
const DIKECUALIKAN = new Map<string, string>([
  // Contoh bentuk: ["Masuk", "milik halaman auth pihak ketiga"],
]);

describe("pagar ejaan selektor E2E", () => {
  it("ada skrip E2E yang dipindai (anti-hampa)", () => {
    expect(SKRIP_E2E.length).toBeGreaterThan(0);
  });

  it("regex label benar-benar memungut sesuatu (anti-hampa)", () => {
    const semua = SKRIP_E2E.flatMap((f) => labelDicari(baca(f)));
    expect(semua.length).toBeGreaterThan(0);
  });

  it("setiap label yang dicari skrip E2E masih ada di src/app", () => {
    const hilang: string[] = [];
    for (const berkas of SKRIP_E2E) {
      for (const label of labelDicari(baca(berkas))) {
        if (DIKECUALIKAN.has(label)) continue;
        if (!SUMBER_APP.includes(label)) hilang.push(`${berkas}: "${label}"`);
      }
    }
    expect(hilang, "label E2E tidak ditemukan di src/app").toEqual([]);
  });
});

describe("labelDicari — bergigi", () => {
  it("memungut label dari button maupun link", () => {
    const isi = `getByRole("button", { name: "Simpan materi", exact: true })
                 getByRole("link", { name: "+ Sesi baru" })`;
    expect(labelDicari(isi).sort()).toEqual(["+ Sesi baru", "Simpan materi"]);
  });

  it("mengabaikan nama berpola regex — ia tidak bisa dicocokkan sebagai teks", () => {
    expect(labelDicari(`getByRole("button", { name: /Simpan jadwal/i })`)).toEqual([]);
  });
});
```

- [ ] **Langkah 2: Jalankan, pastikan MERAH lalu HIJAU**

```bash
npx vitest run tests/e2e-selektor.test.ts > /tmp/g1.txt 2>&1; echo "EXIT=$?"; tail -20 /tmp/g1.txt
```

Bila merah karena ada label yang benar-benar hilang, itu temuan — perbaiki skrip E2E-nya, jangan
menambahkan label itu ke `DIKECUALIKAN`. Pengecualian hanya untuk label yang memang bukan milik
`src/app/`.

Lalu buktikan pagarnya bergigi: ganti sementara satu label di sebuah skrip E2E menjadi
`"Tombol Yang Tidak Ada"`, jalankan lagi, pastikan MERAH, kembalikan, pastikan HIJAU. Kedua
keluarannya masuk laporan.

- [ ] **Langkah 3: Jalankan ketujuh skrip E2E yang aman, satu per satu**

Dengan server hidup:

```bash
for s in e2e e2e:funnel e2e:passport e2e:admin e2e:pelengkap e2e:owner e2e:materi; do
  npm run "test:$s" > "/tmp/$(echo $s | tr ':' '-').txt" 2>&1
  printf "%-16s exit=%s\n" "$s" "$?"
done
```

Ketujuhnya harus `exit=0`. **JANGAN** tambahkan `e2e:video` ke daftar ini.

- [ ] **Langkah 4: Jalankan suite unit penuh**

```bash
npm test > /tmp/unit.txt 2>&1; echo "EXIT=$?"; grep -E "Test Files|^ *Tests " /tmp/unit.txt
npm run lint > /tmp/lint.txt 2>&1; echo "LINT=$?"; tail -3 /tmp/lint.txt
npx tsc --noEmit; echo "TSC=$?"
```

Bila kegagalan muncul di berkas yang tidak Anda sentuh, periksa lebih dulu apakah sesi lain sedang
menjalankan uji (`ps -Ao args | grep vitest`) sebelum menyimpulkan itu cacat.

- [ ] **Langkah 5: Tulis runbook**

Buat `docs/superpowers/2026-09-08-e2e-tindak-lanjut.md` berbahasa Indonesia, memuat:

- **Hasil terukur**: keempat skrip mana yang diperbaiki, dan berapa patahan yang ternyata
  bersembunyi di belakang patahan pertama masing-masing — angka sungguhan dari pengerjaan, bukan
  dari rencana ini.
- **`materi-video.e2e.ts` BELUM teruji-eksekusi**, dengan alasannya (bucket R2 produksi klien) dan
  apa yang harus dilakukan pemilik repo untuk memverifikasinya.
- **Batas pagar selektor**: ia pagar EJAAN, bukan alur; ia tidak akan menangkap tombol yang pindah
  halaman sambil mempertahankan namanya, dan karena itu tidak akan menangkap ulang kepatahan
  `admin-pelengkap`. Tulis ini terang-terangan.
- **Cara menjalankan E2E**: butuh server di `localhost:3000`; `test:e2e:video` dan `test:e2e:semua`
  TERLARANG; sisanya dijalankan satu per satu.
- **Siapa pun yang menambah rute `/admin` baru** wajib menambahkannya ke `RUTE_ADMIN` di
  `tests/e2e/owner.e2e.ts` dan menjalankan `npm run test:e2e:owner` — pagar money firewall yang
  buta-rute, dan rute yang duduk di luarnya tidak dijaga apa pun.

- [ ] **Langkah 6: Commit**

```bash
git add web/tests/e2e-selektor.test.ts docs/superpowers/2026-09-08-e2e-tindak-lanjut.md
git commit -m "test(e2e): pagar ejaan selektor + runbook E2E sesudah sapuan"
```

---

## Tinjauan mandiri penulis rencana

**Cakupan.** Keempat skrip yang terukur merah punya tugasnya sendiri; keempat yang hijau tidak
disentuh. Konsekuensi spec ("delapan skrip akan merah") diperiksa dengan menjalankannya dan
ternyata empat — rencana ini mengikuti pengukuran, bukan perkiraan spec, dan itu dinyatakan di
bagian "Keadaan terukur".

**Yang saya tahu belum lengkap, dan sengaja tidak saya sembunyikan di balik daftar langkah:**

- **Daftar patahan per skrip hampir pasti belum lengkap.** Skrip berhenti di kegagalan pertama,
  jadi apa pun di belakangnya tak terlihat sampai yang pertama diperbaiki. Satu sudah terbukti ada
  (`"Jadwal sesi tersimpan."` di `admin-operasional`). Karena itu setiap tugas berakhir dengan
  "jalankan lagi, tangani yang muncul, catat semuanya" — bukan dengan daftar tertutup.
- **Tugas 4 tidak bisa diverifikasi sama sekali** oleh siapa pun yang mengerjakannya. Itu bukan
  kelemahan rencana yang bisa saya tutup; itu batas yang lahir dari keputusan sadar untuk tidak
  menyentuh penyimpanan produksi klien demi kenyamanan pengujian.
- **Pagar Tugas 5 menangkap dua dari tiga kepatahan malam itu**, dan saya menulis batas itu ke
  dalam kode pagarnya sendiri supaya pembaca berikutnya tidak mengiranya lebih kuat. Pagar alur
  yang sesungguhnya menuntut menjalankan E2E di CI dengan server dan basis data sendiri — itu
  pekerjaan rencana tersendiri, dan bukan pekerjaan malam ini.
