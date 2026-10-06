# SDD ledger — plan: docs/superpowers/plans/2026-10-06-padma-p4-rekap-penjualan.md

Spec: docs/superpowers/specs/2026-10-02-padma-p4-rekap-penjualan-design.md (terbaca)
Worktree: .worktrees/p4 — cabang feat/p4-rekap-penjualan dari development @ 21ae52c

## Pre-flight scan

### Pasangan tugas yang berbagi berkas atau antarmuka

| Pasangan | Yang diproduksi vs yang dikonsumsi | Temuan |
|---|---|---|
| T1 → T4 | view `pesanan_item_staf` 7 kolom vs `select(... product_id)` | cocok |
| T2 → T3 | `bulanJakarta` vs pengelompokan ember | cocok |
| T2 → T5 | `deretBulanTerakhir`/`labelBulan`/`labelBulanPendek`/`bulanSekarangJakarta`/`rentangBulanJakarta` | cocok, keenamnya dipakai |
| T2 → T6 | idem + `stempelTanggalJakarta` | cocok |
| T3 → T4 | tipe `BarisPenjualan`/`ItemPenjualan` vs perakitan baris | cocok, 11 medan semuanya diisi |
| T3 → T5 | `hitungPenjualan`/`PenjualanBulan`/`Pengecualian` | cocok |
| T3 → T6 | `urutkanBaris`/`golongkan`/`nilaiBaris`/`tanggalUang` | cocok |
| T3 → T7 | `urutkanBaris` | cocok |
| T4 → T5 | `bacaPenjualan({mulai,sampai})` | cocok |
| T4 → T6 | `bacaPenjualan` + `BATAS_BARIS_PENJUALAN` | cocok |
| T4 → T7 | `bacaPenjualan({clientId})` | cocok |
| T6 → T7 | `TabelPenjualan({baris})` | cocok |
| T5,T6,T7 | ketiganya menyunting `tests/penjualan-layar.test.tsx` | berurutan; T7 memakai helper `notaDasar` milik T6 → R5 |
| T5,T6 | keduanya menyunting `web/README.md` (baris berbeda) | cocok |
| T6 | menyentuh primitif bersama `_shell/panel/tabel.tsx` | → R4 |

### Konsistensi tiap tugas dengan dirinya sendiri

| Tugas | Uji vs kode yang ditentukannya | Temuan |
|---|---|---|
| T1 | uji 7 kolom vs view 7 kolom | cocok |
| T2 | 15 uji vs 7 fungsi yang diekspor | cocok |
| T3 | 20 uji vs 6 fungsi + 7 tipe | **satu uji VAKUM** → R1 |
| T4 | 3 uji vs 1 fungsi | tipe `klien` meragukan → R2 |
| T5 | 7 uji render vs `KartuBulan` + `page.tsx` | cocok |
| T6 | 6 uji render vs `TabelPenjualan` + `page.tsx` | cocok |
| T7 | 3 uji render vs `BagianPembelian` + `KartuPembelian` | cocok |

### Pagar yang bisa tersentuh

`inventaris-rute` (dua arah, dua baris README wajib) · `money-firewall-struktural`,
`grant-anon`, `struktur-rls` (seharusnya NOL tersentuh — kemerahannya berarti
implementasi menyimpang) · `admin-shell`, `owner-kerangka` (entri nav baru)

## Rulings pra-eksekusi

Ruling R1: uji `"lunas bertanda akses_tertahan TETAP omzet"` di Tugas 3 DIGANTI, bukan dibuang — ia vakum, karena `golongkan(barisDasar({status:"lunas"}))` identik dengan uji pertama di atasnya. Sebabnya justru benar: `BarisPenjualan` sengaja TIDAK punya medan `sebabTinjauan`, sebab seluruh desain menolak menggolongkan lewat kolom itu. Gantinya pagar STRUKTURAL: `baca.ts` tidak boleh memuat string `sebab_tinjauan` di mana pun, dan `hitung.ts` juga tidak. — Ongkos bila salah: kita menukar satu uji yang tidak menguji apa pun dengan satu yang bisa gagal; tidak ada yang hilang.

Ruling R2: tipe parameter `klien` di `bacaPenjualan` memakai `Awaited<ReturnType<typeof createServerSupabase>>`, BUKAN `SupabaseClient` telanjang dari `@supabase/supabase-js`. Bila repo memakai klien bertipe `Database`, anotasi telanjang akan bentrok dengan kembalian `createServerSupabase()`. — Ongkos bila salah: nol; bentuk itu cocok menurut definisinya.

Ruling R3: Docker MATI saat eksekusi dimulai, dan Tugas 1 serta uji Tugas 4 menuntut Postgres. Docker dinyalakan di awal; bila belum siap saat Tugas 1 tiba, urutannya menjadi 2 → 3 → 1 → 4 → 5 → 6 → 7. Tugas 2 dan 3 murni dan tidak bergantung pada Tugas 1. Tugas 1 TIDAK boleh dilaporkan selesai tanpa uji DB-nya hijau. — Ongkos bila salah: nol untuk kebenaran; hanya urutan commit yang berubah.

Ruling R4: Tugas 6 TIDAK menambahkan prop `colSpan` ke `_shell/panel/tabel.tsx`. Baris "item tidak terbaca" dirender dengan DUA sel biasa (`<Td><i>Item tidak terbaca</i></Td><Td className="text-right">—</Td>`). Rencana mengizinkan penambahan prop itu; menambah prop pada primitif yang dipakai delapan daftar lain demi satu pemanggil adalah ongkos yang tidak perlu dibayar. — Ongkos bila salah: nol; tampilannya setara dan primitif bersama tidak tersentuh.

Ruling R5: Tugas 7 dijalankan sesudah Tugas 6 karena ujinya memakai helper `notaDasar` yang lahir di Tugas 6, di berkas uji yang sama. Dispatch Tugas 7 menyebutkan bahwa helper itu sudah ada dan tidak boleh ditulis ulang. — Ongkos bila salah: satu helper terduplikasi di berkas yang sama, tertangkap review.

## Kemajuan

Task 2: implementer af7701a35b1547e50, commits 21ae52c..36d74d1 (f99e508 modul, 36d74d1 global-setup)
Task 2: review — spec ❌ (36d74d1 di luar lingkup), kualitas: Changes needed (2 Critical, 1 Important)
Task 2: minor (deferred): `Date.parse` lenient — "2026-10" telanjang lolos sebagai stempel sah (bulan.ts:78-88)
Task 2: minor (deferred): `deretBulanTerakhir` tanpa penjaga `banyak <= 0`, memulangkan [] diam-diam (bulan.ts:113)
Task 2: minor (deferred): uji "siang hari di kedua zona" lolos juga di bawah slice(0,7) — sanity case, bukan pagar
Task 2: minor (deferred): `bulanSekarangJakarta` cabang `?? ""` mati — toISOString melempar lebih dulu

Ruling R6: `globalSetup: ["tests/global-setup.ts"]` TERPASANG untuk setiap pemanggilan vitest (vitest.config.ts:37), jadi tanpa Supabase tidak ada uji apa pun yang bisa jalan — termasuk yang murni. Rintangan yang ditemui implementer Tugas 2 NYATA; jalan keluarnya yang salah. Jalan keluar yang benar adalah menyalakan Supabase, bukan melemahkan pagar seluruh suite. Docker dinyalakan dan `supabase start` dijalankan oleh controller sebagai pekerjaan infrastruktur, bukan oleh implementer sebagai perubahan kode. — Ongkos bila salah: nol; tidak ada kode produksi yang berubah karenanya.

Ruling R7: commit 36d74d1 DIKEMBALIKAN seluruhnya. Selain di luar lingkup, pemeriksaan kesehatannya tidak berfungsi sama sekali — `from("auth.users")` bukan target PostgREST yang sah (skema `auth` tidak diekspos) sehingga ia menggalat bahkan saat Supabase sehat, dan supabase-js memulangkan `{ error }` alih-alih reject sehingga `Promise.race` tidak pernah kalah. Yang benar-benar melewati seeding hanyalah catch-all di atasnya, yang menelan SETIAP kegagalan seed — termasuk schema drift dan service key salah — menjadi satu `console.warn`. Suite yang berjalan tanpa seed memerahkan puluhan uji DB dengan galat yang menyesatkan, bukan satu kegagalan setup yang jelas. — Ongkos bila salah: uji murni tidak bisa dijalankan saat Supabase mati, yang memang keadaan repo ini sejak sebelum P4.

Ruling R8: MODE TANPA-JALAN-UJI untuk sisa P4, atas keputusan pemilik repo (6 Okt) karena mesin perlu restart agar Docker hidup. Setiap tugas TETAP MENULIS ujinya persis sesuai rencana; yang ditunda hanya MENJALANKANNYA. Gantinya, dua pagar yang masih berfungsi dijalankan sesudah setiap tugas:
  * `npx tsc --noEmit` — garis dasar worktree TEPAT 1 galat (`src/app/layout.tsx(28,50) TS2304 LayoutProps`, artefak worktree tanpa tipe Next tergenerasi; checkout utama 0 galat). Galat KEDUA apa pun berarti galat sungguhan.
  * `npx eslint src/...` — nol galat hari ini.
Keduanya menangkap kelas risiko terbesar dari menumpuk tugas: antarmuka antar-tugas yang tidak cocok.
TIDAK ADA tugas yang boleh ditandai `complete`. Semuanya `complete (BELUM TERVERIFIKASI)` sampai gerbang verifikasi tunggal sesudah restart.
— Yang HILANG, dan ini harus disebut terbuka: bukti merah-hijau. Langkah "jalankan untuk memastikan MERAH" ada di setiap tugas justru supaya "ujinya pasti gagal kalau kodenya salah" menjadi fakta yang diamati, bukan klaim. Sesudah kodenya ditulis, klaim itu tidak bisa dibuktikan lagi secara retroaktif. Gerbang verifikasi nanti hanya bisa membuktikan HIJAU, tidak bisa membuktikan ujinya pernah bisa merah.
— Ongkos bila salah: sampai enam tugas kode tak-teruji menumpuk, dan gerbang verifikasinya menjadi sesi debugging besar alih-alih tujuh pemeriksaan kecil.

Urutan di bawah R8: fix T2 (revert) → T1 (tulis migrasi, JANGAN terapkan) → T3 → T4 → T5 → T6 → T7 → gerbang verifikasi.
Task 2: fix round 1/5 (3 addressed, 0 open — revert global-setup; commits 36d74d1..e74e0e1)
Task 2: complete (commits 21ae52c..e74e0e1, review clean)
  Catatan verifikasi: uji Tugas 2 BENAR-BENAR DIJALANKAN dan hijau 18/18 SEBELUM revert.
  Patch global-setup tidak memengaruhi hasilnya karena ujinya murni dan tidak menyentuh DB.
  Jadi Tugas 2 adalah SATU-SATUNYA tugas P4 yang bukti hijaunya nyata; sisanya menunggu gerbang.
Task 1: implementer a5a476c4e51e38f96, commit e74e0e1..0ddb361
Task 1: review — spec ✅, kualitas: Approved, nol Critical/Important
Task 1: complete (commits e74e0e1..0ddb361, review clean) — BELUM TERVERIFIKASI (migrasi belum diterapkan, uji belum jalan; lihat R8)
Task 1: minor (deferred): komentar view lama di 20260926140000:598 masih berbunyi "enam kolom" — sejarah, tidak berbahaya

Ruling R9: `baca.ts` TIDAK menyaring `jenis = 'produk_digital'`. Reviewer Tugas 1 benar bahwa baris ber-`jenis = 'sesi'` akan memulangkan `product_id = null` dari view. Hari ini itu nol baris — P3 belum punya satu pun penulis `sesi`. Tiga jalan dipertimbangkan: (a) menyaring ke produk digital saja, yang membuat penjualan sesi tak terlihat SELAMANYA begitu P3 lahir; (b) membiarkan tanpa saringan dan menambah kolom `jenis` supaya layar bisa membedakan, yang membangun kemampuan untuk nol baris yang ada; (c) membiarkan apa adanya. Dipilih (c), karena `hitung.ts` mengelompokkan dengan `i.productId ?? i.judulBeku` — jadi item sesi kelak muncul sebagai BARIS PRODUKNYA SENDIRI dengan judul bekunya, terlihat, bukan terlipat diam-diam ke produk lain dan bukan hilang tanpa jejak. — Ongkos bila salah: ketika P3 mendarat, penjualan sesi ikut tampil di layar yang judulnya "penjualan produk digital", dan P3 harus memutuskan apakah itu yang diinginkan. Keputusan itu memang milik P3, bukan P4.
Task 3: implementer ae92a7c23b4bc21c1, commit 0ddb361..9e5425f
Task 3: review (opus) — spec ✅, kualitas: Changes needed (0 Critical, 3 Important, 4 Minor)
Task 3: minor (deferred): `dikembalikan` bergerbang `status === "lunas"`, jadi `ditahan` yang direfund melapor di ember lamanya — keduanya sudah pengecualian, nol inflasi omzet
Task 3: minor (deferred): pagar struktural mencocokkan NAMA kolom; memperkenalkan ulang bug di bawah nama medan lain (`alasanTinjauan`) tetap hijau
Task 3: minor (deferred): `tanggalUang` ada di antarmuka brief tapi tidak pernah diimpor ujinya; presedensi lunasPada-sebelum-uangPada hanya terliput insidental

Ruling R10: ketiga temuan Important Tugas 3 adalah CACAT RENCANA SAYA, bukan penyimpangan implementer — ketiganya ditranskrip verbatim dari brief. Semuanya masuk fix loop, dan tiga yang pertama ditambah satu Minor yang dipromosikan:
  (a) Uji "JEBAKAN coalesce" (test:64) VAKUM — fixture dan assertion-nya identik dengan test:60 tepat di atasnya, dan `.not.toBe("omzet")` tersirat oleh `.toBe("dikembalikan")`. Ia kelas kevakuman yang sama yang melahirkan Ruling R1, dan ia selamat dari pembersihan yang ia sendiri picu. Digabung ke satu uji; penjelasan jebakannya dipindah ke sana; maksud sesungguhnya sudah dipikul pagar struktural test:292.
  (b) `nilaiBaris(b) ?? 0` di hitung.ts:185 MELANGGAR SPEC §9 secara langsung: "Pesanan tanpa item terbaca → null, bukan 0. 'Rp 0' yang diucapkan dengan yakin lebih mahal daripada 'tidak terbaca', karena ia terbaca sebagai selisih." Baris tak terbaca tetap menaikkan `jumlahPembelian` sambil menyumbang Rp 0. Ketika pembacanya kehilangan hak, SELURUH baris tak terbaca dan laporannya berbunyi "N pembelian, Rp 0" tanpa satu pun penanda. Spec adalah otoritas yang mengikat dan rencana menyalahinya. Ditambahkan `tanpaNilai` yang bercermin dengan `tanpaTanggal`; baris tak terbaca keluar dari omzet DAN dari jumlahPembelian.
  (c) `URUT_PENGECUALIAN` adalah literal larik yang TypeScript tidak paksa lengkap — nilai `Golongan` keenam akan terkumpul di ember lalu hilang diam-diam dari keluaran. Diubah menjadi `Record<Pengecualian["golongan"], number>`, yang menuntut setiap kunci sehingga nilai baru menjadi galat kompilasi. Urutan `perProduk` menurun-menurut-nilai juga tidak pernah di-assert; ditambahkan ujinya.
  (d) DIPROMOSIKAN dari Minor: `golongkan` memakai literal `"lunas"`/`"ditahan"` di tempat `PESANAN_BERUANG` ada. Himpunan tidak bisa menggantikannya — keduanya menuju ember berbeda — tetapi ditambahkan uji yang menyatakan SETIAP anggota `PESANAN_BERUANG` menggolong ke sesuatu selain `bukan_penjualan`. Nilai enam yang kelak lahir memerahkannya alih-alih lenyap tanpa hitungan.
— Ongkos bila salah: (b) adalah yang paling mahal bila dibiarkan — laporan uang yang berbunyi "Rp 0" dengan yakin padahal datanya tidak terbaca. Sisanya menukar uji yang tidak bisa merah dengan uji yang bisa.
Task 3: fix round 1/5 (4 addressed, 0 open; commits 9e5425f..ad301db)
Task 3: complete (commits 0ddb361..ad301db, review clean) — BELUM TERVERIFIKASI (uji belum jalan; lihat R8)
Task 3: minor (deferred): cabang larik-kosong `nilaiBaris` tidak teruji (hanya `item: null` yang diuji)
Task 3: minor (deferred): pemecah-seri `perProduk` menurut judul (saat nilai sama) tidak teruji
Task 3: minor (deferred): uji PESANAN_BERUANG hanya menyatakan "bukan `bukan_penjualan`", tidak menyatakan ember mana yang benar
Task 3: minor (deferred): TIDAK ADA typecheck di CI — nol workflow menjalankan `tsc`. Pagar `Record<Pengecualian["golongan"], number>` karena itu hanya tegak saat seseorang menjalankan `tsc`/`next build` lokal; vitest tidak memeriksa tipe. Ini temuan di LUAR lingkup P4, diserahkan ke review akhir untuk ditriase.

Ruling R11: TIGA konsekuensi `tanpaNilai` yang WAJIB dibawa ke Tugas 5/6/7, ditemukan re-reviewer:
  (a) Ketika pembacanya kehilangan hak, hasilnya `bulan: []` dengan `tanpaNilai: N`. Layar HARUS merendernya sebagai "data tidak terbaca", BUKAN sebagai "belum ada penjualan". Keduanya terlihat sama persis dari luar, dan yang satu kebohongan tentang uang.
  (b) Baris tak-bertanggal yang JUGA tak terbaca hanya terhitung di `tanpaTanggal`, jadi `tanpaNilai` under-count. Kedua pencacah disjoint — setiap baris dihitung tepat sekali — tetapi penjumlahan keduanya bukan "jumlah baris bermasalah".
  (c) Baris `ditahan`/`lewat_tenggat` yang tak terbaca tidak terurai per golongan; ia hanya ada di `tanpaNilai`.
— Ongkos bila salah: (a) adalah layar yang mengatakan "belum ada penjualan" kepada pemilik yang sebenarnya kehilangan hak baca. Itu bentuk kegagalan yang sama dengan embed-RLS-null yang sudah dibayar repo ini.
Task 4: implementer af21e6909bfa3b1f4, commit ad301db..975e06f
Task 4: review (opus) — spec ✅, kualitas: Changes needed (4 Critical, 5 Important, 3 Minor)
Task 4: minor (deferred): `nominal_diterima` dipilih di putaran 1 tapi tidak pernah dibaca — kolom uang di kawat tanpa guna
Task 4: minor (deferred): nol uji untuk putaran 1(b), untuk `terpotong`, dan untuk jalur bayar-lewat-tenggat
Task 4: minor (deferred): `.in("pesanan_id", semuaId)` dengan ~1000 UUID = URL GET ~40 KB; bisa 414 di Kong alih-alih terpotong

Ruling R12: SEMBILAN temuan Tugas 4 masuk fix loop. Seluruhnya cacat rencana saya, bukan penyimpangan implementer. Yang paling mahal dua:
  (a) CRITICAL — `susulan` tidak menerapkan ulang `opsi.clientId`. Putaran 1(b) memang tidak bisa menyaring per klien (`notifikasi_pesanan` tidak punya `client_id`), jadi halaman riwayat pembelian SATU klien akan menampilkan pesanan DAN NOMINAL klien lain. Itu kebocoran data, bukan sekadar angka salah.
  (b) CRITICAL — kueri item putaran 2 tanpa `.limit()`, sementara `supabase/config.toml:18` memasang `max_rows = 1000` dan `semuaId` memuat sampai 1000 id. Urutannya `urutan asc` SECARA GLOBAL, jadi pemotongan menyimpan item #1 setiap pesanan dan membuang item #2 dan seterusnya. Akibatnya `nilaiBaris` memulangkan JUMLAH PARSIAL, bukan `null` — pagar "nol terbaca → null, jangan 0" tidak pernah menyala, dan omzetnya diam-diam kurang. Ini lebih buruk daripada nol: data sebagian terlihat persis seperti data lengkap.
  (c) CRITICAL — kueri notifikasi putaran 2 juga tanpa batas, urut `diterima_pada desc` global, jadi pemotongan membuang notifikasi pesanan TERTUA seluruhnya → `pernahDikembalikan` jadi false → refund terhitung sebagai omzet. Itu persis urutan klausa yang `golongkan` ada untuk mencegahnya.
  (d) CRITICAL — `terpotong` hanya menghitung putaran 1, jadi ketiga pemotongan putaran 2 tak terlihat. `BATAS_BARIS_PENJUALAN` + `terpotong` ada justru supaya pemotongan tidak pernah senyap.
  (e) IMPORTANT — `uangPada` diambil dari notifikasi TERAKHIR apa pun jenisnya, melanggar kontraknya sendiri di hitung.ts:33 ("notifikasi terakhir yang MEMBAWA UANG"). Preseden `admin/pesanan.ts:196` menyaring `nominal_diterima is not null`.
  (f) IMPORTANT — `.eq("kejadian", "lunas_setelah_tutup")` literal telanjang; preseden repo `KEJADIAN_AKSES: KejadianPesanan[]`. Rename enum membuat `lunasSetelahTutup` false selamanya TANPA galat kompilasi, dan setiap pesanan bayar-lewat-tenggat jatuh ke `bukan_penjualan` — uangnya lenyap dari laporan.
  (g) IMPORTANT — putaran 1(b) tidak menyaring status maupun jenis notifikasi, jadi notifikasi Oktober pada pesanan yang lunas September ikut tertarik, lalu `tanggalUang`-nya September — permintaan untuk Oktober memancarkan ember September PARSIAL.
  (h) IMPORTANT — uji klien di `penjualan-db.test.ts:134` VAKUM: `semaiProdukLunas` menempelkan pesanan ke `clients … limit(1)` (klien sembarang), bukan ke `klien@padma.test`, jadi `baris` kemungkinan besar kosong dan loop-nya tidak menyatakan apa pun. Satu-satunya uji yang menjaga pelajaran embed-RLS-null justru tidak menjaganya.
— Ongkos bila salah: (a) nominal klien lain tampil di halaman klien; (b) dan (c) angka uang yang salah dan terlihat benar. Keduanya tidak akan pernah terlihat tanpa uji yang jalan.

Ruling R13: pembetulan pemotongan memakai PEMBONGKAHAN, bukan `.limit()` yang lebih besar. `max_rows = 1000` adalah batas SERVER: `.limit(n)` dengan n > 1000 tidak menolongnya. Putaran 2 karena itu dipecah per 100 id dengan batas 900 per bongkah (900 < 1000), dan `terpotong` menyala bila bongkah mana pun memulangkan >= 900. — Ongkos bila salah: beberapa permintaan HTTP alih-alih satu; ia juga memperbaiki Minor ketiga (URL 40 KB) tanpa diminta.
Task 4: fix round 1/5 (8 addressed, 0 open; commits 975e06f..a6bd39e)
Task 4: complete (commits ad301db..a6bd39e, review clean) — BELUM TERVERIFIKASI (uji DB belum jalan; lihat R8)
Task 4: catatan — `ananda@padma.test` + `clients.user_id` terverifikasi ADA di seed-users.ts:259,277 (diperiksa controller, bukan ditebak)
Task 4: minor (deferred): bongkah ditandai terpotong pada tepat 900 baris (`>=`), over-report yang tidak berbahaya
Task 4: minor (deferred): uji klien bersandar pada policy `orders` membiarkan klien membaca pesanannya sendiri — belum diverifikasi ulang, tertunda sampai Docker hidup
Task 5: implementer a401f6a69eda94898, commit a6bd39e..5e49496
Task 5: review — spec ✅, kualitas: Changes needed (0 Critical, 2 Important, 5 Minor)
Task 5: minor (deferred): kartu masih berbunyi "Belum ada produk terjual bulan ini" walau sebabnya data tak terbaca — kartu tidak tahu `tanpaNilai` (pencacah global)
Task 5: minor (deferred): `?hal=99` menampilkan nol kartu; `Paginasi` hanya menjepit labelnya. Pola yang sama berlaku di /owner/rekap — tidak menyimpang dari preseden repo
Task 5: minor (deferred): uji bulan kosong 2026-07 dan 2026-08 nyaris kembar; hanya assertion "0 pembelian" yang baru
Task 5: minor (deferred): nol uji untuk irisan paginasi, sumbu grafik, dan prop labelKolom*

Ruling R14: dua Important Tugas 5 masuk fix loop, ditambah satu Minor yang dipromosikan dan satu saran reviewer yang saya terima.
  (a) IMPORTANT — uji di penjualan-layar.test.tsx:377 MENUNTUT "perlu ditinjau" huruf kecil sementara kartu-bulan.tsx:144 merender "Perlu ditinjau". `toContain` peka huruf besar-kecil, jadi uji ini akan GAGAL melawan komponen yang BENAR begitu Docker hidup. Kedua string itu saya sendiri yang menulis, di rencana yang sama. Dan uji pasangannya di :357 (`not.toContain`) lolos baik kotaknya dirender maupun tidak — vakum. Diperbaiki dengan penanda `data-pengecualian` pada kotaknya, bukan dengan mencocokkan prosa: assertion yang bersandar pada kalimat akan patah setiap kali kalimatnya diperbaiki, dan itu melatih orang mengabaikannya.
  (b) IMPORTANT — tajuk "Rp 0" dan grafik datar dirender SEBELUM panji `tanpaNilai`. Dalam kasus tak-terbaca, kebohongannya dibaca lebih dulu. Panji dipindah ke atas tajuk.
  (c) DIPROMOSIKAN dari Minor — teks panji "Biasanya ini masalah hak akses" menyajikan tebakan sebagai fakta. Diubah ke "Mungkin". Seluruh pekerjaan ini tentang tidak menyatakan yang tidak kita ketahui; panji yang melanggarnya sendiri adalah ironi yang mahal.
  (d) SARAN REVIEWER DITERIMA — ekstrak `PeringatanData({ terpotong, tanpaTanggal, tanpaNilai })` sebagai komponen murni ~15 baris, dengan dua uji `renderToStaticMarkup` tanpa DB. Ia membuat satu-satunya hal yang menjadi alasan R11(a) ada menjadi bisa diuji tanpa basis data, dan menjadikan pemindahan urutan di (b) satu baris. Mengekstrak SELURUH badan halaman akan over-engineering; panji saja tidak.
— Ongkos bila salah: (a) adalah uji merah di gerbang verifikasi yang akan terlihat seperti cacat kode padahal cacat uji — persis jenis yang membuang waktu paling banyak saat 7 tugas diverifikasi sekaligus.
Task 5: fix round 1/5 (4 addressed, 0 open; commits 5e49496..24eaa1e)
Task 5: complete (commits a6bd39e..24eaa1e, review clean) — BELUM TERVERIFIKASI (uji belum jalan; lihat R8)
Task 5: catatan — hand-back implementer rusak (isinya literal "placeholder"); controller memverifikasi sendiri: commit 24eaa1e ada, pohon bersih, tsc 1 galat garis dasar, eslint bersih, laporan ter-append lengkap. Kegagalan pesan, bukan kegagalan tugas.
Task 5: minor (deferred): baris `data-pengecualian` di kartu-bulan.tsx ~100 karakter; Prettier mungkin ingin membungkusnya

Ruling R15: halaman admin Tugas 6 MENGULANG cacat yang sama dengan yang diperbaiki di Tugas 3. Teks rencana menghitung totalnya dengan `.reduce((n, b) => n + (nilaiBaris(b) ?? 0), 0)` — `?? 0` yang sama persis, yang membuat baris tak-terbaca menyumbang nol diam-diam ke total yang dicetak di layar. Tabelnya memang menampilkan "Item tidak terbaca" per baris, jadi barisnya terlihat; TOTALNYA yang berbohong. Dibetulkan dengan modul murni baru `web/src/app/admin/penjualan/ringkas.ts` berisi `ringkasNota(baris) → { total, tanpaNilai }`, yang mengecualikan baris tak-terbaca dari total dan mencacahnya — dan yang, karena murni, BISA diuji tanpa basis data. Halaman mencetak cacahnya bila > 0. — Ongkos bila salah: total penjualan yang kurang tanpa satu pun penanda, di layar yang tujuannya pembukuan. Saya menulis cacat ini DUA KALI di rencana yang sama, di dua berkas berbeda; itu catatan tentang rencananya, bukan tentang implementernya.
Task 6: implementer ac4b3c7d22a43ad22, commit 24eaa1e..450a2e2
Task 6: review — spec ✅, kualitas: Approved, nol Critical/Important
Task 6: complete (commits 24eaa1e..450a2e2, review clean) — BELUM TERVERIFIKASI (uji belum jalan; lihat R8)
Task 6: minor (deferred) **UNTUK GELOMBANG REVIEW AKHIR** — uji `ringkasNota` tidak akan merah bila saringan `golongkan(b) !== "omzet"` DIHAPUS; ketiga fixture-nya baris `lunas` polos. Itu justru maksud modulnya. Satu uji dengan baris `pernahDikembalikan: true` + baris `ditahan` tak terbaca akan memakunya. INI KEVAKUMAN KE-5 di rencana ini.
Task 6: minor (deferred) **UNTUK GELOMBANG REVIEW AKHIR** — uji "satu baris per ITEM" memakai `toContain` pada prosa; implementasi salah yang merender satu baris per PESANAN dengan judul digabung akan lolos. Barisnya sudah membawa `data-pesanan`; mencacah kemunculannya (harap 2) adalah assertion yang diminta aturan repo.
Task 6: minor (deferred) **UNTUK GELOMBANG REVIEW AKHIR** — label "Total lunas pada periode ini" dihitung atas `cocokan` (baris yang SUDAH tersaring pencarian). Dengan kata pencarian aktif, labelnya melebih-lebihkan cakupan angkanya.
Task 6: minor (deferred): dua entri `CATATAN` lain (ditahan, lewat_tenggat) tanpa liputan uji
Task 6: minor (deferred): paragraf `terpotong` tanpa kait `data-`, berbeda dari panji `tanpaNilai`
Task 6: minor (deferred): panji `tanpaNilai` hanya mencacah nota omzet; item tak terbaca pada nota non-omzet tidak terhitung (tabelnya tetap menampilkannya)
Task 7: implementer aaff1dec30ee6bd5c, commit 450a2e2..60a5032
Task 7: review — spec ✅, kualitas: Approved dengan 1 Important (tata letak) + 6 Minor
Task 7: minor (deferred) **UNTUK GELOMBANG REVIEW AKHIR** — uji non-kosong tidak meng-assert `<table` MUNCUL; menambahkannya membuat assertion negatif kasus-kosong membuktikan dirinya sendiri
Task 7: minor (deferred): `bacaPenjualan` bisa melempar tanpa Suspense/error boundary — kegagalan riwayat pembelian akan mematikan SELURUH layar detail klien yang dipakai admin saat menelepon
Task 7: minor (deferred): bendera `terpotong` dibuang di kartu-pembelian; untuk satu klien tidak mungkin, tapi bila terjadi ia senyap
Task 7: minor (deferred): kolom "Klien" mengulang klien yang sama di setiap baris pada tampilan per-klien
Task 7: minor (deferred): uji 1 dan 4 merender markup yang sama; bisa digabung

Ruling R16: Important tata letak Tugas 7 masuk fix loop. Halaman detail klien adalah grid `lg:grid-cols-2`, dan kartu baru mendarat sebagai sel setengah-lebar di sebelah "Riwayat sesi". `TabelPenjualan` adalah tabel ENAM kolom ber-`min-w-[34rem]`, jadi di sel setengah-lebar ia akan menggulung horizontal di dalam kartunya pada kebanyakan desktop. Diperbaiki dengan `lg:col-span-2`. Saya TIDAK bisa memverifikasinya di peramban dari sini, jadi ini tetap hal yang pantas dilihat mata manusia sesudah restart. — Ongkos bila salah: kartu selebar penuh yang sebenarnya tidak perlu selebar itu; jauh lebih murah daripada tabel yang menggulung di dalam kartu.
Task 7: fix round 1/5 (1 addressed, 0 open; commits 60a5032..b93125a)
Task 7: complete (commits 450a2e2..b93125a, review clean) — BELUM TERVERIFIKASI (uji belum jalan; lihat R8)
Task 7: catatan PENTING untuk mata manusia — NOL kartu lain di halaman detail klien memakai `col-span`, dan satu-satunya `min-w-*` di halaman itu adalah `min-w-[34rem]` milik primitif tabel kita sendiri. Jadi `lg:col-span-2` MENCIPTAKAN preseden, bukan mengikutinya. Halaman /admin/klien/[id] pantas dilihat sekali di peramban sesudah restart.

SELURUH 7 TUGAS SELESAI. Lanjut ke review menyeluruh cabang (21ae52c..b93125a, 13 commit).

## Review menyeluruh cabang (opus, 21ae52c..b93125a)
Hasil: 2 Critical, 6 Important wajib-perbaiki, 8 boleh-rilis. Lapisan murni (bulan.ts, hitung.ts) BERSIH — nol `?? 0` tersisa, R10(b) dan R15 benar-benar hilang. Seluruh cacat ada di SAMBUNGAN: apa yang `baca.ts` serahkan ke layar, dan apa yang layar admin lakukan pada baris yang agregator buang.

Ruling R17: CRITICAL 1 — kedua layar admin merender pesanan `bukan_penjualan` sebagai penjualan. `hitungPenjualan` membuangnya (hitung.ts:173); kedua layar admin TIDAK — keduanya mengoper keluaran mentah `bacaPenjualan` ke `TabelPenjualan`, dan `CATATAN[golongkan(b)] ?? ""` memberi `bukan_penjualan` catatan KOSONG. Checkout yang ditinggalkan — keadaan pesanan PALING UMUM — tampil persis seperti penjualan lunas, lengkap dengan harga bekunya, dan di /admin/klien/[id] ia mendarat di bawah judul "Riwayat pembelian". Admin yang sedang menelepon akan memberi tahu klien bahwa ia membeli sesuatu yang tidak pernah dibayarnya. Bukti bahwa ini tidak disengaja: teks `Bantuan` halaman itu menyebut TEPAT TIGA jenis pengecualian dan tidak pernah menyebut kedaluwarsa/dibatalkan. Diperbaiki dengan penyaring MURNI yang bisa diuji di `ringkas.ts`, dipakai kedua layar. — Ongkos bila salah: nol; baris itu memang bukan penjualan menurut spec §4.2.

Ruling R18: CRITICAL 2 — komentar saya di baca.ts:113-118 MENYATAKAN `ditutup_pada` dan `lunas_pada` identik untuk pesanan lunas. Itu benar HANYA untuk jalur webhook, yang UPDATE-nya bergerbang `status = 'menunggu_bayar'`. Penulis `status='lunas'` yang LAIN adalah `putuskan_pesanan_ditahan` (20260926130000:585-591), yang menulis `ditutup_pada = coalesce(o.ditutup_pada, now())` — mempertahankan cap LAMA. Ia hidup dan terjangkau lewat /admin/pesanan. Akibatnya pesanan yang ditahan 28 Sep lalu diputuskan lunas 2 Okt HILANG DARI KEDUA BULAN: September menariknya lalu membuangnya di penjepit rentang, Oktober tidak pernah menariknya (putusan manusia tidak menulis notifikasi Midtrans). Nol `terpotong`, nol `tanpaTanggal`, nol `tanpaNilai` — kehilangan pendapatan terkonfirmasi yang sepenuhnya senyap, di layar yang tujuannya pembukuan. Saya memverifikasi klaim itu untuk SATU jalur dan menuliskannya sebagai kebenaran umum. Diperbaiki dengan kueri putaran-1 KETIGA atas `lunas_pada`. — Ongkos bila salah: satu kueri tambahan per muat.

Ruling R19: IMPORTANT 3 — `admin-shell.test.ts:436` dan `owner-kerangka.test.ts:364` mengunci cacah jangkar PERSIS dan DIPASTIKAN merah: admin 18→19, owner 12→14. Pre-flight scan saya MENYEBUT kedua berkas itu sebagai "pagar yang bisa tersentuh (entri nav baru)" lalu tidak ada yang menyentuhnya. Keduanya disunting sengaja, sama seperti uji enam→tujuh kolom. — Ongkos bila salah: gerbang verifikasi dibuka dengan dua merah yang terlihat seperti cacat kode, persis yang R14(a) ada untuk mencegahnya.

Ruling R20: ketiga Minor bertanda GELOMBANG REVIEW AKHIR semuanya divonis FIX oleh reviewer, dan saya terima ketiganya. Ditambah Important 4 (putaran 1(b) tanpa saringan apa pun saat `clientId` diberikan — 500 notifikasi klien lain, ~19 permintaan, dan nol `error.tsx` di seluruh aplikasi sehingga satu kegagalan mematikan seluruh halaman detail klien) dan Important 5 (batas baris tidak pernah diumumkan bila < 500 baris, melanggar spec §6.2, dan nol uji menyentuhnya melanggar §8.3).

Ruling R21: temuan "TIDAK ADA typecheck di CI" DIPROMOSIKAN dan harus diserahkan ke pemilik repo SEBELUM cabang ini di-merge, bukan dibiarkan mati bersama workspace. Di bawah R8, `tsc` adalah gerbang utama untuk enam dari tujuh tugas — dan ia berjalan HANYA karena ada manusia yang mengetiknya. Di luar lingkup P4 untuk diperbaiki; di dalam lingkup saya untuk dilaporkan.
