# PADMA C2 — Pembayaran sebagai Syarat Konfirmasi

> **Untuk pekerja agentik:** SUB-SKILL WAJIB: `superpowers:subagent-driven-development` atau
> `superpowers:executing-plans`. Langkah memakai kotak centang (`- [ ]`).
>
> Rencana ini RINGKAS atas permintaan pemilik repo — keputusan, jebakan, dan hal yang WAJIB diuji
> ditulis lengkap; kode rutin tidak.

**Tujuan:** Membuat konfirmasi jadwal menuntut pembayaran yang sudah diverifikasi, dengan tagihan
yang terbit tepat setelah bidan ditetapkan dan tenggat yang benar-benar berlaku.

**Spec:** `docs/superpowers/specs/2026-09-08-padma-c2-pembayaran-design.md` (P1–P7).

**Cabang:** `c2-pembayaran`, dari `main` `3262cc1`.

---

## Global Constraints

1. **JANGAN `test:e2e:video` / `test:e2e:semua`** — bucket R2 produksi klien.
2. **JANGAN `supabase db push` ke produksi.** Migrasi masuk repo; penerapan keputusan pemilik.
   **Produksi kini BERISI DATA SUNGGUHAN** (deploy + push 8 Sep) — tapi lihat butir 4.
3. Basis data lokal dipakai bersama. Resep: `npx supabase db reset` → `docker start` container mati
   → `docker restart supabase_auth_web`. `npm run db:recover` RUSAK.
4. **Tidak ada kehati-hatian data produksi** (keputusan pemilik 8 Sep): aplikasi belum dipakai klien
   sungguhan. Kolom wajib langsung, tanpa backfill "demi keamanan".
5. **MONEY FIREWALL** — nominal uang HANYA di `variant_rates`, `honor_marks`, `transport_rates`,
   `transport_khusus`. `status_bayar` enum dikecualikan karena ia KEADAAN; `status_bayar int` tetap
   merah.
6. `requireRole()` di DALAM setiap server action.
7. Jangan impor modul ber-service-role / `node:crypto` ke komponen `"use client"`.
8. Prop bernilai FUNGSI tidak menyeberang server → `"use client"`.
9. `tests/status-satu-sumber.test.ts` melarang literal status yang BERGANTI NAMA di luar
   `lib/jadwal/status.ts`. Nilai BARU (`menunggu_bayar`, `dibatalkan_tenggat`) wajib masuk daftar
   `NILAI_STATUS` di berkas uji itu.
10. `tests/inventaris-rute.test.ts` — rute baru wajib terdaftar di README.
11. `next build` men-typecheck `tests/` juga.
12. Skrip E2E WAJIB membersihkan fixture-nya sendiri di `finally`, dan **membersihkan saja** —
    jangan memanggil fungsi penyiap di sana (pelajaran C1-c: ia meninggalkan baris yang memerahkan
    uji di berkas lain).

---

## Struktur berkas

| Berkas | Tanggung jawab |
|---|---|
| `src/lib/jadwal/status.ts` | +`menunggu_bayar`, +`dibatalkan_tenggat`, panah barunya |
| `src/lib/tagihan/pengajuan.ts` | **BARU** — menurunkan nominal tagihan pengajuan dari tarif (murni + query baca) |
| `src/lib/tagihan/tenggat.ts` | **BARU** — fungsi murni: sisa waktu, sudah lewat atau belum |
| `src/lib/bukti/unggah.ts` | **BARU** — kunci objek, batas ukuran/jenis, penyimpanan ke bucket privat |
| `src/app/api/bukti/route.ts` | **BARU** — unggah bukti (klien, service role) |
| `src/app/api/bukti/[objek]/route.ts` | **BARU** — baca bukti (staf saja, bertanda) |
| `src/app/api/cron/tenggat/route.ts` | **BARU** — pembatal terjadwal |
| `src/app/passport/bayar/**` | kartu tagihan pengajuan + unggah bukti |
| `src/app/admin/bayar/**` | dua sumber tagihan, verifikasi, hapus bukti, saringan lunas>90 hari |
| `src/app/admin/sesi/**` | tombol "Terbitkan tagihan" menggantikan "Konfirmasi" pada `mitra_siap` |

**Migrasi** (urut, dipecah karena `add value` tidak boleh dipakai di transaksi yang sama):

| Berkas | Isi |
|---|---|
| `20260912100000_status_bayar_nilai.sql` | HANYA `add value` `menunggu_bayar` & `dibatalkan_tenggat` |
| `20260912101000_status_bayar_pagar.sql` | Peta perpindahan baru, kolom `status_bayar`/`bukti_objek`/`tenggat_bayar` pada `booking_requests` |
| `20260912110000_skrining_boleh_dilepas.sql` | `screening_id` nullable, indeks unik jadi parsial, gerbang berpindah ke trigger |
| `20260912120000_bucket_bukti.sql` | Bucket privat `bukti-bayar`, tanpa policy |
| `20260912130000_batalkan_tenggat.sql` | Fungsi pembatal, dipanggil cron & dievaluasi saat dibaca |

---

## Tugas

Tiap tugas: uji dulu → merah → implementasi → hijau → commit.

### T1 — Rantai status bertambah satu keadaan
`menunggu_bayar` dan `dibatalkan_tenggat` masuk enum + `lib/jadwal/status.ts`; peta perpindahan
diperbarui: `mitra_siap → menunggu_bayar → dikonfirmasi`, `menunggu_bayar → mencari_mitra`,
`menunggu_bayar → dibatalkan_tenggat`, dan `dibatalkan_klien` tetap dari keempat keadaan antrean.

**Wajib diuji:** setiap panah baru sah; `mitra_siap → dikonfirmasi` LANGSUNG kini **ditolak** (itu
inti C2); lompatan ditembak langsung ke DB tetap ditolak; daftar TS dan enum Postgres identik.

**Jebakan:** `konfirmasi_permintaan()` dari C1-a mengklaim dari `mitra_siap`. Ia WAJIB berubah
mengklaim dari `menunggu_bayar` DAN menuntut `status_bayar = 'lunas'` — di dalam fungsi, bukan di
server action. Uji "dua konfirmasi bersamaan → satu sesi" harus tetap hijau.

### T2 — Tagihan pengajuan: diturunkan, tidak disimpan
`lib/tagihan/pengajuan.ts` menghitung total dari `variant_rates` (menurut TANGGAL SESI) +
`transport_rates` (menurut jenjang). Kolom baru pada `booking_requests` hanya `status_bayar`,
`bukti_objek`, `tenggat_bayar`.

**Wajib diuji:** money firewall struktural tetap hijau; satu uji menyebut `booking_requests`
eksplisit dan menolak kolom bernuansa nominal; menaikkan tarif SESUDAH tagihan terbit tidak
menggeser angkanya; jenjang `di_atas_20` (tanpa tarif rate card) memulangkan "menunggu tarif
khusus", bukan nol.

### T3 — Terbitkan tagihan menggantikan konfirmasi langsung
Server action `terbitkanTagihan(permintaanId)`: `mitra_siap → menunggu_bayar`, mengisi
`tenggat_bayar = now() + 24 jam`. Layar antrean admin: tombolnya berubah.

**Wajib diuji:** tenggat terisi; memanggilnya dua kali tidak memperpanjang tenggat; peran klien
ditolak.

### T4 — Unggah bukti (klien)
Peramban mengecilkan gambar (maks 1.200px, JPEG 0,7) sebelum kirim. Rute service role menulis ke
bucket privat; `client_id` dari SESI, tidak pernah dari body. Batas ukuran & jenis ditegakkan di
bucket, bukan hanya di peramban. Layar menyarankan menutup saldo sebelum memotret.

**Wajib diuji:** `anon` & `authenticated` tidak punya hak apa pun atas bucket (pola uji
`materi-halaman`); klien tidak bisa mengunggah untuk pengajuan orang lain; jenis berkas selain
gambar ditolak; status berpindah ke `menunggu_verifikasi`, TIDAK pernah langsung `lunas`.

### T5 — Verifikasi & hapus bukti (admin)
`/admin/bayar` menampilkan DUA sumber dengan penanda jelas: tagihan pengajuan (menahan jadwal) dan
tagihan sesi (yang sudah ada). Tombol hapus bukti per baris + saringan "lunas > 90 hari".

**Wajib diuji:** verifikasi menulis jejak beraktor nyata (tabel jejak yang sudah ada); menghapus
bukti TIDAK menghapus jejak; klien tidak bisa membaca bukti milik siapa pun lewat rute baca.

### T6 — Tenggat: cron + evaluasi saat dibaca
Fungsi Postgres pembatal (idempoten), rute cron memanggilnya, dan antrean admin + Passport
memperlakukan pengajuan lewat-tenggat sebagai batal walau cron belum jalan.

**Wajib diuji:** menjalankan pembatal dua kali tidak membatalkan dua kali; pengajuan yang SUDAH
lunas tidak pernah ikut dibatalkan walau tenggatnya lewat; rute cron menolak pemanggil tanpa
rahasia yang benar.

### T7 — Skrining dikembalikan pada batal-tenggat
`screening_id` nullable; indeks unik jadi parsial; gerbang skrining berpindah ke trigger yang
menuntut skrining pada status antrean.

**Wajib diuji, BERDAMPINGAN:** batal-tenggat MENGEMBALIKAN skrining (bisa dipakai memesan lagi);
batal-oleh-klien TIDAK. Ini pembedaan yang paling mudah hilang saat kode dirapikan.

### T8 — Pemberitahuan dua kanal
WhatsApp siap-salin (pola `lib/auth/pesan-undangan.ts`: berkas MURNI tanpa impor) memuat nama,
layanan, tanggal, jam, total, dan batas waktu. Passport menampilkan kartu tagihan dengan sisa waktu.

**Wajib diuji:** pesan memuat kelima unsur; berkas pesan tidak mengimpor apa pun (kalau tidak, ia
menyeret service role ke bundel peramban saat dipakai komponen klien).

### T9 — E2E, README, verifikasi
Corong penuh diperluas: pesan → tagihan terbit → unggah bukti → admin verifikasi → jadwal terkunci.
README diperbarui (tiga rute baru). `npm test`, `npm run lint`, `npm run build`, delapan skrip E2E
satu per satu. Catatan tindak lanjut ditulis dengan bukti sungguhan.

---

## Di luar lingkup

- **Email otomatis** (P7) — menuntut penyedia baru; ditunda ke bagiannya sendiri.
- **Payment gateway** — ditolak klien.
- **Pembatalan berjenjang, jadwal ulang, kredit, pengembalian dana** — C3. Kebijakannya di
  `docs/superpowers/2026-09-08-kebijakan-pembatalan-klien.md`; baca dari sana.
