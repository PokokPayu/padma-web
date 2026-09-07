# Panel Staf — Fondasi Daftar & Formulir: Runbook, Utang, dan Indeks Keputusan

**Spec:** `docs/superpowers/specs/2026-09-07-padma-panel-list-form-design.md`
**Rencana:** `docs/superpowers/plans/2026-09-07-padma-panel-fondasi.md` (rencana 1 dari 3)

Berkas ini menyimpan tiga hal yang tidak tercatat di riwayat git: apa yang harus diketahui orang
yang meneruskan pekerjaan ini, utang yang sengaja ditunda beserta alasannya, dan indeks keputusan
yang dirujuk komentar-komentar di kode sebagai "Ruling N".

---

## Apa yang berubah, dalam satu tabel

| Modul | Sebelum | Sesudah |
|---|---|---|
| **Mitra** | Formulir "ubah" muncul di dalam sel tabel; formulir "baru" kartu putus-putus di header | Panel geser dari kanan (`?ubah=<id>`, `?ubah=baru`); bilah cari + saring + paginasi |
| **Klien** | Sama, plus formulir "baru" di header | Baris menaut ke halaman detail; rute baru `/admin/klien/baru`; bilah cari (nama DAN PADMA ID) + saring + paginasi |

Primitif baru di `src/app/_shell/panel/`: `daftar.ts` (fungsi murni parameter URL), `bilah-daftar.tsx`,
`paginasi.tsx`, `panel-geser.tsx`, `bantuan.tsx`.

**Empat modul berikutnya (Sesi, Varian, Layanan, Materi, Bayar, Skrining) menyalin kedua modul ini.**
Itu sebabnya beberapa cacat kecil di sini diperbaiki lebih agresif daripada bobotnya sendiri: ia
menggandakan diri enam kali.

---

## Runbook — baca sebelum meneruskan

**1. Cari dan saring bekerja TANPA JavaScript klien.** Kotak cari adalah `<form method="get">`;
chip saringan adalah `<Link>`. Ini bukan kemurnian: suite proyek berjalan di `environment: "node"`
TANPA jsdom, jadi apa pun yang hanya hidup lewat `onChange` **tidak bisa diuji sama sekali**.
Jangan menggantinya dengan state klien tanpa lebih dulu menambahkan jsdom — dan itu melanggar
batasan "tanpa dependensi baru" yang mengikat sejak rencana panel pertama.

**2. Panel geser adalah satu-satunya komponen klien, dan isinya tetap dirender di server.**
`<PanelGeser>` menerima `children` yang sudah jadi. Jangan memindahkan pengambilan data ke dalamnya
— formulir di dalamnya akan berhenti bisa diuji.

**3. Keadaan daftar hidup di URL, termasuk baris yang sedang diubah.** `?cari=`, `?status=`,
`?hal=`, `?ubah=`. Konsekuensinya: tombol kembali browser menutup panel, dan StatTile beranda bisa
menaut langsung ke daftar yang sudah tersaring.

**4. Aturan pemilihan pola (spec K1): apakah objeknya memiliki daftar anak.** Punya → halaman
detail (Klien, Layanan, Materi). Tidak punya → panel geser (Mitra, Sesi, Varian). Jumlah medan
BUKAN kriteria — diukur, keenam formulir terlalu mirip (6 sampai 11) untuk jadi batas.

**5. Kelas Tailwind yang menunjuk token tak ada gagal SENYAP** — tanpa galat build, hanya teks tak
terbaca di layar. Sudah terjadi sekali di rencana ini. Pagar otomatisnya (`tests/panel-primitif.test.ts`)
**hanya memindai `src/app/_shell/panel/`**, TIDAK memindai `src/app/admin/` maupun `src/app/owner/`.
Token yang sah: `panel-bg`, `panel-surface`, `panel-border`, `panel-ink`, `panel-muted`,
`panel-rail`, `panel-rail-ink`, `panel-rail-aktif`.

**6. Basis data Supabase lokal dipakai bersama antar sesi kerja.** `npm run db:recover` membangun
ulang skema dari direktori migrasi **worktree pemanggil** — migrasi milik worktree lain LENYAP
tanpa galat, bukan gagal. Bila uji Anda merah dengan kegagalan yang **berpindah-pindah berkas antar
run**, curigai gangguan lebih dulu: `docker ps`, lalu bandingkan umur `supabase_db_web` dengan
`supabase_rest_web`. Basis data yang lebih muda berarti ia dibangun ulang sendirian di tengah run
Anda. Pesan galatnya (`PGRST202`, `Cannot read properties of null`) menunjuk ke mana-mana kecuali
ke sana.

**7. `npm run test:e2e:video` menyentuh bucket Cloudflare R2 SUNGGUHAN** bila kredensial ada di
`.env.local`. Tidak dijalankan di rencana ini, dan `test:e2e:semua` memanggilnya — pakai ketujuh
skrip satu per satu.

---

## Utang tindak lanjut

Diurutkan menurut nilai.

| # | Utang | Kenapa ditunda |
|---|---|---|
| 1 | **`max_rows = 1000` masih terbuka untuk query HITUNG.** `lib/admin/mitra.ts` dan `lib/admin/klien.ts` membaca seluruh `sessions` berstatus selesai — dan `klien.ts` juga seluruh `client_packages` aktif — **tanpa `.range()` maupun `.limit()`**. PostgREST memotongnya di 1000 tanpa galat. Begitu PADMA melewati 1000 sesi selesai, kolom "kinerja" mitra dan "Sesi" klien mulai **mengecil diam-diam**, dan siapa yang dirugikan ditentukan urutan baris yang tidak pernah dipesan. Untuk paket: sebagian klien menampilkan "—" padahal berpaket, dan ikut lenyap dari saringan `?paket=ada`. | Polanya **sudah ada di `main` sebelum rencana ini** (diverifikasi di `89f4dce`) — bukan regresi. Obatnya view atau RPC hitung-per-grup, berukuran rencana tersendiri. Yang sudah dikerjakan: komentar-komentar yang menjanjikan sebaliknya sudah diluruskan dan menyebut angka 1000 eksplisit. |
| 2 | **Pagar money firewall masih bisa dilewati nominal telanjang.** `not.toMatch(/Rp\s?\d/)` menuntut literal "Rp". Yang lolos: `"Sankalpa Prima · 3.500.000"` (tanpa "Rp"), `"Rp. 500.000"` (titik sesudah Rp), dan `"rp 500000"` (huruf kecil, tidak ada flag `/i`). Diusulkan reviewer: perluas ke pola angka berpemisah ribuan, mis. `/\d{1,3}(\.\d{3})+\b/`. | Arah false-positive sudah tertutup (sebelumnya "Paket Harga Hemat" memerahkannya palsu). **Tetapi ini CETAKAN bagi enam modul** — layak ditutup sebelum polanya disalin. |
| 3 | **`scripts/seed-users.ts` tidak memberi klien seed satu pun alamat**, sementara alamat `required` di `/passport/ajukan` sejak modul transport. Akibatnya `tests/e2e/passport.e2e.ts` **tidak pernah bisa hijau di basis data yang benar-benar bersih** — ia lolos selama ini hanya di atas basis data yang sudah tercemar alamat dari run manual. | Gejalanya sudah ditutup (ujinya mengisi alamatnya sendiri). Akarnya TIDAK ditutup dengan sengaja: memberi seed sebuah alamat akan membuat cabang "belum ada alamat tersimpan, isi sendiri" **berhenti pernah diuji** — dan cabang itu nyata di formulir. Butuh keputusan cabang mana yang tetap terjaga. |
| 4 | **Perluas pemindaian pagar token Tailwind** dari `src/app/_shell/panel/` ke `src/app/admin/` dan `src/app/owner/`. Juga perluas awalannya: regexnya kini hanya `text-\|bg-\|border-`; `ring-panel-*` pada keadaan fokus akan lolos. | Hari ini bersih — diverifikasi manual, nol token hantu di `src/app/admin/`, dan nol pemakaian `ring-/outline-/shadow-panel-*` di seluruh `src/`. Tetapi rencana 2 & 3 menulis kelas panel ke 15 halaman di luar jangkauan pagar. |
| 5 | **`/admin/klien/baru` dan `/admin/klien/[id]` jatuh di antara rencana.** Daftar sapuan rencana 2 berbunyi "Sesi, Varian, Layanan, Materi, Bayar, Skrining"; rencana 3 hanya owner + E2E. Kedua berkas itu masih berpalet lama (`border-dashed border-gold`, `bg-night text-gold-pale`) sementara daftar di atasnya sudah penuh token `panel-*` — satu layar, dua palet. | Seluruh halaman `/admin` lain juga masih berpalet lama; yang menonjol hanya karena tetangganya sudah disapu. |
| 6 | **`KelompokSaring.label` wajib diisi, tidak pernah dirender.** Sudah terlihat di Klien hari ini: chip "Aktif \| Belum aktivasi \| Punya paket" — yang ketiga milik kelompok lain dan tidak ada yang menandainya. Halaman Sesi di rencana 2 punya TIGA kelompok. | Menampilkannya mengubah tata letak bilah; keputusan visual, bukan cacat. |
| 7 | **`hal` dijepit di dua tempat dengan aturan berbeda.** `Paginasi` menjepit ke `jumlahHalaman(total)`; lapisan data memakai `param.hal` mentah. Penanda `?hal=3` yang dibuka setelah data menyusut menampilkan "tidak ada yang cocok" (bohong — semua cocok) sementara paginasi menulis "Halaman 2 dari 2". | Butuh total, yang belum diketahui saat parameter diuraikan; tempat yang benar adalah lapisan data. |
| 8 | **`aria-pressed` pada `<Link>` bukan ARIA yang sah** — hanya berlaku pada `role="button"`/`switch`. Keadaan "chip ini menyala" karena itu hanya tersampaikan lewat WARNA. Pemakai pembaca layar mendengar tiga tautan tanpa tanda mana yang aktif. Ganti dengan `aria-current`. | Lolos lint dan lolos mata sekaligus; ditemukan review menyeluruh. |
| 9 | **Uji `pesanBerikutnya` menjamin fungsi murninya, bukan pengkabelan komponennya.** Bila seseorang mengembalikan komponen ke pola `if (r.ok) {…} else {…}` tanpa memanggil fungsi itu, kedua uji tetap hijau. | Menutupnya menuntut jsdom, yang dilarang batasan proyek. **Batas permanen**, bukan utang yang akan hilang. |
| 10 | **Pagar identitas melewatkan `.not("id","ilike",…)`** — bentuk 3-argumen postgrest-js yang identik dengan `.filter()`. Dan semua pagar berbasis grep buta terhadap string yang dipecah lewat variabel. | Negasi mengecualikan baris, tidak meloloskan awalan — bahaya otorisasinya berlawanan arah. Batas bawaan pendekatan grep sudah diterima sadar sejak awal. |
| 11 | **`namaBarisId()` di uji halaman Mitra menelusuri struktur markup** (`<b>` terakhir sebelum `href` ber-`ubah=`). Rapuh terhadap perubahan tata letak tabel. | Kerapuhannya gagal BERISIK, bukan senyap. |
| 12 | **Saringan "punya paket berjalan" menyaring HALAMAN, bukan seluruh daftar.** Totalnya kini jujur (melaporkan jumlah yang benar-benar tampil) dan paginasi tidak lagi menawarkan halaman fantom — tetapi klien berpaket di halaman 2 tetap tidak ikut terjaring. | Menutupnya menuntut view SQL; pekerjaan rencana 2. Yang wajib — berhenti berbohong — sudah dikerjakan. |

---

## Indeks keputusan ("Ruling N")

Nomor ini lahir saat pengerjaan dan dirujuk beberapa komentar di kode. Yang dicatat hanya keputusan
yang membentuk kode atau yang mahal bila dibalik tanpa tahu alasannya.

| N | Keputusan | Kenapa |
|---|---|---|
| 1–4 | Task 6 membawa fixture sendiri (25 mitra aktif + 1 nonaktif); uji paginasi WAJIB menuntut halaman 2 berisi; uji "panel menutup" menguji pencarian bukan halaman; `beforeAll` ditambahkan ke impor | Seed hanya berisi DUA mitra, keduanya aktif. Tanpa fixture, uji saringan gagal dan uji paginasi LULUS HAMPA — `[].some(...)` selalu `false` |
| 5 | Task 2&3 dan Task 4&5 masing-masing dikirim sebagai SATU dispatch | Primitif presentasional berbentuk sama, kodenya lengkap di rencana, tidak saling bergantung |
| 6 | Kata "admin" di komentar primitif diganti "staf" | Pagar sesungguhnya mencari literal `"admin"` BERTANDA KUTIP, bukan kata di prosa — batasan yang saya tulis lebih keras daripada pagarnya. Perubahan tetap dilakukan atas dasar KETEPATAN: primitif dipakai panel admin DAN owner |
| 8 | `text-panel-accent` → `text-panel-surface` di seluruh rencana | Token `--color-panel-accent` TIDAK PERNAH ADA. Tailwind v4 hanya melahirkan kelas untuk token yang terdefinisi, jadi chip aktif tampil gelap di atas gelap |
| 9 | Gejala token hantu diperbaiki BERSAMA pagarnya | Tidak ada uji yang bisa menangkap kelas Tailwind yang menunjuk token tak ada — kegagalannya senyap. Tanpa pagar, cacat yang sama lahir lagi dengan nama token berbeda |
| 10, 16 | Pagar identitas mempersempit sasaran, bukan mengecualikan berkas; lalu disamakan antar modul | Bahayanya bukan `.ilike()`, melainkan `.ilike()` pada kolom IDENTITAS: `.eq("id",x)` yang menjadi pola membuat sebuah awalan mencocokkan baris MILIK ORANG LAIN tanpa satu galat pun. Menangkap TIGA bentuk penulisan: metode, string di dalam `.or()` (termasuk sesudah koma), dan `.filter(kolom, operator, nilai)` |
| 14 | `padma_id` DIKECUALIKAN dari pagar identitas | Diverifikasi sebelum diputuskan: nol pemakaian `.eq("padma_id", …)` di seluruh `src/`. Kolom itu ditulis sekali lalu hanya ditampilkan — tidak pernah kunci pencarian identitas untuk otorisasi. PADMA ID justru dirancang untuk dicari; itulah yang dibacakan klien lewat telepon |
| 12 | Brief adalah SALINAN BEKU rencana | Koreksi rencana tidak menular ke brief yang sudah dibuat. Setiap koreksi harus diikuti pembuatan ulang brief yang belum dikirim |
| 15 | Verdict "disetujui" dari review DITOLAK; dua temuan Important masuk perbaikan | Cabang `saring.paket` yang tidak diuji akan DISAMBUNG KE ANTARMUKA di tugas berikutnya, dan uji pencarian tidak bisa membedakan "cari bekerja" dari "cari mati total" |
| 19 | Tiga kegagalan verifikasi ditutup, dua di antaranya cacat LEBIH TUA daripada rencana ini | Rute baru tak terdaftar di README; E2E passport tak pernah hijau di basis data bersih; E2E admin masih mengeklik PADMA ID sebagai tautan |
| 21 | Utang `max_rows` DICATAT, tidak diperbaiki | Polanya sudah ada di `main` sebelum rencana ini. Yang wajib hanya meluruskan komentar yang menjanjikan sebaliknya |

---

## Catatan proses yang layak diingat

**Enam implementer melaporkan penyimpangan dari brief alih-alih mendiamkannya, dan keenamnya
benar.** Termasuk yang paling berani: mengubah berkas yang brief nyatakan tidak boleh diubah,
karena tanpa itu uji di brief yang sama mustahil hijau selamanya. Nilai terbesar dari
"katakan bila menurut Anda brief-nya salah" ternyata bukan menangkap kesalahan implementer,
melainkan menangkap kesalahan penulis rencananya.

**Empat asersi hampa ditemukan di rencana ini**, dan ketiganya berasal dari kode uji yang ditulis
di rencana, bukan dari implementer: uji paginasi yang lulus karena halaman 2 kosong; uji kinerja
yang tidak bisa memerah karena basis data uji punya 6 baris melawan batas 25; asersi `value="`
yang cocok bahkan ketika isinya kosong; dan pagar money firewall yang dikunci pada ejaan nama
kolom alih-alih nilai. Pola yang sama akan muncul lagi.

**Galat `LayoutProps` yang selama beberapa rencana diperlakukan sebagai "pra-ada, abaikan"
ternyata bukan permanen** — ia artefak tipe rute Next yang belum diregenerasi. Sekali
`npm run build` dijalankan, `tsc --noEmit` bersih total. Beberapa rencana berturut-turut
mengabaikannya sebagai fakta hidup.
