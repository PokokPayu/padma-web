# C1-b — Catatan Tindak Lanjut

**Dikerjakan:** 8–9 September 2026, dari rencana
`docs/superpowers/plans/2026-09-09-padma-c1b-skrining-syarat.md`
(spec `docs/superpowers/specs/2026-09-08-padma-c1-fondasi-jadwal-design.md`, keputusan J3, J4, J5,
J6, J9, J11).

**Cabang:** `c1b-skrining`, bercabang dari `main` `2ac03b8` (sesudah C1-a).

---

## Apa yang sekarang mungkin, dan sebelumnya tidak

Sebelum C1-b ada dua ujung yang menganga saling berhadapan:

- Corong skrining di landing berakhir di **WhatsApp**. Orang mengisi wizard, mendapat hijau, lalu
  diarahkan chat — tidak ada jalan ke dalam produk.
- Sebaliknya, siapa pun yang punya akun bisa **memesan tanpa pernah diskrining**. Tidak ada satu
  pun pagar yang menuntutnya.

Sekarang keduanya bersambung, dan aturan bisnisnya berlaku: **satu skrining hijau menopang tepat
satu pengajuan, lalu hangus.**

---

## Bukti, bukan klaim

| Perintah | Hasil |
|---|---|
| `npm test` | **153 berkas, 2.377 uji, 0 gagal** |
| `npm run build` | lolos, termasuk typecheck `src/` dan `tests/` |
| `npm run test:e2e:funnel` | **22/22** — corong penuh, lihat di bawah |
| `npm run test:e2e:passport` | 21/21 (dijalankan **tiga kali** berturut-turut, lihat catatan sisa-keadaan) |
| `npm run test:e2e` (access-matrix) | 22/22 |
| `npm run test:e2e:daftar` | 14/14 |
| `npm run test:e2e:admin` | 26/26 |
| `npm run test:e2e:pelengkap` | 26/26 |
| `npm run test:e2e:owner` | 10/10 |
| `npm run test:e2e:materi` | 12/12 |
| `npm run test:e2e:video` | **TIDAK DIJALANKAN** — menyentuh bucket R2 produksi klien |

**Corong penuh (`funnel` skenario 6)** membuktikan lewat peramban sungguhan: skrining hijau →
token klaim dititipkan sebagai cookie `httpOnly` → daftar → konfirmasi email dari kotak surat →
Passport menyebut nama pada skrining → fase klien terisi (J11) → `/passport/ajukan` menampilkan
formulir (bukan ajakan) → pengajuan tersimpan membawa `screening_id` dan jam → skrining **hangus**
dan formulirnya tertutup lagi.

Cookie `httpOnly` tidak bisa dilihat JavaScript mana pun, jadi peramban sungguhan memang
satu-satunya cara mengujinya.

---

## Keputusan, dan ongkosnya bila salah

**1. Kode skrining TIDAK PERNAH menjadi kunci.**
`src/lib/skrining/kode.ts` sengaja membuat kode yang mudah dibacakan lewat telepon — prefiks semenit
+ sufiks 4 karakter, sekitar sejuta kemungkinan per menit. Yang mudah dieja juga mudah ditebak.
Penyambungnya token 32 byte dari CSPRNG, hash SHA-256 yang disimpan, tokennya di cookie `httpOnly`.
**Ongkos bila salah:** seseorang menebak kode orang lain dan menyedot jawaban kesehatannya ke akun
sendiri.

**2. Token klaim tinggal di TABEL TERPISAH (`screening_claims`), bukan kolom `screenings`.**
Bukan kerapian: migration `20260828220000_undangan_penautan_klien` sudah membuktikan di Postgres
lokal bahwa `revoke select (kolom)` menuntut pencabutan SELECT tingkat tabel lebih dulu, dan begitu
itu dilakukan `select *` gagal `42501` untuk SEMUA peran — termasuk admin dan test.

**3. Umur token 2 jam.**
Bukan soal kriptografi — 32 byte acak tidak melemah seiring waktu. Ini soal **perangkat bersama**:
satu HP di ruang tunggu klinik. Tanpa batas umur, orang kedua yang mendaftar di HP itu mewarisi
skrining orang pertama lengkap dengan jawaban kesehatannya.

**4. Lapis kedua untuk bahaya yang sama: nama disebut TERBUKA.**
"Skrining atas nama **X** telah disambungkan." Umur token menjaga dari sisi waktu; tidak ada yang
menjaga dari sisi manusia — dua orang bisa memakai satu HP dalam sepuluh menit. Menyebut nama
membuat salah sambung **terlihat** oleh satu-satunya pihak yang pasti mengenalinya.

**5. Yang dioper lewat URL adalah ID skrining, bukan namanya.**
Nama adalah data pribadi, dan URL bocor ke riwayat peramban, header `Referer`, dan log proxy. Id
tidak berarti apa-apa bagi yang tidak bisa membacanya — dan hanya pemiliknya yang bisa (policy
`"screenings: klien baca miliknya"`). Id karangan memulangkan nol baris, jadi sapaannya tidak
terbit; itu kabar baik yang gagal tampil, bukan pintu yang tertutup.

**6. Klien boleh BACA skriningnya, tidak boleh MENULIS.**
`hasil`, `flags`, dan `kode` seluruhnya ditentukan server dari jawaban mentah. Bila peramban boleh
mengirimkannya, seluruh gerbang runtuh menjadi satu baris JSON: seseorang cukup menyisipkan skrining
`'hijau'` untuk dirinya sendiri lalu memesan. Skrining dari dalam Passport karena itu lewat rute
ber-service role, bukan policy INSERT.

**7. Ember pembatas terpisah berkunci `client_id`.**
Ember anonim punya langit-langit **global** 30/menit. Itu masuk akal ketika skrining peristiwa
sekali seumur corong; ia berhenti masuk akal begitu skrining wajib setiap pemesanan — 30 per menit
menjadi batas seluruh klinik, dan satu jam sibuk menghentikan pemesanan untuk semua orang karena
orang lain sedang memesan.

**8. Wizard DIPAKAI ULANG, bukan disalin.**
Halaman skrining di Passport memakai komponen yang sama dengan corong publik; yang berbeda hanya
rute penyimpan dan tujuan layar hasilnya, keduanya dioper sebagai prop. Dua salinan wizard adalah
dua kesempatan pertanyaannya berbeda — dan yang berbeda di sini adalah keputusan boleh-tidaknya
seseorang menerima layanan.

**9. `screening_id` TIDAK datang dari formulir.**
`ajukanJadwal` mencarinya sendiri: skrining hijau milik klien yang belum dipakai pengajuan mana pun,
yang **terbaru** lebih dulu. Menerimanya dari FormData berarti mempercayai peramban menyebut
skrining mana yang menopang pengajuannya.

**10. Indeks unik `booking_requests(screening_id)` TIDAK parsial.**
Pengajuan yang dibatalkan pun tetap memegang skriningnya, jadi skrining lama tidak bisa dipakai
ulang. Itu mengikuti spec J3 ("skrining yang menopang pengajuan yang dibatalkan tidak hidup
kembali"), dan alasannya nyata: kondisi kesehatan bisa berubah di antara dua percobaan memesan.

**11. Gerbang tiga lapis, bukan dua.**
Layar → server action → basis data. Lapis ketiga dipasang sejak awal, **bukan** menyusul: di C1-a
gerbang jam sempat hanya dipasang di server action, dan tinjauan menemukannya bisa dilewati satu
panggilan PostgREST. Pelajaran itu tidak diulang.

---

## Yang tidak berubah, dan itu disengaja

- **Hasil MERAH tetap berakhir di WhatsApp.** Yang dibutuhkan orang dengan hasil merah memang bicara
  dengan tim, bukan formulir pemesanan.
- **Merah boleh diulang tanpa jeda (J9).** Menahannya menghukum orang yang salah pencet, sementara
  yang berniat mengulang sampai hijau toh bisa membuka jendela penyamaran. Yang menjaga adalah
  jejak: tiap percobaan tersimpan dan muncul di inbox admin. Diberi wujud yang bisa gagal di
  `tests/skrining-merah-boleh-diulang.test.ts`, termasuk pagar sumber yang menahan penambahan jeda.
- **Nama & no. HP akun tidak pernah tertimpa skrining.** Skrining diisi anonim dan bisa ditulis
  orang lain — suami yang mengisikan untuk istrinya, atau resepsionis yang membantu.
- **Fase yang sudah terisi tidak digeser skrining berikutnya.** Fase bisa ditetapkan admin dari
  percakapan yang tidak pernah masuk wizard.

---

## Utang yang ditinggalkan

- **Belum ada layar bagi klien untuk melihat riwayat skriningnya sendiri.** Ia bisa membacanya
  (policy ada), tetapi tidak ada halaman yang menampilkannya. Belum dibutuhkan alur mana pun.
- **Skrining yang menopang pengajuan yang dibatalkan tetap hangus.** Itu keputusan spec, bukan
  kelalaian — tetapi konsekuensinya klien yang membatalkan lalu ingin memesan ulang harus skrining
  lagi. Bila kelak terasa terlalu keras, yang perlu diubah adalah spec, bukan indeksnya.
- **`/passport/skrining` tidak punya jalan masuk dari menu Passport** — ia dicapai lewat ajakan di
  `/passport/ajukan`. Cukup untuk sekarang; menu tersendiri bisa menunggu sampai ada alasan kedua
  mengunjunginya.

---

## Dua hal yang ditemukan pagar, bukan oleh saya

**1. `&amp;` di JSX vs `&` di skrip E2E.** Saya menulis `Buat akun &amp; pesan layanan` di komponen,
sementara skrip E2E mencari `"Buat akun & pesan layanan"`. **E2E-nya tetap hijau** — Playwright
menormalkan entitas HTML. Yang melihat selisihnya adalah `tests/e2e-selektor.test.ts`, pagar sumber
yang dibuat sesi lain sehari sebelumnya. Contoh bagus kenapa pagar sumber tetap perlu meski uji
perilaku hijau: keduanya melihat hal yang berbeda.

**2. Sisa keadaan antar-run di `passport.e2e.ts`.** Skenario "ajukan jadwal" mulai gagal
BERSELANG-SELING. Sebabnya bukan kode produk: pembersihan skrip menyaring pengajuan per TANGGAL,
dan itu cukup sebelum C1-b — tetapi sejak J3 sebuah skrining hangus begitu dipakai pengajuan mana
pun, sehingga pengajuan sisa dari run lain (atau dari suite vitest) memegang skrining hijau klien
uji dan menutup formulirnya. Pembersihannya kini per KLIEN, dan skripnya dijalankan tiga kali
berturut-turut untuk membuktikan gejalanya hilang.

Keduanya jenis yang sama: **kegagalan yang tidak muncul di jalur yang sedang diuji.** Itu sebabnya
E2E dijalankan berulang, bukan sekali.
