# PADMA C1-a — Rantai Status, Jam Sesi, Pemilihan Mitra, dan Pembatalan Klien

> **Untuk pekerja agentik:** SUB-SKILL WAJIB: pakai superpowers:subagent-driven-development
> (disarankan) atau superpowers:executing-plans untuk mengerjakan rencana ini tugas demi tugas.
> Langkah memakai sintaks kotak centang (`- [ ]`).

**Tujuan:** Memasang rantai status pemesanan yang diminta klien (J1), memberi sesi sebuah JAM mulai
yang dipilih klien (J2), membuat admin memilih mitra dari daftar terurut jarak (J7), dan memberi
klien jalan keluar dari antreannya sendiri (J8) — sehingga alur pemesanan berjalan utuh dari
"diminta" sampai "sesi selesai" dengan waktu yang benar-benar berupa janji, bukan preferensi.

**Arsitektur:** Rantai status dipasang pada DUA objek, bukan satu tabel: `booking_requests` hidup
sampai `dikonfirmasi`, `sessions` hidup sesudahnya (J1). Setiap perbandingan status melewati SATU
modul murni `src/lib/jadwal/status.ts`; nilai statusnya tidak pernah ditulis literal di layar atau
server action mana pun. Kesahihan perpindahan ditegakkan DUA kali — sebagai fungsi murni di
TypeScript (untuk pesan yang bisa dibaca manusia) dan sebagai trigger basis data (karena klien
memegang policy INSERT/UPDATE dan bisa memanggil PostgREST langsung). Jam sesi disimpan sebagai
kolom `time` terpisah dari `date`, dan seluruh aritmatika waktunya memakai offset tetap WIB
(+07:00), bukan kalender mesin.

**Tumpukan:** Next.js 16.3.3 (App Router, server actions) · TypeScript · Supabase (Postgres + RLS +
trigger plpgsql) · Vitest (`npm test`) · Playwright lewat `tsx` untuk E2E · Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-08-padma-c1-fondasi-jadwal-design.md` — keputusan J1, J2,
J7, J8, J13. Rencana ini mengerjakan bagian itu saja.

**Bagian dari tiga rencana C1:**
- **C1-a (dokumen ini)** — rantai status, jam, mitra, pembatalan klien.
- **C1-b** — skrining sebagai syarat setiap pengajuan (J3, J4, J5, J6, J9, J11) + E2E corong penuh.
- **C1-c** — rating layanan & bidan (J10) dan QRIS asli (J12).

Ditulis terpisah karena masing-masing menghasilkan perangkat lunak yang berjalan dan bisa diuji
sendiri, dan karena C1-b menyentuh 18 titik insert uji yang jauh lebih mudah disunting SESUDAH
rantai status berhenti berubah. C1-b dan C1-c ditulis setelah rencana ini selesai, supaya keduanya
bisa mengacu pada kode yang benar-benar ada, bukan pada kode yang diperkirakan akan ada.

> **UTANG YANG DIWARISKAN RENCANA INI KE C1-b — dicatat SEKARANG, bukan nanti.** J3 menuntut
> `booking_requests.screening_id NOT NULL`. Migrasi itu mendarat di C1-b, **sesudah** rencana ini
> menaruh baris `booking_requests` di `seed.sql` dan di ~18 titik insert uji. Di produksi tidak
> masalah — tabelnya masih kosong. Di lokal dan di uji, `set not null` akan **menolak** pada
> `db reset` karena baris lama tidak punya skrining, dan kegagalannya akan terlihat seperti masalah
> lain sama sekali. Karena itu migrasi C1-b wajib bertahap: **tambah kolom nullable → backfill (atau
> hapus baris uji lama) → baru `set not null`.** (Diperingatkan penulis spec saat meninjau rencana
> ini, 8 September 2026.)

---

## Global Constraints

Setiap tugas di bawah tunduk pada seluruh butir ini. Diambil dari spec, dari `web/AGENTS.md`, dan
dari keterangan langsung penulis spec (sesi `padma-f3`) serta lima sesi kerja lain di mesin ini.

1. **JANGAN PERNAH menjalankan `npm run test:e2e:video` atau `npm run test:e2e:semua`.** Keduanya
   mengunggah lalu menghapus objek di bucket Cloudflare R2 **produksi** milik klien.
   `test:e2e:semua` memanggil yang video. Skrip E2E lain aman dijalankan satu per satu.

2. **JANGAN `supabase db push` ke produksi.** Produksi sudah hidup (project
   `vtprvvwslclyqlunzuvj`, Singapore). Migrasi rencana ini masuk ke repo saja; penerapannya ke
   produksi diputuskan pemilik repo sesudah ditinjau.

3. **Basis data Supabase lokal (`127.0.0.1:54321`) dipakai BERSAMA semua sesi kerja di mesin ini.**
   `npx supabase db reset`, `npm run db:recover`, dan suite penuh `npm test` saling merusak.
   `db reset` membangun ulang skema dari direktori migrasi worktree PEMANGGILNYA — migrasi milik
   worktree lain lenyap **tanpa galat**, dan yang merah adalah uji pemilik migrasi, bukan uji si
   pe-reset. **Umumkan lewat SendMessage ke seluruh sesi aktif (`ListAgents`) sebelum reset atau
   suite penuh, dan tunggu balasan.** Rencana ini menambah tujuh migrasi, jadi butirnya mengikat.

3a. **Resep reset yang BEKERJA di mesin ini**, dari sesi yang membayarnya dengan waktu
   (8 September 2026): `npm run db:recover` **rusak** — langkah `supabase stop`-nya gagal dan
   meninggalkan stack setengah mati. Yang bekerja, berurutan:
   ```bash
   cd /Users/arvinfairuz/Documents/padma/web
   npx supabase db reset
   docker ps -a --filter status=exited --format '{{.Names}}' | grep supabase | xargs -r docker start
   docker restart supabase_auth_web    # WAJIB
   ```
   Tanpa `docker restart supabase_auth_web`, suite melambat 8× dengan galat yang menunjuk ke
   mana-mana. Ini menggantikan Global Constraint 18 versi lama.

3b. **Jangan `npm run build` selagi `next start` hidup di worktree yang sama.** Itu
   mendesinkronkan servernya dan seluruh rute menjadi `__next_error__` — kegagalan yang terlihat
   seperti bug kode Anda dan bukan. Matikan servernya dulu, atau build di worktree lain.

4. **Kegagalan uji yang BERPINDAH-PINDAH berkas antar-run, sementara tiap berkas lulus saat
   dijalankan sendirian, adalah gangguan sesi lain — bukan regresi Anda.** Diagnostiknya:
   `docker ps` — bila `supabase_db_web` LEBIH MUDA daripada `supabase_rest_web`, basis data
   dibangun ulang di tengah run Anda. Dan
   `select version from supabase_migrations.schema_migrations order by version desc limit 3` —
   bila migrasi Anda hilang dari daftar, itu sebabnya. Jangan mengejarnya sebagai bug.

5. **Satu tes menggantung ratusan detik tanpa galat** = PostgREST memegang koneksi ke basis data
   yang sudah pergi (biasanya sesudah mesin tidur). Obatnya `docker restart supabase_rest_web`,
   bukan menaikkan timeout.

6. **Baca `node_modules/next/dist/docs/` sebelum menulis kode Next.** Versi di repo ini (16.3.3)
   punya perubahan yang memutus dari yang mungkin Anda hafal (`web/AGENTS.md`).

7. **Jangan mengimpor modul ber-service-role atau `node:crypto` ke komponen klien.** Konvensinya
   tertulis di `src/lib/auth/pesan-undangan.ts:4-9`. Satu impor sudah cukup menyeret klien service
   role ke bundel peramban. Ini menjatuhkan Tahap B. Buktikan dengan `next build` + grep chunk,
   bukan dengan keyakinan. Cacat Server→Client component pernah lolos sampai produksi di repo ini.

8. **`requireRole()` WAJIB dipanggil DI DALAM setiap server action.** Server action adalah endpoint
   POST tersendiri yang tidak pernah melewati penjaga layout.

9. **Nilai enum berbahasa Indonesia**, bukan `SCREAMING_SNAKE` bahasa Inggris (spec J1). Yang
   diadopsi dari usulan klien adalah MODELNYA, bukan ejaannya.

10. **`menunggu_bayar` (`AWAITING_PAYMENT`) TIDAK BOLEH dibuat di rencana ini.** Ia milik C2.
    Menyiapkan nilai enum yang belum dipakai berarti menaruh keadaan mati di dalam basis data yang
    tidak satu pun kode tahu cara keluar darinya (spec J1).

11. **Money firewall.** `tests/money-firewall-struktural.test.ts` membatasi kolom nominal uang hanya
    pada `variant_rates`, `honor_marks`, `transport_rates`, `transport_khusus`. Rencana ini tidak
    menambah satu pun kolom nominal; bila sebuah nama kolom terdengar seperti uang, ganti namanya.

12. **`tests/inventaris-rute.test.ts` menjaga tabel rute README dua arah.** Rute baru tanpa baris
    README = merah, dan sebaliknya.

13. **`tests/panel-primitif.test.ts`** menjaga `src/app/_shell/panel/` tetap buta-peran: tidak boleh
    ada literal `"admin"`/`"owner"`, `requireRole`, `createAdminSupabase`, atau rupiah di sana.
    Ditambah pagar token Tailwind — kelas `(text|bg|border)-panel-*` yang menunjuk token tak
    terdefinisi gagal **senyap** (teks tak terbaca, tanpa galat build).

14. **`tests/paket-tersembunyi.test.tsx`** akan merah bila halaman baru menyebut kata "paket".
    Formulir pemesanan C1 hanya menawarkan **durasi (varian)**.

15. **Jalankan suite PENUH sebelum menyatakan sebuah tugas selesai, bukan sapuan terarah.** Dua kali
    dalam rantai transport, yang menangkap cacat baru justru pagar berskop global yang tidak pernah
    ikut sapuan terarah. (Tunduk pada butir 3 — koordinasikan dulu.)

16. **Zona waktu.** Vercel berjalan UTC. Seluruh perbandingan tanggal adalah perbandingan STRING
    `YYYY-MM-DD` lewat `hariIniJakarta()`; seluruh perhitungan "berapa jam lagi" memakai offset
    tetap `+07:00`. **Jangan pernah `new Date(tanggal)` telanjang** dan jangan pernah `getTime()`
    atas tanggal.

17. **Fakta terverifikasi tentang enum Postgres, sudah diprobe langsung di basis data lokal
    8 September 2026 — jangan diulang, dan jangan dilanggar:**
    - `alter type … add value` lalu MEMAKAI nilai itu **di transaksi yang sama** gagal dengan
      `55P04 unsafe use of new value`. Karena itu penambahan nilai enum wajib berada di **berkas
      migrasi tersendiri**, terpisah dari berkas yang memakainya.
    - `alter type … rename value` lalu memakai nilai barunya di transaksi yang sama **BERHASIL**.
      Rename karena itu boleh satu berkas dengan pemakaiannya.

18. **`web/tests/pagar-batas-server-klien.test.ts` memerahkan `npm test` bila prop bernilai FUNGSI
    dioper dari berkas server (`.tsx` tanpa `"use client"`) ke komponen `"use client"`.** Kelas
    cacat ini sudah tiga kali menggigit repo ini dan yang ketiga **lolos sampai ke `main`**:
    `/admin/materi/[id]` crash di SETIAP kunjungan, dan 191 uji hijau tidak bisa melihatnya karena
    `renderToStaticMarkup` tidak punya batas server/klien sama sekali — ditemukan hanya dengan
    membuka halamannya di peramban. Tugas 9 membuat layar pemilihan mitra: persis jenis layar yang
    menggoda mengoper `labelUntuk={(x) => …}` atau `onPilih={…}` dari page server. Pagar itu teman,
    bukan gangguan. Batas klasifikasinya dicatat di
    `docs/superpowers/2026-09-08-panel-sapuan-tindak-lanjut.md`.

19. **JANGAN `git add -A`, termasuk `git add -A web` dan `git add -A web/src`.** Worktree utama
    memuat perubahan milik pemilik repo dan sesi lain yang belum ter-commit dan bukan bagian
    pekerjaan ini (saat rencana ini ditulis: `web/src/app/_landing/lini-layanan.tsx` tersunting oleh
    pihak lain). Perintah `git add -A <path>` di beberapa tugas di bawah adalah **kemudahan, bukan
    izin**: jalankan `git status --short` lebih dulu, dan bila ada berkas yang bukan milik Anda,
    ganti dengan daftar path eksplisit. Bekerja di worktree terpisah (`superpowers:using-git-worktrees`)
    membuat butir ini jauh lebih mudah dipatuhi — dan itulah cara yang disarankan untuk menjalankan
    rencana ini.

20. **Bentuk `/admin/sesi` sudah berubah oleh sapuan panel (merge `6e5e813`, kini di `main`).**
    Halaman itu punya bilah cari + tiga kelompok saringan + paginasi, dan formulir "jadwalkan" serta
    "tandai selesai" **pindah dari sel tabel ke panel geser** (`?ubah=baru` / `?ubah=<id>`). Yang
    TIDAK pindah: blok konfirmasi permintaan (`BlokPermintaan`) masih di atas tabel. Baca layarnya
    apa adanya sebelum menyunting — jangan bekerja dari ingatan tentang bentuk lamanya.

---

## Struktur Berkas

**Modul domain baru** (murni, tanpa impor Supabase, tanpa `node:crypto` — aman diimpor komponen
klien maupun server):

| Berkas | Tanggung jawab |
|---|---|
| `src/lib/jadwal/status.ts` | SATU-SATUNYA daftar nilai status permintaan & sesi, label, dan tabel perpindahan yang sah. Tidak ada nilai status yang boleh ditulis literal di luar berkas ini. |
| `src/lib/jadwal/jam.ts` | Bentuk & kesahihan jam (`HH:MM`), daftar jam dari pengaturan, format tampilan, dan aritmatika "berapa jam lagi sesinya" dengan offset tetap WIB. |
| `src/lib/jadwal/urutan-mitra.ts` | Fungsi murni: mengurutkan mitra menurut jarak garis lurus ke alamat klien. |

**Migrasi baru** (tujuh berkas, urut):

| Berkas | Isi |
|---|---|
| `20260909100000_rantai_status_nilai.sql` | HANYA `alter type … rename value` & `add value`. Terpisah karena batasan `55P04`. |
| `20260909101000_rantai_status_pagar.sql` | Indeks antrean, `guard_booking_status` baru, `guard_booking_pembatas` baru, trigger perpindahan permintaan & sesi. |
| `20260909110000_jam_sesi.sql` | Kolom `jam_mulai` pada `booking_requests` & `sessions`, CHECK bentuknya. |
| `20260909120000_registri_jam_layanan.sql` | Bentuk setelan `daftar_jam` + kunci `jam_layanan` di registri. |
| `20260909130000_mitra_pada_permintaan.sql` | Kolom `partner_id` pada `booking_requests` + CHECK "`mitra_siap` & `dikonfirmasi` wajib bermitra". |
| `20260909135000_konfirmasi_atomik.sql` | `konfirmasi_permintaan()` — status + baris sesi dalam SATU transaksi. |
| `20260909140000_pembatalan_oleh_klien.sql` | Policy UPDATE klien + kunci kolom + izin perpindahan ke `dibatalkan_klien`. |
| `20260909150000_ditolak_tak_terjangkau.sql` | Komentar & pagar: `ditolak` tetap ada, tidak lagi bisa ditulis siapa pun. |

**Satu catatan tentang bentuk rencana ini.** Langkah yang menyentuh basis data, modul domain, dan
uji ditulis sebagai KODE LENGKAP — di sanalah kesalahan mahal dan tak terlihat. Langkah yang
menyentuh TATA LETAK layar admin (Tugas 9 Step 8, Tugas 10 Step 5) sengaja ditulis sebagai
kebutuhan, bukan JSX yang didikte: bentuk `/admin/sesi` baru saja berubah oleh sapuan panel
(Global Constraint 20), dan JSX yang ditulis hari ini dari ingatan akan menjadi JSX yang salah saat
dikerjakan. Bacalah layarnya apa adanya lebih dulu. Yang mengikat di sana adalah perilaku dan
pagarnya, bukan susunan kelas Tailwind-nya.

**Berkas yang disunting** (bukan daftar tertutup — sapuan di Tugas 4 yang menentukan):
`src/app/admin/sesi/status.ts`, `src/app/admin/sesi/aksi.ts`, `src/app/admin/sesi/page.tsx`,
`src/app/admin/sesi/antrean-permintaan.tsx`, `src/lib/admin/agenda.ts`, `src/lib/admin/antrean.ts`,
`src/lib/admin/sesi.ts`, `src/lib/passport/aksi.ts`, `src/lib/passport/data.ts`,
`src/app/passport/ajukan/page.tsx`, `src/app/passport/ajukan/form.tsx`, `src/app/passport/page.tsx`,
`src/lib/owner/data.ts`, `README.md`.

---

## Task 1: Modul status — satu tempat untuk seluruh perbandingan

Tugas pertama, dan sengaja demikian. Spec §"Risiko utama": perubahan enum adalah jenis perubahan
yang **gagal diam-diam** — kode yang membandingkan dengan nilai lama tidak error, ia hanya berhenti
cocok, dan akibatnya berbentuk permintaan yang tidak pernah muncul di layar siapa pun. Memusatkan
perbandingannya SESUDAH menyebarkannya adalah cara paling mahal mengerjakan ini.

**Files:**
- Create: `web/src/lib/jadwal/status.ts`
- Test: `web/tests/jadwal-status.test.ts`

**Interfaces:**
- Consumes: tidak ada (modul murni, tanpa impor).
- Produces:
  - `STATUS_PERMINTAAN: readonly StatusPermintaan[]`, `type StatusPermintaan`
  - `STATUS_ANTRE: readonly StatusPermintaan[]`
  - `LABEL_PERMINTAAN: Record<StatusPermintaan, string>`
  - `PERPINDAHAN_PERMINTAAN: Record<StatusPermintaan, readonly StatusPermintaan[]>`
  - `bolehPindahPermintaan(dari: StatusPermintaan, ke: StatusPermintaan): boolean`
  - `STATUS_SESI: readonly StatusSesi[]`, `type StatusSesi`, `LABEL_SESI`,
    `PERPINDAHAN_SESI`, `bolehPindahSesi(dari: StatusSesi, ke: StatusSesi): boolean`

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/jadwal-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  STATUS_PERMINTAAN,
  STATUS_ANTRE,
  LABEL_PERMINTAAN,
  PERPINDAHAN_PERMINTAAN,
  bolehPindahPermintaan,
  STATUS_SESI,
  LABEL_SESI,
  PERPINDAHAN_SESI,
  bolehPindahSesi,
  type StatusPermintaan,
} from "@/lib/jadwal/status";

describe("daftar status permintaan", () => {
  it("persis enum booking_status sesudah C1 — tidak lebih, tidak kurang", () => {
    expect([...STATUS_PERMINTAAN].sort()).toEqual(
      [
        "dibatalkan_klien",
        "dikonfirmasi",
        "diminta",
        "mencari_mitra",
        "mitra_siap",
        "ditolak",
      ].sort(),
    );
  });

  it("TIDAK memuat menunggu_bayar — itu milik C2 (spec J1)", () => {
    expect(STATUS_PERMINTAAN).not.toContain("menunggu_bayar" as StatusPermintaan);
  });

  it("antrean = tiga keadaan sebelum konfirmasi, itulah yang mengisi kuota klien", () => {
    expect([...STATUS_ANTRE]).toEqual(["diminta", "mencari_mitra", "mitra_siap"]);
  });

  it("setiap status punya label untuk manusia", () => {
    for (const s of STATUS_PERMINTAAN) {
      expect(LABEL_PERMINTAAN[s]).toBeTruthy();
    }
  });
});

describe("perpindahan status permintaan", () => {
  it("jalur wajar: diminta -> mencari_mitra -> mitra_siap -> dikonfirmasi", () => {
    expect(bolehPindahPermintaan("diminta", "mencari_mitra")).toBe(true);
    expect(bolehPindahPermintaan("mencari_mitra", "mitra_siap")).toBe(true);
    expect(bolehPindahPermintaan("mitra_siap", "dikonfirmasi")).toBe(true);
  });

  it("MELOMPAT ditolak — diminta tidak boleh langsung dikonfirmasi", () => {
    expect(bolehPindahPermintaan("diminta", "dikonfirmasi")).toBe(false);
    expect(bolehPindahPermintaan("mencari_mitra", "dikonfirmasi")).toBe(false);
  });

  it("mundur satu langkah boleh — mitra membatalkan, admin mencari lagi", () => {
    expect(bolehPindahPermintaan("mitra_siap", "mencari_mitra")).toBe(true);
    expect(bolehPindahPermintaan("mencari_mitra", "diminta")).toBe(true);
  });

  it("klien boleh membatalkan dari ketiga keadaan antrean (spec J8)", () => {
    for (const dari of STATUS_ANTRE) {
      expect(bolehPindahPermintaan(dari, "dibatalkan_klien")).toBe(true);
    }
  });

  it("yang sudah dikonfirmasi tidak bisa dibatalkan lewat jalur permintaan", () => {
    expect(bolehPindahPermintaan("dikonfirmasi", "dibatalkan_klien")).toBe(false);
  });

  it("TIDAK ADA panah mundur dari dikonfirmasi — konfirmasi atomik (lihat Tugas 9)", () => {
    // Draf pertama rencana ini menyahkan `dikonfirmasi -> mitra_siap` sebagai
    // jalur PEMULIHAN, karena konfirmasi adalah dua tulisan (status permintaan,
    // lalu baris sesi) dan tulisan kedua bisa gagal. Itu ditolak saat tinjauan
    // penulis spec, dengan alasan yang lebih baik: jangan memperlebar mesin
    // status secara permanen untuk menampung operasi yang tidak atomik —
    // jadikan operasinya atomik. Tugas 9 memindahkan konfirmasi ke satu fungsi
    // Postgres (pola `klaim_sudah_bayar` yang sudah dipakai repo ini), sehingga
    // kegagalan parsial lenyap sebagai KELAS masalah dan panah ini tidak
    // pernah dibutuhkan.
    expect(bolehPindahPermintaan("dikonfirmasi", "mitra_siap")).toBe(false);
    expect(PERPINDAHAN_PERMINTAAN.dikonfirmasi).toEqual([]);
  });

  it("keadaan akhir benar-benar akhir", () => {
    expect(PERPINDAHAN_PERMINTAAN.dikonfirmasi).toEqual([]);
    expect(PERPINDAHAN_PERMINTAAN.dibatalkan_klien).toEqual([]);
    expect(PERPINDAHAN_PERMINTAAN.ditolak).toEqual([]);
  });

  it("tidak ada perpindahan ke dirinya sendiri", () => {
    for (const s of STATUS_PERMINTAAN) {
      expect(PERPINDAHAN_PERMINTAAN[s]).not.toContain(s);
    }
  });

  it("setiap tujuan yang terdaftar adalah status yang benar-benar ada", () => {
    for (const s of STATUS_PERMINTAAN) {
      for (const tujuan of PERPINDAHAN_PERMINTAAN[s]) {
        expect(STATUS_PERMINTAAN).toContain(tujuan);
      }
    }
  });
});

describe("status sesi", () => {
  it("lima keadaan, memakai ejaan Indonesia", () => {
    expect([...STATUS_SESI].sort()).toEqual(
      ["berjalan", "dibatalkan_padma", "selesai", "terjadwal", "tidak_hadir"].sort(),
    );
  });

  it("setiap status sesi punya label", () => {
    for (const s of STATUS_SESI) expect(LABEL_SESI[s]).toBeTruthy();
  });

  it("jalur wajar sesi", () => {
    expect(bolehPindahSesi("terjadwal", "berjalan")).toBe(true);
    expect(bolehPindahSesi("berjalan", "selesai")).toBe(true);
    expect(bolehPindahSesi("terjadwal", "tidak_hadir")).toBe(true);
    expect(bolehPindahSesi("terjadwal", "dibatalkan_padma")).toBe(true);
  });

  it("sesi selesai tidak bisa diputar balik", () => {
    expect(bolehPindahSesi("selesai", "berjalan")).toBe(false);
    expect(bolehPindahSesi("selesai", "dibatalkan_padma")).toBe(false);
    expect(PERPINDAHAN_SESI.selesai).toEqual([]);
  });

  it("terjadwal -> selesai TETAP boleh: belum ada akun mitra yang menekan 'berangkat'", () => {
    // Spec "Di luar ruang lingkup": akun & panel mitra belum ada, jadi
    // `berjalan` ditandai admin dan seringkali dilewati sama sekali.
    expect(bolehPindahSesi("terjadwal", "selesai")).toBe(true);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `cd web && npx vitest run tests/jadwal-status.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/jadwal/status"`.

- [ ] **Step 3: Tulis modulnya**

Buat `web/src/lib/jadwal/status.ts`:

```ts
/**
 * SATU-SATUNYA tempat yang tahu nama-nama status pemesanan PADMA.
 *
 * Kenapa berkas ini ada, dan kenapa ia yang PERTAMA dikerjakan: mengganti nilai
 * enum adalah perubahan yang gagal DIAM-DIAM. Kode yang membandingkan dengan
 * nilai lama tidak melempar error — ia hanya berhenti cocok, dan akibatnya
 * berbentuk permintaan jadwal yang tidak pernah muncul di layar siapa pun
 * (spec C1 §"Risiko utama"). Perbandingan yang tersebar mustahil dijaga; yang
 * bisa dijaga hanyalah satu daftar dengan tipe yang mengikat.
 *
 * Berkas ini MURNI: tanpa satu pun impor. Ia dipakai server action, halaman
 * server, DAN komponen `"use client"` (blok antrean admin) — satu impor
 * Supabase di sini sudah cukup menyeret klien service role ke bundel peramban
 * (konvensi `src/lib/auth/pesan-undangan.ts`).
 *
 * ===== DUA OBJEK, RANTAI TERBELAH DI KONFIRMASI (spec J1) =====
 * Rantai yang diusulkan klien terbelah persis di `dikonfirmasi`: yang sebelumnya
 * adalah hidup sebuah PERMINTAAN, yang sesudahnya hidup sebuah SESI. Repo sudah
 * punya dua tabel itu dan pemisahannya sudah dikeraskan (migration
 * `20260829170000_sesi_dari_permintaan`: indeks unik supaya dua admin yang
 * menekan "Konfirmasi" bersamaan tidak melahirkan dua sesi). Karena itu rantai
 * dipasang pada dua objek, bukan dilebur jadi satu tabel berstatus panjang.
 *
 * ===== NAMA BERBAHASA INDONESIA =====
 * Usulan klien memakai `REQUESTED`/`MATCHING_MITRA`/`CONFIRMED`. Yang diadopsi
 * MODELNYA, bukan ejaannya: seluruh enum di repo ini berbahasa Indonesia
 * (`menunggu_verifikasi`, `terjadwal`, `belum`), dan menaruh `AWAITING_PAYMENT`
 * di sebelahnya membuat satu skema punya dua kosakata.
 *
 * ===== YANG SENGAJA BELUM ADA =====
 * `menunggu_bayar` (`AWAITING_PAYMENT`) milik C2, disisipkan antara `mitra_siap`
 * dan `dikonfirmasi`. Ia TIDAK dibuat sekarang: nilai enum yang belum dipakai
 * adalah keadaan mati di dalam basis data yang tidak satu pun kode tahu cara
 * keluar darinya.
 */

/**
 * Enum `booking_status` sesudah C1.
 *
 * `ditolak` masih ada dan sengaja dipertahankan (spec J8): nilainya tidak
 * dihapus, hanya tidak lagi terjangkau dari layar mana pun. Menghapus nilai
 * enum yang pernah dipakai berarti kehilangan riwayat permintaan lama.
 */
export const STATUS_PERMINTAAN = [
  "diminta",
  "mencari_mitra",
  "mitra_siap",
  "dikonfirmasi",
  "dibatalkan_klien",
  "ditolak",
] as const;

export type StatusPermintaan = (typeof STATUS_PERMINTAAN)[number];

/**
 * Keadaan yang berarti "masih di antrean" — inilah himpunan yang dihitung
 * `BATAS_PERMINTAAN_MENUNGGU` dan yang dijaga indeks dedup.
 *
 * Sebelum C1 himpunan ini hanya berisi satu nilai (`menunggu`), sehingga
 * perbandingannya bisa ditulis `eq("status", "menunggu")` di mana-mana. Sesudah
 * rantai diperpanjang ia berisi TIGA, dan setiap tempat yang lupa memperbarui
 * perbandingannya akan diam-diam menghitung antrean lebih pendek daripada yang
 * sebenarnya — artinya klien bisa melewati batasnya.
 */
export const STATUS_ANTRE: readonly StatusPermintaan[] = [
  "diminta",
  "mencari_mitra",
  "mitra_siap",
];

export const LABEL_PERMINTAAN: Record<StatusPermintaan, string> = {
  diminta: "Diminta",
  mencari_mitra: "Mencari bidan",
  mitra_siap: "Bidan siap",
  dikonfirmasi: "Dikonfirmasi",
  dibatalkan_klien: "Dibatalkan klien",
  ditolak: "Ditolak",
};

/**
 * Perpindahan yang SAH, sebagai peta dari keadaan asal ke daftar tujuan.
 *
 * Ditulis sebagai `Record<StatusPermintaan, …>` supaya TypeScript menolak build
 * begitu ada anggota enum yang tidak disebut — pola yang sama dengan
 * `LABEL_JENJANG` di `lib/transport/jarak.ts`.
 *
 * Catatan per baris, karena setiap panah di sini adalah keputusan:
 *
 *  - `mencari_mitra -> diminta` dan `mitra_siap -> mencari_mitra`: MUNDUR boleh.
 *    Mitra yang sudah dipilih bisa berhalangan sebelum konfirmasi, dan tanpa
 *    jalan mundur satu-satunya jalan keluar adalah membatalkan permintaan
 *    klien yang tidak melakukan kesalahan apa pun.
 *
 *  - `dikonfirmasi` TIDAK punya panah keluar sama sekali, termasuk panah mundur
 *    "pemulihan". Draf pertama rencana ini menyediakannya karena konfirmasi
 *    adalah dua tulisan (status permintaan, lalu baris sesi) dan tulisan kedua
 *    bisa gagal, meninggalkan permintaan tersangkut tanpa sesi. Jawaban yang
 *    dipilih bukan memperlebar mesin status melainkan MENGHILANGKAN kegagalan
 *    parsialnya: konfirmasi kini satu fungsi Postgres, satu transaksi (lihat
 *    migration `konfirmasi_atomik`). Mesin status tidak boleh melar untuk
 *    menampung operasi yang tidak atomik — operasinya yang dibuat atomik.
 *
 *  - Tidak ada panah dari `dikonfirmasi` ke `dibatalkan_klien`. Pembatalan sesi
 *    yang sudah terkonfirmasi menyangkut uang dan tenggat waktu; seluruhnya
 *    milik C3, dan ia bekerja pada `sessions`, bukan di sini (spec J8).
 */
export const PERPINDAHAN_PERMINTAAN: Record<StatusPermintaan, readonly StatusPermintaan[]> = {
  diminta: ["mencari_mitra", "dibatalkan_klien"],
  mencari_mitra: ["mitra_siap", "diminta", "dibatalkan_klien"],
  mitra_siap: ["dikonfirmasi", "mencari_mitra", "dibatalkan_klien"],
  dikonfirmasi: [],
  dibatalkan_klien: [],
  ditolak: [],
};

export function bolehPindahPermintaan(dari: StatusPermintaan, ke: StatusPermintaan): boolean {
  return PERPINDAHAN_PERMINTAAN[dari].includes(ke);
}

/**
 * Enum `session_status` sesudah C1.
 *
 * `batal` lama berganti nama menjadi `dibatalkan_padma` (spec J1): sesudah C3
 * ada dua pihak yang bisa membatalkan sesi, dan "batal" tidak menyebut siapa.
 */
export const STATUS_SESI = [
  "terjadwal",
  "berjalan",
  "selesai",
  "tidak_hadir",
  "dibatalkan_padma",
] as const;

export type StatusSesi = (typeof STATUS_SESI)[number];

export const LABEL_SESI: Record<StatusSesi, string> = {
  terjadwal: "Terjadwal",
  berjalan: "Berjalan",
  selesai: "Selesai",
  tidak_hadir: "Tidak hadir",
  dibatalkan_padma: "Dibatalkan PADMA",
};

/**
 * `terjadwal -> selesai` sengaja TETAP sah, berdampingan dengan
 * `terjadwal -> berjalan -> selesai`.
 *
 * Alasannya bukan kelonggaran melainkan kenyataan: akun dan panel mitra belum
 * ada (spec "Di luar ruang lingkup"), sehingga tidak ada seorang pun yang
 * menekan "berangkat" pada saat yang tepat. `berjalan` ditandai admin, dan
 * admin klinik sekecil ini akan sering melewatinya. Memaksa lewat `berjalan`
 * berarti memaksa admin berbohong tentang jam, atau membuat sesi yang benar
 * terjadi tidak pernah bisa ditandai selesai.
 */
export const PERPINDAHAN_SESI: Record<StatusSesi, readonly StatusSesi[]> = {
  terjadwal: ["berjalan", "selesai", "tidak_hadir", "dibatalkan_padma"],
  berjalan: ["selesai", "tidak_hadir"],
  selesai: [],
  tidak_hadir: [],
  dibatalkan_padma: [],
};

export function bolehPindahSesi(dari: StatusSesi, ke: StatusSesi): boolean {
  return PERPINDAHAN_SESI[dari].includes(ke);
}
```

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

Run: `cd web && npx vitest run tests/jadwal-status.test.ts`
Expected: PASS, seluruh assertion.

- [ ] **Step 5: Uji mutasi — buktikan uji ini benar-benar menjaga**

Pagar yang tidak pernah dibuktikan merah adalah pagar yang belum tentu ada. Lakukan tiga mutasi,
satu per satu, jalankan uji setiap kali, lalu PULIHKAN:

1. Hapus `"dibatalkan_klien"` dari `PERPINDAHAN_PERMINTAAN.diminta` → harus MERAH.
2. Tambahkan `"dikonfirmasi"` ke `PERPINDAHAN_PERMINTAAN.diminta` → harus MERAH.
3. Ganti `"mencari_mitra"` menjadi `"MATCHING_MITRA"` di `STATUS_PERMINTAAN` → harus MERAH.

Bila salah satunya tetap hijau, ujinya yang salah, bukan kodenya.

- [ ] **Step 6: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/src/lib/jadwal/status.ts web/tests/jadwal-status.test.ts
git commit -m "feat(jadwal): satu tempat untuk seluruh nilai & perpindahan status (J1)"
```

---

## Task 2: Modul jam — bentuk, daftar, dan aritmatika WIB

**Files:**
- Create: `web/src/lib/jadwal/jam.ts`
- Test: `web/tests/jadwal-jam.test.ts`

**Interfaces:**
- Consumes: tidak ada (murni).
- Produces:
  - `JAM_LAYANAN_BAWAAN: readonly string[]`
  - `bentukJamSah(jam: string): boolean`
  - `uraikanDaftarJam(mentah: string | null | undefined): string[]`
  - `formatJam(jam: string): string`
  - `instanSesi(tanggal: string, jam: string): Date`
  - `jamSampaiSesi(tanggal: string, jam: string, sekarang?: Date): number`

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/jadwal-jam.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  JAM_LAYANAN_BAWAAN,
  bentukJamSah,
  uraikanDaftarJam,
  formatJam,
  instanSesi,
  jamSampaiSesi,
} from "@/lib/jadwal/jam";

describe("bentuk jam", () => {
  it("menerima HH:MM 24 jam dengan nol di depan", () => {
    expect(bentukJamSah("09:00")).toBe(true);
    expect(bentukJamSah("00:00")).toBe(true);
    expect(bentukJamSah("23:59")).toBe(true);
  });

  it("menolak yang bukan HH:MM", () => {
    for (const buruk of ["9:00", "09:0", "24:00", "09:60", "09.00", "", "pagi", "09:00:00"]) {
      expect(bentukJamSah(buruk)).toBe(false);
    }
  });
});

describe("daftar jam dari pengaturan", () => {
  it("memisah dengan koma, merapikan spasi, membuang ganda, mengurutkan", () => {
    expect(uraikanDaftarJam(" 13:00, 09:00 ,09:00, 11:00 ")).toEqual([
      "09:00",
      "11:00",
      "13:00",
    ]);
  });

  it("membuang entri yang bentuknya salah, bukan menggagalkan seluruh daftar", () => {
    // Setelan diketik manusia lewat panel. Satu salah ketik tidak boleh
    // membuat formulir pemesanan kehilangan SELURUH pilihan jamnya.
    expect(uraikanDaftarJam("09:00, jam sembilan, 11:00")).toEqual(["09:00", "11:00"]);
  });

  it("jatuh ke daftar bawaan bila kosong, null, atau seluruhnya tidak sah", () => {
    expect(uraikanDaftarJam(null)).toEqual([...JAM_LAYANAN_BAWAAN]);
    expect(uraikanDaftarJam("")).toEqual([...JAM_LAYANAN_BAWAAN]);
    expect(uraikanDaftarJam("   ")).toEqual([...JAM_LAYANAN_BAWAAN]);
    expect(uraikanDaftarJam("pagi, siang")).toEqual([...JAM_LAYANAN_BAWAAN]);
  });

  it("daftar bawaan sendiri sah", () => {
    for (const j of JAM_LAYANAN_BAWAAN) expect(bentukJamSah(j)).toBe(true);
  });
});

describe("format tampilan", () => {
  it("memakai titik dan menyebut zona — 09.00 WIB", () => {
    expect(formatJam("09:00")).toBe("09.00 WIB");
    expect(formatJam("13:30")).toBe("13.30 WIB");
  });
});

describe("aritmatika waktu sesi", () => {
  it("merakit instan dari kalender Jakarta, bukan kalender mesin", () => {
    // 2026-09-10 09:00 WIB = 2026-09-10T02:00:00Z. Nilai ini benar di mesin
    // mana pun; itulah maksud offset tetap.
    expect(instanSesi("2026-09-10", "09:00").toISOString()).toBe("2026-09-10T02:00:00.000Z");
  });

  it("selisih jam dihitung dari instan, bukan dari selisih tanggal", () => {
    const sekarang = new Date("2026-09-10T02:00:00.000Z"); // 09.00 WIB
    expect(jamSampaiSesi("2026-09-10", "14:00", sekarang)).toBe(5);
    expect(jamSampaiSesi("2026-09-11", "09:00", sekarang)).toBe(24);
  });

  it("sesi yang sudah lewat bernilai negatif, bukan nol", () => {
    const sekarang = new Date("2026-09-10T02:00:00.000Z");
    expect(jamSampaiSesi("2026-09-10", "07:00", sekarang)).toBe(-2);
  });

  it("PERGANTIAN HARI JAKARTA vs UTC — inilah kesalahan yang paling mahal", () => {
    // 2026-09-09T20:00:00Z. Menurut UTC masih 9 September; menurut Jakarta
    // sudah 10 September pukul 03.00. Sesi 10 September 09.00 WIB tinggal
    // 6 jam lagi — bukan 30 jam seperti yang dihitung kalender mesin UTC.
    const sekarang = new Date("2026-09-09T20:00:00.000Z");
    expect(jamSampaiSesi("2026-09-10", "09:00", sekarang)).toBe(6);
  });

  it("batas 24 jam dan 2 jam C3 bisa dijawab dengan fungsi ini", () => {
    const sekarang = new Date("2026-09-10T02:00:00.000Z"); // 09.00 WIB
    expect(jamSampaiSesi("2026-09-11", "09:00", sekarang) >= 24).toBe(true);
    expect(jamSampaiSesi("2026-09-11", "08:59", sekarang) >= 24).toBe(false);
    expect(jamSampaiSesi("2026-09-10", "10:30", sekarang) < 2).toBe(true);
  });

  it("melempar untuk masukan yang tidak sah, tidak memulangkan NaN diam-diam", () => {
    expect(() => instanSesi("2026-09-10", "9:00")).toThrow();
    expect(() => instanSesi("10-09-2026", "09:00")).toThrow();
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `cd web && npx vitest run tests/jadwal-jam.test.ts`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Tulis modulnya**

Buat `web/src/lib/jadwal/jam.ts`:

```ts
/**
 * JAM SESI — bentuk, daftar pilihan, tampilan, dan aritmatika waktunya.
 *
 * Sebelum C1, satu-satunya keterangan waktu pada sebuah pemesanan adalah
 * `preferensi_waktu` (`pagi`/`siang`/`sore`) — sebuah PREFERENSI, bukan janji.
 * Seluruh kebijakan pembatalan klien bersandar pada "≥ 24 jam sebelum sesi" dan
 * "< 2 jam"; tanpa jam, tidak satu pun batas itu bisa dihitung (spec J2).
 *
 * Berkas ini MURNI — tanpa impor, sehingga aman dipakai komponen `"use client"`
 * (formulir pemesanan) maupun server.
 *
 * ===== KENAPA OFFSET TETAP +07:00, BUKAN Intl =====
 * `hariIniJakarta()` di `lib/passport/waktu.ts` memakai `Intl.DateTimeFormat`
 * untuk mendapatkan TANGGAL Jakarta, dan itu benar untuk pekerjaannya. Yang
 * dibutuhkan di sini berbeda: mengubah "10 September 2026 pukul 09.00 waktu
 * Jakarta" menjadi satu titik waktu absolut, supaya "berapa jam lagi" bisa
 * dihitung. Intl memformat instan menjadi teks; ia tidak mengurai teks menjadi
 * instan.
 *
 * WIB adalah offset TETAP +07:00. Indonesia tidak menjalankan daylight saving
 * (dan belum sejak 1964), jadi tidak ada tanggal dalam setahun di mana `+07:00`
 * menjadi salah. Itulah yang membuat `Date.parse` dengan offset eksplisit di
 * bawah sah — dan sekaligus alasan cara ini TIDAK boleh disalin untuk zona yang
 * ber-DST.
 *
 * Vercel berjalan UTC. Menghitung tenggat dengan kalender mesin akan menggeser
 * batasnya tujuh jam, dan pergeseran itu berbentuk uang klien yang hangus
 * sehari lebih awal (spec J2).
 */

/** Offset tetap WIB. Bukan tebakan — lihat dokblok di atas. */
const OFFSET_WIB = "+07:00";

const POLA_JAM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const POLA_TANGGAL = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Jam cadangan bila `app_settings.jam_layanan` belum diisi atau isinya tidak
 * masuk akal.
 *
 * Ini BUKAN "jam operasional PADMA yang sebenarnya" — nilai sungguhannya
 * ditetapkan klien lewat /admin/pengaturan, dan memang akan berubah (spec J2:
 * "perubahan seperti itu tidak boleh menuntut deploy"). Ia jaring pengaman
 * supaya formulir pemesanan tidak pernah terbit tanpa satu pun pilihan jam —
 * kegagalan senyap yang bentuknya sama persis dengan `https://wa.me/` kosong
 * yang sudah pernah terjadi di repo ini (lihat `lib/pengaturan/bentuk.ts`).
 */
export const JAM_LAYANAN_BAWAAN: readonly string[] = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
];

export function bentukJamSah(jam: string): boolean {
  return POLA_JAM.test(jam);
}

/**
 * Mengubah nilai setelan menjadi daftar jam yang boleh dipilih klien.
 *
 * Satu entri yang salah ketik DIBUANG, bukan menggagalkan seluruh daftar: nilai
 * ini diketik manusia di panel admin, dan formulir pemesanan yang kehilangan
 * seluruh pilihan jamnya karena satu koma nyasar adalah kegagalan yang jauh
 * lebih besar daripada satu jam yang hilang. Bila TIDAK ADA entri yang tersisa,
 * barulah daftar bawaan dipakai — supaya tidak pernah ada keadaan "nol pilihan".
 */
export function uraikanDaftarJam(mentah: string | null | undefined): string[] {
  const entri = (mentah ?? "")
    .split(",")
    .map((bagian) => bagian.trim())
    .filter((bagian) => bentukJamSah(bagian));

  const unik = [...new Set(entri)].sort();
  return unik.length > 0 ? unik : [...JAM_LAYANAN_BAWAAN];
}

/**
 * Tampilan untuk manusia. Bahasa Indonesia memakai TITIK sebagai pemisah jam
 * ("09.00"), dan zona disebut eksplisit karena klien membaca layar ini dari
 * mana saja.
 */
export function formatJam(jam: string): string {
  if (!bentukJamSah(jam)) throw new Error(`Jam tidak sah: ${jam}`);
  return `${jam.replace(":", ".")} WIB`;
}

/**
 * "Tanggal + jam menurut Jakarta" sebagai satu titik waktu absolut.
 *
 * MELEMPAR untuk masukan tak sah, tidak memulangkan `Invalid Date`. Tanggal
 * yang diam-diam menjadi NaN akan merambat menjadi tenggat yang diam-diam
 * menjadi NaN, dan perbandingan apa pun dengan NaN bernilai false — artinya
 * setiap pagar waktu terbuka tanpa satu pun galat di log.
 */
export function instanSesi(tanggal: string, jam: string): Date {
  if (!POLA_TANGGAL.test(tanggal)) throw new Error(`Tanggal tidak sah: ${tanggal}`);
  if (!bentukJamSah(jam)) throw new Error(`Jam tidak sah: ${jam}`);
  return new Date(`${tanggal}T${jam}:00${OFFSET_WIB}`);
}

/**
 * Berapa jam lagi sesinya, dari sudut pandang `sekarang`.
 *
 * Negatif berarti sudah lewat. Sengaja mengembalikan angka pecahan apa adanya
 * (bukan dibulatkan): pembulatan di dalam fungsi ini akan diam-diam memindahkan
 * batas "≥ 24 jam" milik C3, dan yang berpindah bersamanya adalah uang klien.
 * Pembulatan adalah urusan lapisan tampilan.
 */
export function jamSampaiSesi(tanggal: string, jam: string, sekarang: Date = new Date()): number {
  const sesi = instanSesi(tanggal, jam);
  return (sesi.getTime() - sekarang.getTime()) / 3_600_000;
}
```

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

Run: `cd web && npx vitest run tests/jadwal-jam.test.ts`
Expected: PASS.

- [ ] **Step 5: Uji mutasi**

1. Ganti `OFFSET_WIB` menjadi `"Z"` → uji "PERGANTIAN HARI JAKARTA vs UTC" harus MERAH.
2. Buat `uraikanDaftarJam` memulangkan `entri` tanpa `[...new Set()]` → uji "membuang ganda" MERAH.
3. Buat `instanSesi` memulangkan `new Date(NaN)` alih-alih melempar → uji "melempar" MERAH.

Pulihkan ketiganya.

- [ ] **Step 6: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/src/lib/jadwal/jam.ts web/tests/jadwal-jam.test.ts
git commit -m "feat(jadwal): jam sesi sebagai fungsi murni beroffset tetap WIB (J2)"
```

---

## Task 3: Migrasi rantai status — nilai enum, pagar, dan trigger perpindahan

Tugas paling berbahaya di rencana ini. Kerjakan dengan `git status` bersih dan seluruh uji hijau
lebih dulu, dan **umumkan ke sesi lain sebelum `db reset`** (Global Constraint 3).

**Files:**
- Create: `web/supabase/migrations/20260909100000_rantai_status_nilai.sql`
- Create: `web/supabase/migrations/20260909101000_rantai_status_pagar.sql`
- Test: `web/tests/rantai-status-db.test.ts`

**Interfaces:**
- Consumes: `STATUS_PERMINTAAN`, `PERPINDAHAN_PERMINTAAN`, `STATUS_SESI`, `PERPINDAHAN_SESI` dari
  Task 1 — uji di bawah membacanya dari modul itu, supaya daftar TypeScript dan enum Postgres tidak
  bisa berselisih diam-diam.
- Produces: enum `booking_status` = enam nilai baru; enum `session_status` = lima nilai baru; trigger
  `trg_guard_booking_perpindahan` dan `trg_guard_sesi_perpindahan`.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/rantai-status-db.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";
import {
  STATUS_PERMINTAAN,
  PERPINDAHAN_PERMINTAAN,
  STATUS_SESI,
  PERPINDAHAN_SESI,
  type StatusPermintaan,
} from "@/lib/jadwal/status";

/**
 * Enum Postgres dan daftar TypeScript adalah DUA daftar yang harus identik —
 * persis jenis kesalahan yang paling mudah terjadi dan paling sulit terlihat.
 * Karena itu uji ini membaca keduanya dan membandingkannya, bukan menulis
 * daftar ketiga.
 */
async function nilaiEnum(nama: string): Promise<string[]> {
  const baris = await querySql<{ label: string }>(
    `select e.enumlabel as label
       from pg_enum e
       join pg_type t on t.oid = e.enumtypid
      where t.typname = $1
      order by e.enumsortorder`,
    [nama],
  );
  return baris.map((b) => b.label);
}

describe("enum booking_status sesudah C1", () => {
  it("isinya persis daftar di lib/jadwal/status.ts", async () => {
    expect((await nilaiEnum("booking_status")).sort()).toEqual([...STATUS_PERMINTAAN].sort());
  });

  it("nilai lama 'menunggu' sudah tidak ada — ia BERGANTI NAMA, bukan ditambah", async () => {
    expect(await nilaiEnum("booking_status")).not.toContain("menunggu");
  });

  it("'ditolak' TETAP ada (spec J8: disembunyikan, bukan dihapus)", async () => {
    expect(await nilaiEnum("booking_status")).toContain("ditolak");
  });

  it("menunggu_bayar BELUM ada — itu milik C2", async () => {
    expect(await nilaiEnum("booking_status")).not.toContain("menunggu_bayar");
  });
});

describe("enum session_status sesudah C1", () => {
  it("isinya persis daftar di lib/jadwal/status.ts", async () => {
    expect((await nilaiEnum("session_status")).sort()).toEqual([...STATUS_SESI].sort());
  });

  it("'batal' sudah tidak ada — ia berganti nama menjadi dibatalkan_padma", async () => {
    expect(await nilaiEnum("session_status")).not.toContain("batal");
  });
});

describe("trigger perpindahan permintaan", () => {
  it("menolak setiap perpindahan yang TIDAK ada di peta, menerima yang ada", async () => {
    // Diuji lewat fungsi penilai yang sama dengan yang dipakai trigger, di
    // dalam satu query — tanpa membuat baris fixture apa pun.
    for (const dari of STATUS_PERMINTAAN) {
      for (const ke of STATUS_PERMINTAAN) {
        if (dari === ke) continue;
        const [{ hasil }] = await querySql<{ hasil: boolean }>(
          "select public.perpindahan_permintaan_sah($1::booking_status, $2::booking_status) as hasil",
          [dari, ke],
        );
        const diharapkan = PERPINDAHAN_PERMINTAAN[dari as StatusPermintaan].includes(ke);
        expect(
          hasil,
          `perpindahan ${dari} -> ${ke} seharusnya ${diharapkan ? "SAH" : "DITOLAK"}`,
        ).toBe(diharapkan);
      }
    }
  });
});

describe("trigger perpindahan sesi", () => {
  it("menolak setiap perpindahan yang TIDAK ada di peta, menerima yang ada", async () => {
    for (const dari of STATUS_SESI) {
      for (const ke of STATUS_SESI) {
        if (dari === ke) continue;
        const [{ hasil }] = await querySql<{ hasil: boolean }>(
          "select public.perpindahan_sesi_sah($1::session_status, $2::session_status) as hasil",
          [dari, ke],
        );
        expect(hasil, `sesi ${dari} -> ${ke}`).toBe(PERPINDAHAN_SESI[dari].includes(ke));
      }
    }
  });
});

describe("indeks antrean mengikuti rantai yang diperpanjang", () => {
  it("dedup & batas antrean berlaku untuk KETIGA keadaan sebelum konfirmasi", async () => {
    const [{ def }] = await querySql<{ def: string }>(
      "select indexdef as def from pg_indexes where indexname = 'booking_requests_antrean_unik'",
    );
    // Bila predikatnya masih menyebut satu status saja, klien bisa mengirim
    // permintaan kembar begitu yang pertama pindah ke 'mencari_mitra'.
    expect(def).toContain("diminta");
    expect(def).toContain("mencari_mitra");
    expect(def).toContain("mitra_siap");
  });
});

describe("tidak ada nilai status lama yang tertinggal di kode SQL", () => {
  it("tak satu pun fungsi plpgsql masih menyebut 'menunggu' sebagai status permintaan", async () => {
    // Fungsi plpgsql menyimpan literalnya sebagai TEKS. Sesudah RENAME VALUE,
    // literal lama tidak lagi menjadi anggota enum — dan pemanggilannya gagal
    // 22P02 saat dijalankan, bukan saat migrasi. Ini pagar yang menangkapnya
    // lebih awal.
    const baris = await querySql<{ nama: string }>(
      `select p.proname as nama
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosrc like '%''menunggu''::booking_status%'`,
    );
    expect(baris.map((b) => b.nama)).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `cd web && npx vitest run tests/rantai-status-db.test.ts`
Expected: FAIL — enum masih `menunggu/dikonfirmasi/ditolak`, dan `perpindahan_permintaan_sah` belum
ada.

- [ ] **Step 3: Tulis migrasi PERTAMA — hanya nilai enum**

Buat `web/supabase/migrations/20260909100000_rantai_status_nilai.sql`:

```sql
-- ============================================================================
-- RANTAI STATUS C1 (1/2): NILAI ENUM
-- ============================================================================
-- Berkas ini HANYA memindahkan nama dan menambah anggota enum. Tidak ada satu
-- pun indeks, fungsi, atau CHECK di sini — semuanya di berkas berikutnya.
--
-- Alasannya bukan kerapian melainkan batasan Postgres yang sudah DIPROBE
-- langsung di basis data lokal (8 Sep 2026):
--
--   begin;
--   alter type booking_status add value 'coba';
--   select 'coba'::booking_status;
--   -- ERROR: 55P04 unsafe use of new value "coba" of enum type booking_status
--
-- Nilai yang BARU ditambahkan tidak boleh dipakai di transaksi yang sama. Satu
-- berkas migrasi dijalankan sebagai satu transaksi, jadi predikat indeks atau
-- CHECK yang menyebut 'mencari_mitra' di sini akan menggagalkan seluruh
-- migrasi. RENAME tidak punya batasan itu (juga diprobe: rename lalu pakai di
-- transaksi yang sama BERHASIL) — tetapi nilai yang ditambah tetap tidak boleh,
-- jadi pemisahannya tetap wajib.
--
-- Rantai yang dipasang (spec C1 J1), berbahasa Indonesia karena SELURUH enum
-- repo ini berbahasa Indonesia; yang diadopsi dari usulan klien adalah
-- modelnya, bukan ejaannya:
--
--   booking_requests: diminta -> mencari_mitra -> mitra_siap -> dikonfirmasi
--                     (dan dibatalkan_klien dari ketiga keadaan pertama)
--   sessions:         terjadwal -> berjalan -> selesai
--                     (dan tidak_hadir / dibatalkan_padma)
--
-- `menunggu_bayar` SENGAJA TIDAK ADA. Ia milik C2, disisipkan antara
-- `mitra_siap` dan `dikonfirmasi`. Nilai enum yang belum dipakai adalah keadaan
-- mati di dalam basis data yang tidak satu pun kode tahu cara keluar darinya.

-- ===== PERMINTAAN =====
-- RENAME, bukan ADD + backfill + DROP: baris permintaan yang sudah ada tetap
-- berarti hal yang sama persis. 'menunggu' dan 'diminta' adalah nama untuk
-- keadaan yang identik.
alter type booking_status rename value 'menunggu' to 'diminta';

alter type booking_status add value 'mencari_mitra' after 'diminta';
alter type booking_status add value 'mitra_siap' after 'mencari_mitra';
alter type booking_status add value 'dibatalkan_klien';

-- 'ditolak' TIDAK disentuh (spec J8): nilainya dipertahankan supaya permintaan
-- lama yang pernah ditolak tetap terbaca, hanya tidak lagi terjangkau dari
-- layar mana pun.

-- ===== SESI =====
-- 'batal' berganti nama: sesudah C3 ada DUA pihak yang bisa membatalkan sesi,
-- dan "batal" tidak menyebut siapa. Nama yang tidak menyebut pelakunya adalah
-- nama yang akan salah dibaca begitu pihak kedua muncul.
alter type session_status rename value 'batal' to 'dibatalkan_padma';

alter type session_status add value 'berjalan' after 'terjadwal';
alter type session_status add value 'tidak_hadir' after 'selesai';
```

- [ ] **Step 4: Tulis migrasi KEDUA — pagar & perpindahan**

Buat `web/supabase/migrations/20260909101000_rantai_status_pagar.sql`:

```sql
-- ============================================================================
-- RANTAI STATUS C1 (2/2): PAGAR, INDEKS, DAN PERPINDAHAN
-- ============================================================================
-- Berkas terpisah dari yang menambah nilai enum — lihat alasan 55P04 di sana.
--
-- Tiga hal dikerjakan di sini:
--   1. indeks antrean mengikuti rantai yang kini punya TIGA keadaan pra-konfirmasi;
--   2. dua penjaga lama (`guard_booking_status`, `guard_booking_pembatas`) ditulis
--      ulang karena keduanya menyimpan literal 'menunggu' sebagai TEKS di dalam
--      badan fungsi — sesudah RENAME literal itu bukan lagi anggota enum, dan
--      pemanggilannya akan gagal 22P02 saat dijalankan, bukan saat migrasi;
--   3. penjaga BARU: perpindahan status yang sah.
--
-- Kenapa penjaga perpindahan ada di DB dan bukan cukup di server action: klien
-- memegang policy INSERT atas `booking_requests` dan bisa memanggil PostgREST
-- langsung dengan anon key + JWT-nya sendiri — persis alasan
-- `guard_booking_pembatas` ada. Dan staf memegang policy `for all`, sehingga
-- satu server action baru yang lupa memeriksa urutan sudah cukup untuk membuat
-- permintaan melompat dari 'diminta' ke 'dikonfirmasi' tanpa pernah punya mitra.

-- ---------------------------------------------------------------------------
-- (1) INDEKS ANTREAN
--
-- Predikat lama `where status = 'menunggu'` kini terbaca `where status =
-- 'diminta'` (RENAME mempertahankan indeks apa adanya), dan itu SALAH sesudah
-- rantai diperpanjang: begitu admin menekan "Cari bidan", permintaan pindah ke
-- 'mencari_mitra' dan keluar dari predikat — sehingga klien bisa mengirim
-- permintaan kembar untuk tanggal, jam, dan layanan yang sama.
drop index if exists public.booking_requests_antrean_unik;

create unique index booking_requests_antrean_unik
  on public.booking_requests (client_id, service_id, tanggal, preferensi_waktu)
  where status in ('diminta', 'mencari_mitra', 'mitra_siap');

comment on index public.booking_requests_antrean_unik is
  'Dedup ANTREAN, bukan RIWAYAT: permintaan yang sudah dikonfirmasi/dibatalkan '
  'tidak boleh menghalangi klien mengajukan hal serupa lagi. Ketiga keadaan '
  'pra-konfirmasi ikut karena ketiganya masih menunggu jawaban PADMA.';

-- ---------------------------------------------------------------------------
-- (2a) PENJAGA NILAI STATUS — ditulis ulang untuk nama baru.
--
-- Isi aturannya TIDAK berubah dari versi 20260829130000: permintaan baru dari
-- klien selalu berstatus awal, dan klien tidak boleh menggeser status sama
-- sekali. Yang berubah hanya nama keadaan awalnya. Kelonggaran untuk pembatalan
-- oleh klien (spec J8) datang di migration `pembatalan_oleh_klien`, BUKAN di
-- sini — supaya perubahan nama dan perubahan kewenangan tidak bercampur dalam
-- satu diff yang tidak bisa dibaca.
create or replace function public.guard_booking_status()
returns trigger
language plpgsql
as $$
begin
  -- Bersarang, bukan `and`: plpgsql tidak menjamin short-circuit.
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if user_role() = 'klien' then
      if tg_op = 'INSERT' and new.status is distinct from 'diminta'::booking_status then
        raise exception 'permintaan jadwal baru selalu berstatus diminta'
          using errcode = '42501';
      end if;
      if tg_op = 'UPDATE' and new.status is distinct from old.status then
        raise exception 'status permintaan jadwal hanya boleh diubah staf'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_booking_status() from public, anon;

-- ---------------------------------------------------------------------------
-- (2b) PEMBATAS ANTREAN — ditulis ulang untuk rantai yang lebih panjang.
--
-- Perubahan tunggalnya ada pada hitungan antrean: `status = 'menunggu'` menjadi
-- `status in (…)` atas ketiga keadaan pra-konfirmasi. Tanpa itu, batas 5
-- permintaan bisa dilewati begitu admin memindahkan satu permintaan ke
-- 'mencari_mitra' — permintaan itu keluar dari hitungan sementara klien masih
-- benar-benar menunggu jawabannya.
--
-- Sisa badan fungsi disalin apa adanya dari 20260829140000, TERMASUK komentar
-- alasannya, karena `create or replace function` mengganti seluruh badan: apa
-- yang tidak disalin, hilang. Kunci advisory per-klien tetap diambil SEBELUM
-- hitungan — tanpa itu 50 insert paralel membaca angka yang sama (0) lalu
-- semuanya lolos.
create or replace function public.guard_booking_pembatas()
returns trigger
language plpgsql
as $$
declare
  batas constant int := 5;  -- sinkron dengan BATAS_PERMINTAAN_MENUNGGU
  antre int;
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if user_role() = 'klien' then

      -- (a) Layanan harus AKTIF. FK hanya menjamin baris itu ada.
      if not exists (
        select 1 from public.services s
         where s.id = new.service_id and s.aktif
      ) then
        raise exception 'layanan tidak tersedia untuk permintaan jadwal'
          using errcode = '42501';
      end if;

      -- (b) Tanggal tidak boleh di masa lalu, menurut kalender ASIA/JAKARTA —
      --     bukan jam server. Server berjalan UTC, dan antara 17:00–24:00 UTC
      --     tanggal Jakarta sudah besok.
      if new.tanggal < (now() at time zone 'Asia/Jakarta')::date then
        raise exception 'tanggal permintaan jadwal tidak boleh di masa lalu'
          using errcode = '42501';
      end if;

      -- (c) Batas panjang antrean, dengan kunci advisory per-klien lebih dulu.
      perform pg_advisory_xact_lock(
        hashtext('booking_requests:antrean'),
        hashtext(new.client_id::text)
      );

      select count(*) into antre
        from public.booking_requests b
       where b.client_id = new.client_id
         and b.status in ('diminta', 'mencari_mitra', 'mitra_siap');

      if antre >= batas then
        raise exception
          'permintaan jadwal yang masih menunggu sudah mencapai batas (%)', batas
          using errcode = '42501';
      end if;

    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_booking_pembatas() from public, anon;

-- ---------------------------------------------------------------------------
-- (3) PERPINDAHAN STATUS YANG SAH
--
-- Dipisah menjadi FUNGSI PENILAI (`…_sah`) dan TRIGGER, bukan satu badan
-- trigger raksasa. Alasannya bisa diuji: fungsi penilai dapat dipanggil
-- langsung dari uji untuk SELURUH pasangan (dari, ke) — 30 pasangan untuk
-- permintaan, 20 untuk sesi — tanpa membuat satu pun baris fixture. Trigger
-- saja hanya bisa diuji lewat baris nyata, dan uji yang mahal adalah uji yang
-- lubangnya tidak pernah ditutup.
--
-- Petanya WAJIB identik dengan `PERPINDAHAN_PERMINTAAN` di
-- src/lib/jadwal/status.ts. Dua daftar yang harus identik adalah jenis
-- kesalahan yang paling mudah terjadi; karena itu
-- tests/rantai-status-db.test.ts membaca KEDUANYA dan membandingkannya,
-- alih-alih menulis daftar ketiga.
create or replace function public.perpindahan_permintaan_sah(
  dari booking_status,
  ke booking_status
) returns boolean
language sql
immutable
as $$
  select case dari
    when 'diminta'          then ke in ('mencari_mitra', 'dibatalkan_klien')
    when 'mencari_mitra'    then ke in ('mitra_siap', 'diminta', 'dibatalkan_klien')
    when 'mitra_siap'       then ke in ('dikonfirmasi', 'mencari_mitra', 'dibatalkan_klien')
    -- Tidak ada panah keluar dari 'dikonfirmasi', termasuk panah mundur
    -- "pemulihan": konfirmasi dikerjakan sebagai SATU transaksi lewat
    -- `konfirmasi_permintaan()` (migration konfirmasi_atomik), jadi tidak ada
    -- keadaan setengah jadi yang perlu diputar balik.
    when 'dikonfirmasi'     then false
    when 'dibatalkan_klien' then false
    when 'ditolak'          then false
  end;
$$;

revoke execute on function public.perpindahan_permintaan_sah(booking_status, booking_status)
  from public, anon;

-- ===== PENJAGA INTEGRITAS TIDAK BERGERBANG PERAN =====
-- Perhatikan bahwa fungsi di bawah TIDAK dibungkus
-- `if current_user in ('anon','authenticated','authenticator') and user_role() = 'klien'`,
-- berbeda dari `guard_booking_status` beberapa puluh baris di atas.
--
-- Itu disengaja, dan bukan kelalaian menyalin. Kedua fungsi menjawab pertanyaan
-- yang berbeda:
--
--   * `guard_booking_status` adalah penjaga OTORISASI — "SIAPA boleh mengubah
--     status". Pertanyaan itu memang tentang peran, jadi bungkus peran ada di
--     tempat yang benar.
--   * fungsi ini penjaga INTEGRITAS — "perpindahan mana yang MASUK AKAL".
--     Jawabannya sama untuk siapa pun. Menyalin bungkus peran ke sini akan
--     membebaskan SELURUH jalur service role — seed, skrip uji, migrasi
--     mendatang — untuk membuat perpindahan ilegal tanpa satu pun keluhan, dan
--     justru di jalur itulah data rusak paling sering lahir.
--
-- Aturannya: penjaga otorisasi bergerbang peran; invarian integritas tidak.
-- (Ditemukan saat tinjauan penulis spec, 8 Sep 2026 — `guard_booking_status`
-- adalah template yang paling menggoda untuk disalin di berkas ini.)
create or replace function public.guard_booking_perpindahan()
returns trigger
language plpgsql
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not public.perpindahan_permintaan_sah(old.status, new.status) then
    raise exception 'perpindahan status permintaan tidak sah: % -> %', old.status, new.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_booking_perpindahan() from public, anon;

create trigger trg_guard_booking_perpindahan
  before update on public.booking_requests
  for each row execute function public.guard_booking_perpindahan();

-- ---------------------------------------------------------------------------
-- (4) PERPINDAHAN STATUS SESI
--
-- `terjadwal -> selesai` SENGAJA sah berdampingan dengan
-- `terjadwal -> berjalan -> selesai`: akun dan panel mitra belum ada (spec
-- "Di luar ruang lingkup"), jadi 'berjalan' ditandai admin dan akan sering
-- dilewati. Memaksa lewat 'berjalan' berarti memaksa admin berbohong tentang
-- jam, atau membuat sesi yang benar-benar terjadi tidak pernah bisa ditandai
-- selesai.
create or replace function public.perpindahan_sesi_sah(
  dari session_status,
  ke session_status
) returns boolean
language sql
immutable
as $$
  select case dari
    when 'terjadwal'        then ke in ('berjalan', 'selesai', 'tidak_hadir', 'dibatalkan_padma')
    when 'berjalan'         then ke in ('selesai', 'tidak_hadir')
    when 'selesai'          then false
    when 'tidak_hadir'      then false
    when 'dibatalkan_padma' then false
  end;
$$;

revoke execute on function public.perpindahan_sesi_sah(session_status, session_status)
  from public, anon;

create or replace function public.guard_sesi_perpindahan()
returns trigger
language plpgsql
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not public.perpindahan_sesi_sah(old.status, new.status) then
    raise exception 'perpindahan status sesi tidak sah: % -> %', old.status, new.status
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_sesi_perpindahan() from public, anon;

create trigger trg_guard_sesi_perpindahan
  before update on public.sessions
  for each row execute function public.guard_sesi_perpindahan();
```

- [ ] **Step 5: Terapkan migrasi ke basis data lokal — SESUDAH mengumumkan**

Kirim pesan ke seluruh sesi aktif lebih dulu:

```
ListAgents
SendMessage ke tiap sesi padma-*/backend-platform-* :
"padma-0e akan menjalankan `npx supabase db reset` untuk migrasi C1 dalam ~2 menit.
Hentikan run vitest Anda dan balas kalau ada migrasi belum ter-merge di worktree Anda."
```

Tunggu balasan, baru:

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx supabase db reset
```

Expected: seluruh migrasi terterapkan tanpa galat. **Bila muncul `55P04`**, berarti dua berkas
migrasi di atas tergabung dalam satu transaksi — pisahkan lebih jauh (satu `add value` per berkas)
dan ulangi. **Bila muncul `22P02 invalid input value for enum`**, ada fungsi/CHECK lain yang masih
menyebut nilai lama: cari dengan

```bash
cd /Users/arvinfairuz/Documents/padma/web && grep -rn "'menunggu'\|'batal'" supabase/migrations/
```

- [ ] **Step 6: Jalankan uji, pastikan HIJAU**

Run: `cd web && npx vitest run tests/rantai-status-db.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/supabase/migrations/20260909100000_rantai_status_nilai.sql \
        web/supabase/migrations/20260909101000_rantai_status_pagar.sql \
        web/tests/rantai-status-db.test.ts
git commit -m "feat(db): rantai status dua objek + trigger perpindahan (J1)"
```

---

## Task 4: Sapuan — setiap perbandingan status melewati modul Task 1

Sesudah Task 3, basis data memakai nama baru sementara seluruh TypeScript masih menyebut nama lama.
Aplikasi **tidak akan error**; ia hanya berhenti cocok, dan antrean admin menjadi kosong selamanya.
Tugas ini yang menutupnya.

**Files:**
- Modify: `web/src/app/admin/sesi/status.ts` (buang daftar status, impor ulang dari `lib/jadwal/status`)
- Modify: `web/src/app/admin/sesi/aksi.ts`, `web/src/app/admin/sesi/page.tsx`
- Modify: `web/src/lib/passport/aksi.ts`, `web/src/lib/passport/data.ts`
- Modify: `web/src/lib/admin/agenda.ts`, `web/src/lib/admin/antrean.ts`, `web/src/lib/admin/sesi.ts`
- Modify: `web/src/lib/owner/data.ts`, `web/src/app/passport/page.tsx`
- Modify: berkas uji yang menyebut status lama (temukan lewat grep; ~17 titik insert
  `booking_requests` dan seluruh assertion `"menunggu"`/`"batal"`)
- Test: `web/tests/status-satu-sumber.test.ts` (baru)

**Interfaces:**
- Consumes: seluruh ekspor Task 1.
- Produces: tidak ada API baru. `src/app/admin/sesi/status.ts` mengekspor ULANG
  `STATUS_PERMINTAAN`/`LABEL_PERMINTAAN`/`STATUS_SESI`/`LABEL_SESI` dari `lib/jadwal/status` supaya
  pemanggil lama tidak perlu disunting dua kali.

- [ ] **Step 1: Tulis pagar yang gagal**

Buat `web/tests/status-satu-sumber.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Pagar SUMBER, bukan pagar perilaku.
 *
 * Uji perilaku hanya menjaga jalur yang kebetulan dilewatinya. Yang perlu
 * dijaga di sini adalah SELURUH kode: begitu satu berkas menulis literal
 * "menunggu" sebagai status permintaan, ia berhenti cocok dengan basis data
 * tanpa satu pun error — dan akibatnya berbentuk permintaan yang tidak muncul
 * di layar siapa pun (spec C1 §"Risiko utama").
 *
 * Pemindaiannya mencari literal nilai status, dan mengecualikan berkas yang
 * memang BOLEH menyebutnya: modul sumbernya sendiri.
 */
const AKAR = path.resolve(__dirname, "..", "src");
const SUMBER_SAH = path.join(AKAR, "lib", "jadwal", "status.ts");

/** Nilai lama yang sudah tidak ada di basis data mana pun. */
const NILAI_MATI = ["'menunggu'", '"menunggu"', "'batal'", '"batal"'];

function berkasTs(dir: string): string[] {
  const hasil: string[] = [];
  for (const entri of readdirSync(dir, { withFileTypes: true })) {
    const penuh = path.join(dir, entri.name);
    if (entri.isDirectory()) hasil.push(...berkasTs(penuh));
    else if (entri.name.endsWith(".ts") || entri.name.endsWith(".tsx")) hasil.push(penuh);
  }
  return hasil;
}

/** Komentar dilucuti dulu — penjelasan riwayat BOLEH menyebut nama lama. */
function tanpaKomentar(isi: string): string {
  return isi.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("satu sumber nilai status", () => {
  const berkas = berkasTs(AKAR).filter((f) => f !== SUMBER_SAH);

  it("tidak ada kode yang masih menyebut nilai status lama", () => {
    const pelanggar: string[] = [];
    for (const f of berkas) {
      const kode = tanpaKomentar(readFileSync(f, "utf8"));
      for (const mati of NILAI_MATI) {
        // `menunggu_verifikasi` adalah enum pay_status yang SAH dan tidak
        // disentuh C1 — literalnya berbeda, jadi pencocokan penuh di atas
        // (dengan kutip di kedua sisi) sudah memisahkannya.
        if (kode.includes(mati)) pelanggar.push(`${path.relative(AKAR, f)} → ${mati}`);
      }
    }
    expect(pelanggar).toEqual([]);
  });

  it("nilai status baru pun tidak ditulis literal di luar modulnya", () => {
    const pelanggar: string[] = [];
    for (const f of berkas) {
      const kode = tanpaKomentar(readFileSync(f, "utf8"));
      for (const nilai of ["'diminta'", '"diminta"', "'mitra_siap'", '"mitra_siap"']) {
        if (kode.includes(nilai)) pelanggar.push(`${path.relative(AKAR, f)} → ${nilai}`);
      }
    }
    expect(pelanggar).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `cd web && npx vitest run tests/status-satu-sumber.test.ts`
Expected: FAIL dengan daftar panjang berkas pelanggar. **Salin daftar itu** — itulah peta kerja
langkah berikutnya.

- [ ] **Step 3: Sapu berkas demi berkas**

Untuk setiap pelanggar, ganti literal dengan nilai dari modul. Contoh nyata, `src/lib/passport/aksi.ts`:

```ts
// SEBELUM
  const { count } = await supabase
    .from("booking_requests")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("status", "menunggu");

// SESUDAH
import { STATUS_ANTRE } from "@/lib/jadwal/status";
// …
  const { count } = await supabase
    .from("booking_requests")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    // `in`, bukan `eq`: sesudah C1 ada TIGA keadaan yang berarti "masih
    // menunggu jawaban PADMA", dan ketiganya mengisi kuota klien.
    .in("status", STATUS_ANTRE);
```

Dan `src/app/admin/sesi/status.ts` — daftarnya dibuang, diganti ekspor ulang:

```ts
// Status permintaan & sesi kini hidup di `lib/jadwal/status.ts` — SATU-SATUNYA
// sumbernya. Berkas ini mengekspornya ULANG untuk pemanggil lama, mengikuti
// arah kebergantungan yang sudah ditetapkan Ruling 20 untuk `LABEL_JENJANG`:
// `lib/` adalah lapisan domain, `app/` lapisan presentasi, dan domain tidak
// boleh diimpor nilainya dari presentasi.
export {
  STATUS_PERMINTAAN as STATUS_PERMINTAAN_SAH,
  LABEL_PERMINTAAN as LABEL_STATUS_PERMINTAAN,
  STATUS_SESI as STATUS_SESI_SAH,
  LABEL_SESI as LABEL_STATUS_SESI,
  type StatusPermintaan,
  type StatusSesi,
} from "@/lib/jadwal/status";
```

`KELAS_PILL` di `src/app/admin/sesi/page.tsx` wajib menyebut kelima status sesi — `Record<StatusSesi,
string>` akan menolak build bila ada yang terlewat:

```tsx
const KELAS_PILL: Record<StatusSesi, string> = {
  terjadwal: "bg-gold/15 text-[#8A6A16]",
  berjalan: "bg-leaf/15 text-leaf",
  selesai: "bg-leaf-soft text-leaf",
  tidak_hadir: "bg-clay/10 text-clay",
  dibatalkan_padma: "bg-black/5 text-ink-soft",
};
```

`konfirmasiPermintaan` di `src/app/admin/sesi/aksi.ts`: di tugas ini **cukup ganti namanya saja** —
klaim `eq("status","menunggu")` menjadi `eq("status", "mitra_siap")` lewat konstanta, dan
kompensasi `update({ status: "menunggu" })` menjadi `mitra_siap`, supaya aplikasi tetap berjalan
sesudah Task 4. Kompensasi itu **dibuang seluruhnya di Tugas 9**, ketika konfirmasi pindah ke satu
fungsi Postgres dan kegagalan parsial berhenti menjadi keadaan yang mungkin. Jangan merapikannya di
sini; ia akan dihapus.

Nilai statusnya tetap ditulis di
server (tidak pernah menjadi parameter) — yang berubah hanya dari mana namanya datang. Bila Anda
butuh satu nilai tunggal dan bukan daftar, tambahkan konstanta bernama di `lib/jadwal/status.ts`
(mis. `export const PERMINTAAN_SIAP_KONFIRMASI = "mitra_siap" as const;`) alih-alih menulis
literalnya kembali — pagar Step 1 memang melarangnya.

- [ ] **Step 4: Sapu berkas uji**

Berkas uji juga menyebut status lama. Temukan:

```bash
cd /Users/arvinfairuz/Documents/padma/web
grep -rn "\"menunggu\"\|'menunggu'\|\"batal\"\|'batal'" tests/ | grep -v menunggu_verifikasi
```

Ganti setiap fixture `status: "menunggu"` menjadi `status: "diminta"`, dan setiap assertion sesi
`"batal"` menjadi `"dibatalkan_padma"`. Uji BOLEH menulis literal (pagar Step 1 hanya memindai
`src/`) — tetapi bila sebuah berkas uji menyebutnya lebih dari dua kali, impor dari modulnya.

- [ ] **Step 5: Jalankan seluruh uji, pastikan HIJAU**

Umumkan dulu (Global Constraint 3), lalu:

Run: `cd web && npm test`
Expected: PASS seluruhnya. Yang paling mungkin merah: `tests/admin-sesi-konfirmasi.test.ts`,
`tests/passport-pembatas-jadwal.test.ts`, `tests/passport-data.test.ts`, `tests/admin-agenda.test.ts`,
`tests/schema.test.ts`. Perbaiki satu per satu; jangan melonggarkan assertion untuk membuatnya hijau.

- [ ] **Step 6: Buktikan bundel peramban tidak menyeret apa pun**

`lib/jadwal/status.ts` diimpor komponen `"use client"` (blok antrean admin). Pastikan ia tidak
menarik Supabase:

```bash
cd /Users/arvinfairuz/Documents/padma/web && npm run build
grep -rl "SUPABASE_SERVICE_ROLE\|service_role" .next/static/chunks/ | head
```

Expected: tidak ada keluaran dari `grep`.

- [ ] **Step 7: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add -A web/src web/tests
git commit -m "refactor(status): seluruh perbandingan status lewat satu modul (J1)"
```

---

## Task 5: Kolom jam mulai di basis data

**Files:**
- Create: `web/supabase/migrations/20260909110000_jam_sesi.sql`
- Test: `web/tests/jam-sesi-db.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `booking_requests.jam_mulai time not null`, `sessions.jam_mulai time not null`.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/jam-sesi-db.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";

async function kolom(tabel: string, nama: string) {
  const baris = await querySql<{ tipe: string; nullable: string; bawaan: string | null }>(
    `select data_type as tipe, is_nullable as nullable, column_default as bawaan
       from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [tabel, nama],
  );
  return baris[0];
}

describe("jam mulai (spec J2)", () => {
  it("booking_requests.jam_mulai bertipe time dan WAJIB", async () => {
    const k = await kolom("booking_requests", "jam_mulai");
    expect(k?.tipe).toBe("time without time zone");
    expect(k?.nullable).toBe("NO");
  });

  it("sessions.jam_mulai bertipe time dan WAJIB", async () => {
    const k = await kolom("sessions", "jam_mulai");
    expect(k?.tipe).toBe("time without time zone");
    expect(k?.nullable).toBe("NO");
  });

  it("TANPA nilai bawaan — jam adalah pilihan klien, bukan angka yang muncul sendiri", async () => {
    // Bawaan yang tertinggal membuat setiap insert yang LUPA menyebut jam
    // tersimpan diam-diam dengan jam yang tidak pernah dipilih siapa pun, dan
    // klien menemukannya saat bidan datang di jam yang salah.
    expect((await kolom("booking_requests", "jam_mulai"))?.bawaan).toBeNull();
    expect((await kolom("sessions", "jam_mulai"))?.bawaan).toBeNull();
  });

  it("preferensi_waktu TIDAK dihapus — ia kini berarti alternatif (spec J2)", async () => {
    expect((await kolom("booking_requests", "preferensi_waktu"))?.nullable).toBe("NO");
  });

  it("jam hanya boleh pada menit bulat :00 atau :30", async () => {
    const baris = await querySql<{ nama: string }>(
      `select conname as nama from pg_constraint
        where conrelid = 'public.booking_requests'::regclass
          and conname = 'booking_requests_jam_bulat'`,
    );
    expect(baris.length).toBe(1);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `cd web && npx vitest run tests/jam-sesi-db.test.ts`
Expected: FAIL — kolomnya belum ada (`k` undefined).

- [ ] **Step 3: Tulis migrasi**

Buat `web/supabase/migrations/20260909110000_jam_sesi.sql`:

```sql
-- ============================================================================
-- JAM MULAI PADA PERMINTAAN DAN SESI (spec C1 J2)
-- ============================================================================
-- `sessions.tanggal` bertipe `date`. Satu-satunya keterangan waktu yang pernah
-- ada adalah `booking_requests.preferensi_waktu` ('pagi'/'siang'/'sore') —
-- sebuah PREFERENSI, bukan janji. Seluruh kebijakan pembatalan yang datang di
-- C3 bersandar pada "≥ 24 jam sebelum sesi" dan "< 2 jam"; tanpa jam, tidak
-- satu pun batas itu bisa dihitung.
--
-- `preferensi_waktu` TIDAK dihapus. Ia sekarang berarti "kalau jam yang saya
-- minta tidak bisa, saya lebih suka pagi/siang/sore" — keterangan bagi admin
-- saat menawarkan alternatif, bukan lagi satu-satunya keterangan waktu. Ia juga
-- masih menjadi bagian kunci dedup antrean, jadi menghapusnya akan melonggarkan
-- pagar yang sama sekali tidak sedang dibahas di sini.
--
-- Tipe `time` (tanpa zona), bukan `timestamptz`, dan itu disengaja: yang
-- disimpan adalah JAM DINDING klinik, dan zona waktunya tetap satu untuk
-- seluruh sistem (WIB). `timestamptz` akan menyimpan instan yang benar tetapi
-- membuat "jam berapa sesinya" menjadi pertanyaan yang jawabannya bergantung
-- pada zona pembacanya — untuk klinik yang seluruh kliennya di satu zona, itu
-- kerumitan tanpa imbalan. Perakitan instan (untuk menghitung tenggat) hidup di
-- satu tempat, `src/lib/jadwal/jam.ts`, dengan offset +07:00 yang tetap.

-- ===== BACKFILL =====
-- Kolom ditambah DENGAN bawaan, diisi, lalu bawaannya DICABUT. Tanpa langkah
-- ketiga, setiap insert yang lupa menyebut jam akan tersimpan diam-diam dengan
-- jam yang tidak pernah dipilih siapa pun — dan klien menemukannya saat bidan
-- datang di jam yang salah.
--
-- '09:00' untuk baris lama BUKAN tebakan tentang jam sesinya yang sebenarnya:
-- baris-baris itu memang tidak pernah punya jam, dan tidak ada nilai yang bisa
-- membuatnya punya. Ia sekadar nilai yang sah supaya kolom bisa NOT NULL, dan
-- dicatat di sini supaya pembaca berikutnya tidak salah menyangka data lama
-- memuat keterangan yang tidak pernah ada.
alter table public.booking_requests add column jam_mulai time not null default '09:00';
alter table public.booking_requests alter column jam_mulai drop default;

alter table public.sessions add column jam_mulai time not null default '09:00';
alter table public.sessions alter column jam_mulai drop default;

comment on column public.booking_requests.jam_mulai is
  'Jam mulai yang DIPILIH klien (spec J2). Jam dinding WIB. Daftar jam yang '
  'boleh dipilih tinggal di app_settings.jam_layanan, bukan di kode.';

comment on column public.sessions.jam_mulai is
  'Jam mulai sesi, disalin dari permintaan saat konfirmasi. Batas 24 jam & '
  '2 jam pada C3 dihitung dari tanggal + jam ini, zona Asia/Jakarta.';

-- ===== BENTUK =====
-- Menit bulat :00 atau :30. Bukan kerapian: daftar jam di pengaturan diketik
-- manusia, dan jam seperti 09:07 yang lolos ke sini akan tampil di setiap layar
-- sebagai janji yang tak seorang pun bermaksud membuatnya. CHECK ini lapis
-- TERAKHIR — pagar pertamanya `bentukJamSah()` + daftar jam di server action.
alter table public.booking_requests
  add constraint booking_requests_jam_bulat
  check (extract(minute from jam_mulai) in (0, 30) and extract(second from jam_mulai) = 0);

alter table public.sessions
  add constraint sessions_jam_bulat
  check (extract(minute from jam_mulai) in (0, 30) and extract(second from jam_mulai) = 0);
```

- [ ] **Step 4: Terapkan & jalankan uji**

Umumkan, lalu:

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx supabase db reset && npx vitest run tests/jam-sesi-db.test.ts
```
Expected: PASS.

- [ ] **Step 5: Perbaiki fixture uji yang kini kekurangan `jam_mulai`**

`jam_mulai` NOT NULL tanpa bawaan memerahkan setiap insert langsung ke `booking_requests` dan
`sessions` di berkas uji. Temukan:

```bash
cd /Users/arvinfairuz/Documents/padma/web
grep -rn 'from("booking_requests")' tests/ | grep insert
grep -rn 'from("sessions")' tests/ | grep insert
```

Tambahkan `jam_mulai: "09:00"` pada setiap objek insert. Ini mekanis; jangan menambah helper untuk
satu medan.

Run: `cd web && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/supabase/migrations/20260909110000_jam_sesi.sql web/tests
git commit -m "feat(db): sesi punya jam mulai, preferensi waktu tetap tinggal (J2)"
```

---

## Task 6: Daftar jam yang bisa diubah tanpa deploy

**Files:**
- Create: `web/supabase/migrations/20260909120000_registri_jam_layanan.sql`
- Modify: `web/src/lib/pengaturan/bentuk.ts`, `web/src/lib/settings.ts`
- Modify: `web/src/app/admin/pengaturan/aksi.ts` (validasi bentuk baru)
- Test: `web/tests/pengaturan-jam-layanan.test.ts`

**Interfaces:**
- Consumes: `uraikanDaftarJam`, `bentukJamSah` (Task 2).
- Produces: `bacaPengaturan()` mengembalikan medan tambahan `jamLayanan: string[]`.
  `BentukSetelan` bertambah `"daftar_jam"`.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/pengaturan-jam-layanan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";
import { JAM_LAYANAN_BAWAAN } from "@/lib/jadwal/jam";
import { bacaPengaturan } from "@/lib/settings";

describe("registri kunci jam_layanan", () => {
  it("kuncinya terdaftar dengan bentuk daftar_jam", async () => {
    const baris = await querySql<{ bentuk: string; keterangan: string }>(
      "select bentuk, keterangan from public.app_setting_keys where key = 'jam_layanan'",
    );
    expect(baris[0]?.bentuk).toBe("daftar_jam");
    expect(baris[0]?.keterangan).toBeTruthy();
  });

  it("CHECK bentuk menerima daftar_jam", async () => {
    // Kunci yang terdaftar dengan bentuk tak dikenal akan ditolak CHECK, dan
    // migrasinya gagal — pagar ini menangkapnya di uji, bukan di deploy.
    const baris = await querySql<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'public.app_setting_keys'::regclass and contype = 'c'`,
    );
    expect(baris.map((b) => b.def).join(" ")).toContain("daftar_jam");
  });
});

describe("bacaPengaturan", () => {
  it("memulangkan jam layanan sebagai daftar, bukan teks mentah", async () => {
    const p = await bacaPengaturan();
    expect(Array.isArray(p.jamLayanan)).toBe(true);
    expect(p.jamLayanan.length).toBeGreaterThan(0);
  });

  it("jatuh ke bawaan ketika barisnya belum pernah diisi", async () => {
    // Registri melahirkan KUNCInya lewat migrasi, bukan NILAInya. Sampai admin
    // menyimpan sesuatu, `app_settings` tidak punya barisnya sama sekali —
    // keadaan yang wajar, bukan galat.
    const p = await bacaPengaturan();
    const ada = await querySql<{ value: string }>(
      "select value from public.app_settings where key = 'jam_layanan'",
    );
    if (ada.length === 0) expect(p.jamLayanan).toEqual([...JAM_LAYANAN_BAWAAN]);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `cd web && npx vitest run tests/pengaturan-jam-layanan.test.ts`
Expected: FAIL.

- [ ] **Step 3: Tulis migrasi**

Buat `web/supabase/migrations/20260909120000_registri_jam_layanan.sql`:

```sql
-- ============================================================================
-- SETELAN: DAFTAR JAM LAYANAN (spec C1 J2)
-- ============================================================================
-- "Daftar jam yang boleh dipilih tinggal di app_settings, bukan ditulis keras:
-- jam operasional klinik akan berubah, dan perubahan seperti itu tidak boleh
-- menuntut deploy."
--
-- Bentuk BARU `daftar_jam`, bukan menumpang `teks_polos`: panel perlu tahu cara
-- memvalidasi dan cara menampilkannya, dan `bentuk` adalah tempat pengetahuan
-- itu tinggal (lihat `src/lib/pengaturan/bentuk.ts`). Menumpang teks_polos
-- berarti satu-satunya yang memisahkan "08:00,09:00" dari kalimat bebas adalah
-- kebiasaan admin.
--
-- Yang ditulis di sini KUNCInya, bukan NILAInya — sama seperti tiga kunci yang
-- sudah ada. Nilai sungguhannya diisi klien lewat /admin/pengaturan; sampai itu
-- terjadi `uraikanDaftarJam()` memakai JAM_LAYANAN_BAWAAN.

-- CHECK lama dilepas dulu: nama bentuk baru harus ikut di dalamnya, dan
-- `add constraint` atas nama yang sama akan bentrok.
alter table public.app_setting_keys drop constraint if exists app_setting_keys_bentuk;

alter table public.app_setting_keys
  add constraint app_setting_keys_bentuk
  check (bentuk in ('nomor_wa', 'teks_polos', 'daftar_jam'));

insert into public.app_setting_keys (key, keterangan, bentuk) values
  ('jam_layanan',
   'Jam mulai yang boleh dipilih klien saat memesan — pisahkan dengan koma, mis. 08:00, 09:00, 13:00',
   'daftar_jam');
```

> **Catatan pelaksana:** nama constraint `app_setting_keys_bentuk` di atas adalah TEBAKAN dari
> konvensi. Periksa nama sebenarnya lebih dulu dan pakai yang benar:
> ```bash
> cd /Users/arvinfairuz/Documents/padma/web
> grep -n "bentuk" supabase/migrations/20260830120000_registri_kunci_pengaturan.sql
> ```

- [ ] **Step 4: Sambungkan ke TypeScript**

`web/src/lib/pengaturan/bentuk.ts` — tambahkan bentuk ke tipe:

```ts
export type BentukSetelan = "nomor_wa" | "teks_polos" | "daftar_jam";
```

`web/src/lib/settings.ts` — tambahkan kunci dan medan keluarannya:

```ts
import { uraikanDaftarJam } from "@/lib/jadwal/jam";
// …
const KUNCI_PUBLIK = ["nomor_wa", "alamat_klinik", "jam_operasional", "jam_layanan"] as const;
// …
  return {
    nomorWaLink: link,
    nomorWaTampilan: keFormatLokal(link),
    alamatTampilan: teksTerpakai(nilai.get("alamat_klinik"), ALAMAT_BAWAAN),
    jamTampilan: teksTerpakai(nilai.get("jam_operasional"), JAM_BAWAAN),
    // `jam_operasional` adalah KALIMAT yang dipajang di footer ("Senin–Sabtu
    // 08.00–17.00"); `jam_layanan` adalah DAFTAR yang bisa dipilih klien.
    // Dua hal berbeda yang namanya mirip — jangan menggabungkannya: yang satu
    // untuk dibaca, yang satu untuk divalidasi.
    jamLayanan: uraikanDaftarJam(nilai.get("jam_layanan")),
  };
```

`web/src/app/admin/pengaturan/aksi.ts` — validasi bentuk baru saat menyimpan. Bacalah dulu bagaimana
`nomor_wa` divalidasi di sana dan ikuti pola yang sama: setiap entri wajib lolos `bentukJamSah()`,
dan simpanan yang menghasilkan nol entri sah ditolak dengan kalimat, bukan disimpan menjadi `""`.

- [ ] **Step 5: Terapkan, jalankan uji**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx supabase db reset && npm test
```
Expected: PASS. `tests/pengaturan-kunci.test.ts` mungkin mengasersikan JUMLAH kunci registri —
perbarui angkanya, jangan melonggarkan ujinya.

- [ ] **Step 6: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/supabase/migrations/20260909120000_registri_jam_layanan.sql web/src web/tests
git commit -m "feat(pengaturan): daftar jam layanan hidup di app_settings, bukan di kode (J2)"
```

---

## Task 7: Formulir pemesanan memilih jam

**Files:**
- Modify: `web/src/lib/passport/aksi.ts` (`ajukanJadwal` menerima & memvalidasi `jam`)
- Modify: `web/src/app/passport/ajukan/page.tsx` (mengoper daftar jam)
- Modify: `web/src/app/passport/ajukan/form.tsx` (urutan durasi → tanggal → jam → alamat → catatan)
- Test: `web/tests/passport-ajukan-jam.test.ts`

**Interfaces:**
- Consumes: `uraikanDaftarJam`, `bentukJamSah`, `formatJam` (Task 2); `bacaPengaturan()` (Task 6).
- Produces: `FormAjukan` menerima prop tambahan `jamPilihan: string[]`.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/passport-ajukan-jam.test.ts`. Fixture-nya menyalin pola
`tests/passport-pembatas-jadwal.test.ts` (mock `createServerSupabase` ke satu klien bersesi, mock
`next/cache` & `next/navigation`, `signInAs`, bersihkan baris klien uji di `beforeEach`):

```ts
/**
 * JAM MULAI PADA `ajukanJadwal` (spec C1 J2).
 *
 * Yang diuji di sini adalah GERBANGNYA, bukan bentuk jamnya — bentuk sudah
 * diuji sebagai fungsi murni di tests/jadwal-jam.test.ts. Server action adalah
 * endpoint POST tersendiri: `<select>` di layar tidak pernah menjadi pagar,
 * jadi setiap penolakan di bawah harus datang dari action, bukan dari UI.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";

const admin = createAdminSupabase();

const ANANDA = "44444444-4444-4444-4444-444444444401";
const SVC_NUTRISI = "11111111-1111-1111-1111-111111111103";
const TGL_DEPAN = "2027-03-15";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("notFound() terpanggil");
  },
}));

const { ajukanJadwal } = await import("@/lib/passport/aksi");

let VARIAN_NUTRISI: string;
let sesiAnanda: SupabaseClient;

/**
 * Alamat dibuat IDENTIK dengan alamat profil klien uji supaya `ajukanJadwal`
 * mewarisi koordinat profil dan TIDAK PERNAH memanggil Nominatim (jalur
 * `warisan` di lib/passport/aksi.ts). Itu membuat berkas ini tidak perlu
 * men-stub fetch sama sekali — dan stub fetch yang tidak perlu adalah stub
 * yang kelak bocor ke berkas lain.
 */
let ALAMAT_PROFIL: string;

function formulir(isi: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries({
    layanan: SVC_NUTRISI,
    varian: VARIAN_NUTRISI,
    tanggal: TGL_DEPAN,
    waktu: "pagi",
    alamat: ALAMAT_PROFIL,
    ...isi,
  })) {
    fd.set(k, v);
  }
  return fd;
}

async function barisAnanda() {
  const { data } = await admin
    .from("booking_requests")
    .select("id, jam_mulai, preferensi_waktu, tanggal")
    .eq("client_id", ANANDA);
  return data ?? [];
}

beforeAll(async () => {
  sesiAnanda = await signInAs("ananda@padma.test");
  ref.sesi = sesiAnanda;
  VARIAN_NUTRISI = await varianBaku(admin, SVC_NUTRISI);

  const { data } = await admin
    .from("clients")
    .select("alamat")
    .eq("id", ANANDA)
    .maybeSingle<{ alamat: string }>();
  ALAMAT_PROFIL = data?.alamat?.trim() || "Jl. Uji Alamat Baku No. 1";

  // Pastikan profil punya koordinat, supaya jalur warisan benar-benar menyala.
  await admin
    .from("clients")
    .update({ alamat: ALAMAT_PROFIL, alamat_lat: -7.9666, alamat_lon: 112.6326 })
    .eq("id", ANANDA);
});

beforeEach(async () => {
  ref.sesi = sesiAnanda;
  await admin.from("booking_requests").delete().eq("client_id", ANANDA);
});

afterAll(async () => {
  await admin.from("booking_requests").delete().eq("client_id", ANANDA);
});

describe("ajukanJadwal: jam mulai", () => {
  it("menolak pengajuan tanpa jam, dengan kalimat yang bisa dibaca manusia", async () => {
    const fd = formulir({});
    fd.delete("jam");
    const hasil = await ajukanJadwal(fd);
    expect(hasil.ok).toBe(false);
    expect(hasil.ok === false && hasil.pesan).toMatch(/jam/i);
    expect(await barisAnanda()).toEqual([]);
  });

  it("menolak jam yang bentuknya salah", async () => {
    for (const buruk of ["9:00", "24:00", "pagi", "09.00"]) {
      const hasil = await ajukanJadwal(formulir({ jam: buruk }));
      expect(hasil.ok, `jam "${buruk}" seharusnya ditolak`).toBe(false);
    }
    expect(await barisAnanda()).toEqual([]);
  });

  it("menolak jam yang BENTUKNYA sah tetapi tidak ada di daftar pengaturan", async () => {
    // '03:00' adalah HH:MM yang sah. Yang membuatnya ditolak adalah
    // keanggotaan pada daftar jam layanan — dan daftar itu dibaca di server,
    // bukan dipercaya dari FormData.
    const hasil = await ajukanJadwal(formulir({ jam: "03:00" }));
    expect(hasil.ok).toBe(false);
    expect(await barisAnanda()).toEqual([]);
  });

  it("menyimpan jam yang sah apa adanya", async () => {
    const hasil = await ajukanJadwal(formulir({ jam: "09:00" }));
    expect(hasil).toEqual({ ok: true });
    const baris = await barisAnanda();
    expect(baris.length).toBe(1);
    // Postgres `time` dibaca kembali sebagai 'HH:MM:SS'.
    expect(baris[0].jam_mulai).toBe("09:00:00");
  });

  it("preferensi_waktu TETAP tersimpan berdampingan dengan jam (spec J2)", async () => {
    // Keduanya, bukan salah satu: preferensi kini berarti "kalau jam yang saya
    // minta tidak bisa, saya lebih suka pagi/siang/sore".
    await ajukanJadwal(formulir({ jam: "13:00", waktu: "siang" }));
    const baris = await barisAnanda();
    expect(baris[0].jam_mulai).toBe("13:00:00");
    expect(baris[0].preferensi_waktu).toBe("siang");
  });
});
```

> **Catatan pelaksana:** `ALAMAT_PROFIL` dan koordinatnya ditulis ulang di `beforeAll` dan **tidak**
> dikembalikan di `afterAll`. Periksa apakah berkas uji lain bergantung pada alamat klien Ananda
> (`grep -rn "44444444-4444-4444-4444-444444444401" tests/ | grep -i alamat`); bila ya, simpan nilai
> lamanya di `beforeAll` dan pulihkan di `afterAll`, mengikuti cara
> `tests/passport-pembatas-jadwal.test.ts` memulihkan `services.aktif`.

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `cd web && npx vitest run tests/passport-ajukan-jam.test.ts`

- [ ] **Step 3: Sunting `ajukanJadwal`**

Sisipkan sesudah validasi `waktu` yang sudah ada:

```ts
import { bacaPengaturan } from "@/lib/settings";
import { bentukJamSah } from "@/lib/jadwal/jam";
// …
  const jam = String(formData.get("jam") ?? "");

  // Dua pemeriksaan, bukan satu. BENTUK ditolak lebih dulu supaya masukan
  // sampah tidak pernah sampai ke query pengaturan; KEANGGOTAAN diperiksa
  // terhadap daftar yang benar-benar berlaku hari ini. Daftar itu dibaca di
  // SERVER, bukan dipercaya dari FormData: `<select>` di layar bisa disunting
  // siapa saja lewat devtools, dan server action adalah endpoint POST
  // tersendiri yang tidak pernah melewati layar itu.
  if (!bentukJamSah(jam)) {
    return { ok: false, pesan: "Pilih jam mulai layanan." };
  }
  const { jamLayanan } = await bacaPengaturan();
  if (!jamLayanan.includes(jam)) {
    return { ok: false, pesan: "Jam itu tidak tersedia. Pilih salah satu jam yang ditawarkan." };
  }
```

Dan tambahkan `jam_mulai: jam` pada objek insert.

- [ ] **Step 4: Sunting halaman & formulir**

`page.tsx` membaca pengaturan dan mengopernya:

```tsx
const [{ jamLayanan }, { data: layanan }, /* … */] = await Promise.all([
  bacaPengaturan(),
  // … query yang sudah ada
]);
// …
<FormAjukan
  layanan={…}
  varian={…}
  jamPilihan={jamLayanan}
  tanggalPalingAwal={hariIniJakarta()}
  alamatDefault={profil?.alamat ?? ""}
/>
```

`form.tsx`: tambahkan `<select name="jam">` **sesudah medan tanggal dan sebelum alamat** — urutan
`durasi → tanggal → jam → alamat → catatan` sesuai gambar alur klien (spec J2). Labelnya memakai
`formatJam()` supaya klien membaca "09.00 WIB", bukan "09:00". Medan preferensi waktu yang sudah ada
TETAP, dengan keterangan yang jujur tentang arti barunya:

```tsx
<span className="mt-1 block text-[11.5px] text-ink-soft">
  Kalau jam pilihan Anda ternyata penuh, tim PADMA menawarkan alternatif di rentang ini.
</span>
```

- [ ] **Step 5: Jalankan uji & suite penuh**

Run: `cd web && npx vitest run tests/passport-ajukan-jam.test.ts && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/arvinfairuz/Documents/padma
git add -A web/src web/tests
git commit -m "feat(passport): klien memilih jam mulai saat memesan (J2)"
```

---

## Task 8: Jam tampil di setiap layar yang menampilkan tanggal sesi

Spec §"Konsekuensi yang sudah diketahui": *"Menambah jam pada sesi menyentuh setiap layar yang
menampilkan tanggal sesi."* Sesi yang punya jam di basis data tetapi tampil tanpa jam di layar
adalah kegagalan yang lebih buruk daripada tidak punya jam sama sekali — klien membaca layar itu
sebagai janji yang lengkap.

**Files:**
- Modify: `web/src/lib/admin/agenda.ts` + layarnya, `web/src/app/admin/sesi/page.tsx`,
  `web/src/app/admin/sesi/antrean-permintaan.tsx`, `web/src/app/passport/page.tsx`,
  `web/src/app/passport/sesi/*`, `web/src/lib/owner/data.ts` + `web/src/app/owner/rekap/*`
- Test: `web/tests/jam-tampil-di-layar.test.ts`

- [ ] **Step 1: Tulis pagar yang gagal**

Pagar SUMBER, bukan render — murah dan menangkap layar yang terlewat:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Setiap berkas yang MEMBACA `tanggal` sebuah sesi/permintaan untuk ditampilkan
 * wajib juga membaca `jam_mulai`. Daftarnya ditulis tangan dan sengaja: ia
 * adalah pernyataan "inilah layar yang menampilkan waktu sesi", dan
 * bertambahnya layar baru memang harus menyentuh daftar ini.
 */
const AKAR = path.resolve(__dirname, "..", "src");

const LAYAR_WAKTU = [
  "lib/admin/agenda.ts",
  "app/admin/sesi/page.tsx",
  "lib/admin/sesi.ts",
  "lib/passport/data.ts",
  "lib/owner/data.ts",
];

describe("jam ikut terbaca di setiap layar yang menampilkan tanggal", () => {
  for (const rel of LAYAR_WAKTU) {
    it(`${rel} membaca jam_mulai`, () => {
      const isi = readFileSync(path.join(AKAR, rel), "utf8");
      expect(isi).toContain("jam_mulai");
    });
  }
});
```

- [ ] **Step 2: Jalankan, pastikan MERAH** — `npx vitest run tests/jam-tampil-di-layar.test.ts`

- [ ] **Step 3: Tambahkan `jam_mulai` ke setiap `select` dan tampilkan**

Untuk setiap berkas di daftar: tambahkan `jam_mulai` ke kolom yang dipilih, dan rangkai tampilannya
sebagai `${formatTanggalID(tanggal)} · ${formatJam(jam)}`. Contoh pada `antrean-permintaan.tsx`,
tipe `PermintaanAntre` bertambah satu medan yang **sudah diformat di server** (komponen ini
`"use client"` — jangan mengimpor apa pun yang bukan modul murni ke sini; `lib/jadwal/jam.ts` murni,
jadi ia boleh, tetapi memformat di server tetap lebih baik agar satu tempat memutuskan bentuknya):

```ts
export type PermintaanAntre = {
  id: string;
  namaKlien: string;
  namaLayanan: string;
  tanggal: string; // sudah diformat
  jam: string;     // sudah diformat, mis. "09.00 WIB"
  waktu: string;   // label preferensi — alternatif bila jam penuh
  catatan: string;
};
```

- [ ] **Step 4: Jalankan uji & suite penuh** — `npm test`. Perbarui snapshot/assertion layar yang
kini memuat jam; jangan melonggarkan yang mengasersikan tanggal.

- [ ] **Step 5: Commit**

```bash
git add -A web/src web/tests
git commit -m "feat(layar): jam sesi tampil di agenda, passport, dan rekap (J2)"
```

---

## Task 9: Mitra dipilih dari daftar terurut jarak

**Files:**
- Create: `web/src/lib/jadwal/urutan-mitra.ts`
- Create: `web/supabase/migrations/20260909130000_mitra_pada_permintaan.sql`
- Create: `web/supabase/migrations/20260909135000_konfirmasi_atomik.sql`
- Modify: `web/src/app/admin/sesi/aksi.ts` (dua action baru; `konfirmasiPermintaan` berubah tanda tangan)
- Modify: `web/src/app/admin/sesi/page.tsx`, `web/src/app/admin/sesi/antrean-permintaan.tsx`
- Test: `web/tests/urutan-mitra.test.ts`, `web/tests/admin-rantai-mitra.test.ts`

**Interfaces:**
- Consumes: `haversineKm`, `type Koordinat` dari `@/lib/transport/jarak`; `STATUS_ANTRE` dan
  `bolehPindahPermintaan` dari Task 1.
- Produces:
  - `urutkanMitraMenurutJarak(mitra: MitraJarak[], tujuan: Koordinat | null): MitraTerurut[]`
    dengan `type MitraJarak = { id: string; nama: string; lat: number | null; lon: number | null }`
    dan `type MitraTerurut = MitraJarak & { km: number | null }`
  - server action `cariMitra(permintaanId: string)` → `diminta` → `mencari_mitra`
  - server action `pilihMitra(permintaanId: string, partnerId: string)` → `mencari_mitra` → `mitra_siap`
  - `konfirmasiPermintaan(permintaanId: string)` — **tanpa** parameter mitra lagi; mitranya dibaca
    dari baris permintaan.

- [ ] **Step 1: Tulis uji fungsi murni yang gagal**

Buat `web/tests/urutan-mitra.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { urutkanMitraMenurutJarak } from "@/lib/jadwal/urutan-mitra";

const MALANG = { lat: -7.9666, lon: 112.6326 };

const MITRA = [
  { id: "c", nama: "Citra", lat: -7.99, lon: 112.66 },   // paling jauh dari tiga
  { id: "a", nama: "Ayu", lat: -7.967, lon: 112.633 },   // paling dekat
  { id: "b", nama: "Bunga", lat: -7.98, lon: 112.64 },
  { id: "z", nama: "Zahra", lat: null, lon: null },      // domisili belum diisi
];

describe("urutan mitra menurut jarak", () => {
  it("yang terdekat lebih dulu", () => {
    const hasil = urutkanMitraMenurutJarak(MITRA, MALANG);
    expect(hasil.slice(0, 3).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("menyertakan jaraknya, supaya admin memutuskan dengan angka", () => {
    const [pertama] = urutkanMitraMenurutJarak(MITRA, MALANG);
    expect(pertama.km).toBeGreaterThan(0);
    expect(pertama.km).toBeLessThan(1);
  });

  it("mitra tanpa koordinat TETAP muncul, di urutan paling belakang", () => {
    // Membuangnya berarti mitra yang domisilinya belum diisi menjadi tidak
    // bisa ditugaskan sama sekali — kegagalan senyap yang menyalahkan orang
    // atas data yang belum sempat dimasukkan admin.
    const hasil = urutkanMitraMenurutJarak(MITRA, MALANG);
    expect(hasil[hasil.length - 1].id).toBe("z");
    expect(hasil[hasil.length - 1].km).toBeNull();
  });

  it("tanpa koordinat tujuan, urutannya menurut NAMA — bukan acak", () => {
    // Alamat klien yang gagal digeocode adalah keadaan yang wajar di Malang
    // (26 dari 32 gagal; spec pemilih-lokasi §1). Urutan yang berubah-ubah
    // antar-muat membuat admin kehilangan tempat.
    const hasil = urutkanMitraMenurutJarak(MITRA, null);
    expect(hasil.map((m) => m.nama)).toEqual(["Ayu", "Bunga", "Citra", "Zahra"]);
    expect(hasil.every((m) => m.km === null)).toBe(true);
  });

  it("tidak mengubah array masukan", () => {
    const salinan = [...MITRA];
    urutkanMitraMenurutJarak(MITRA, MALANG);
    expect(MITRA).toEqual(salinan);
  });

  it("dua mitra berjarak sama diurutkan menurut nama, hasilnya stabil", () => {
    const kembar = [
      { id: "y", nama: "Yuni", lat: -7.97, lon: 112.64 },
      { id: "x", nama: "Xena", lat: -7.97, lon: 112.64 },
    ];
    expect(urutkanMitraMenurutJarak(kembar, MALANG).map((m) => m.id)).toEqual(["x", "y"]);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan MERAH**

- [ ] **Step 3: Tulis `urutan-mitra.ts`**

```ts
import { haversineKm, type Koordinat } from "@/lib/transport/jarak";

/**
 * Urutan mitra untuk layar penugasan admin (spec C1 J7).
 *
 * KEPUTUSANNYA TETAP DI TANGAN MANUSIA. Fungsi ini mengurutkan, tidak memilih.
 * Penugasan otomatis ditolak karena sistem tidak tahu cuti, jam kerja, maupun
 * kecocokan keahlian — ia hanya tahu jarak garis lurus, dan `lib/transport/
 * jarak.ts` sendiri sudah menulis bahwa 4,2 km ke seberang sungai bisa berarti
 * 9 km memutar.
 *
 * Murni dan tanpa impor Supabase: ia dipakai halaman server maupun diuji tanpa
 * basis data.
 */
export type MitraJarak = {
  id: string;
  nama: string;
  lat: number | null;
  lon: number | null;
};

export type MitraTerurut = MitraJarak & { km: number | null };

export function urutkanMitraMenurutJarak(
  mitra: readonly MitraJarak[],
  tujuan: Koordinat | null,
): MitraTerurut[] {
  const berjarak: MitraTerurut[] = mitra.map((m) => ({
    ...m,
    km:
      tujuan !== null && m.lat !== null && m.lon !== null
        ? haversineKm({ lat: m.lat, lon: m.lon }, tujuan)
        : null,
  }));

  // Salinan, bukan sortir di tempat: memutasi array milik pemanggil adalah
  // kejutan yang terbayar jauh dari sini.
  return [...berjarak].sort((a, b) => {
    // Mitra tanpa jarak SELALU di belakang — tetapi tetap ada. Membuangnya
    // berarti mitra yang domisilinya belum diisi tidak bisa ditugaskan sama
    // sekali, dan admin tidak akan pernah tahu kenapa namanya hilang.
    if (a.km === null && b.km === null) return a.nama.localeCompare(b.nama, "id");
    if (a.km === null) return 1;
    if (b.km === null) return -1;
    if (a.km !== b.km) return a.km - b.km;
    // Jarak yang persis sama diputus oleh nama, supaya urutannya tidak
    // berubah antar-muat halaman.
    return a.nama.localeCompare(b.nama, "id");
  });
}
```

- [ ] **Step 4: Jalankan uji fungsi murni, pastikan HIJAU**

- [ ] **Step 5: Tulis migrasi mitra pada permintaan**

Buat `web/supabase/migrations/20260909130000_mitra_pada_permintaan.sql`:

```sql
-- ============================================================================
-- MITRA DIPILIH SEBELUM KONFIRMASI (spec C1 J7)
-- ============================================================================
-- Sebelum C1, mitra dipilih PADA saat konfirmasi: `konfirmasiPermintaan`
-- menerima `partnerId` sebagai parameter dan langsung melahirkan sesi. Rantai
-- baru memisahkan keduanya — `mitra_siap` adalah keadaan tersendiri, dan
-- alasannya struktural, bukan kosmetik: tarif transport berasal dari domisili
-- MITRA ke alamat KLIEN, jadi transport tidak bisa dihitung sebelum mitranya
-- diketahui. Itu pula yang membuat tagihan tidak bisa terbit di 'diminta', dan
-- yang membuat C2 menyisipkan pembayaran SESUDAH 'mitra_siap'.
--
-- Karena itu pilihan mitra harus punya tempat tinggal di baris permintaan.
alter table public.booking_requests
  add column partner_id uuid references public.partners(id);

comment on column public.booking_requests.partner_id is
  'Mitra yang dipilih admin saat status mitra_siap. Disalin ke sessions.partner_id '
  'pada konfirmasi. NULL selama masih dicarikan.';

-- Keadaan 'mitra_siap' yang tidak punya mitra adalah keadaan yang berbohong:
-- layarnya menyebut "bidan siap" sementara tidak ada seorang pun yang
-- ditugaskan. CHECK, bukan trigger — invarian bentuk baris paling murah
-- ditegakkan di tempat ia hidup.
--
-- DAFTARNYA DUA STATUS, BUKAN SATU. Draf pertama menulis
-- `status <> 'mitra_siap' or partner_id is not null`, dan itu bocor tepat satu
-- langkah sesudah tempat ia menjaga: begitu permintaan berpindah ke
-- 'dikonfirmasi', `partner_id` boleh menjadi NULL lagi tanpa satu pun keluhan
-- — sementara `konfirmasi_permintaan()` MEMBACA kolom itu untuk menentukan
-- siapa yang datang. (Ditemukan saat tinjauan penulis spec, 8 Sep 2026.)
--
-- Ditulis sebagai DAFTAR EKSPLISIT, bukan perbandingan urutan enum
-- (`status >= 'mitra_siap'`). Urutan enum sesudah C1 adalah
-- diminta < mencari_mitra < mitra_siap < dikonfirmasi < ditolak < dibatalkan_klien,
-- sehingga `>=` akan ikut menuntut mitra pada 'dibatalkan_klien' — termasuk
-- pembatalan dari 'diminta' yang memang tidak pernah punya mitra. Perbandingan
-- urutan atas enum yang urutannya ditentukan urusan lain adalah pagar yang
-- berubah arti setiap kali ada nilai baru disisipkan.
alter table public.booking_requests
  add constraint booking_requests_mitra_siap_bermitra
  check (status not in ('mitra_siap', 'dikonfirmasi') or partner_id is not null);
```

- [ ] **Step 6: Tulis uji rantai admin yang gagal**

Buat `web/tests/admin-rantai-mitra.test.ts`. Fixture-nya menyalin kepala
`tests/admin-sesi-konfirmasi.test.ts` (mock `createServerSupabase`/`next/cache`/`next/navigation`,
`signInAs("admin@padma.test")`, tanggal uji khusus, bersih-bersih di `afterAll` — **sesi dihapus
sebelum permintaan**, karena FK `sessions.booking_request_id` menahan penghapusan):

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { querySql } from "./helpers/db";

const admin = createAdminSupabase();

const KLIEN = "44444444-4444-4444-4444-444444444401"; // Ananda
const SVC = "11111111-1111-1111-1111-111111111101"; // Fertility Massage
const MITRA = "33333333-3333-3333-3333-333333333301";
const MITRA_NONAKTIF = "33333333-3333-3333-3333-3333333333e1";
const TGL = "2026-12-27"; // tanggal khusus berkas ini, tidak dipakai berkas lain
const JAM = "09:00";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ref.sesi! }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/admin/sesi",
}));

const { cariMitra, pilihMitra, konfirmasiPermintaan } = await import("@/app/admin/sesi/aksi");

let VARIAN: string;
let sesiAdmin: SupabaseClient;

async function bersihkan() {
  await admin.from("sessions").delete().eq("tanggal", TGL);
  await admin.from("booking_requests").delete().eq("tanggal", TGL);
}

/** Membuat satu permintaan pada status tertentu, memakai service role. */
async function permintaanPada(status: string, partnerId: string | null = null): Promise<string> {
  const { data, error } = await admin
    .from("booking_requests")
    .insert({
      client_id: KLIEN,
      service_id: SVC,
      variant_id: VARIAN,
      partner_id: partnerId,
      tanggal: TGL,
      jam_mulai: JAM,
      preferensi_waktu: "pagi",
      alamat: "Jl. Uji Rantai No. 7",
      status,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw error;
  return data.id;
}

async function statusPermintaan(id: string): Promise<string | null> {
  const { data } = await admin
    .from("booking_requests")
    .select("status")
    .eq("id", id)
    .maybeSingle<{ status: string }>();
  return data?.status ?? null;
}

async function sesiDari(id: string) {
  const { data } = await admin
    .from("sessions")
    .select("id, partner_id, jam_mulai, status")
    .eq("booking_request_id", id);
  return data ?? [];
}

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
  ref.sesi = sesiAdmin;
  VARIAN = await varianBaku(admin, SVC);
  await bersihkan();
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  await bersihkan();
});

afterAll(bersihkan);

describe("rantai admin: cari mitra", () => {
  it("memindahkan diminta -> mencari_mitra", async () => {
    const id = await permintaanPada("diminta");
    expect(await cariMitra(id)).toEqual({ ok: true });
    expect(await statusPermintaan(id)).toBe("mencari_mitra");
  });

  it("menolak dari keadaan yang bukan diminta, dengan kalimat", async () => {
    const id = await permintaanPada("mitra_siap", MITRA);
    const hasil = await cariMitra(id);
    expect(hasil.ok).toBe(false);
    expect(await statusPermintaan(id)).toBe("mitra_siap");
  });
});

describe("rantai admin: pilih mitra", () => {
  it("memindahkan mencari_mitra -> mitra_siap DAN mengisi partner_id", async () => {
    const id = await permintaanPada("mencari_mitra");
    expect(await pilihMitra(id, MITRA)).toEqual({ ok: true });

    const { data } = await admin
      .from("booking_requests")
      .select("status, partner_id")
      .eq("id", id)
      .maybeSingle<{ status: string; partner_id: string | null }>();
    expect(data?.status).toBe("mitra_siap");
    expect(data?.partner_id).toBe(MITRA);
  });

  it("menolak mitra NONAKTIF dengan kalimat, bukan kode Postgres", async () => {
    // FK hanya menolak partner_id yang TIDAK ADA, bukan mitra yang sudah
    // pensiun — dan daftar pilihan di UI menyaring `aktif`, sementara server
    // action tidak pernah melewati UI itu.
    const id = await permintaanPada("mencari_mitra");
    const hasil = await pilihMitra(id, MITRA_NONAKTIF);
    expect(hasil.ok).toBe(false);
    expect(hasil.ok === false && hasil.pesan).toMatch(/mitra/i);
    expect(await statusPermintaan(id)).toBe("mencari_mitra");
  });
});

describe("konfirmasi hanya dari mitra_siap", () => {
  it("MENOLAK permintaan yang masih diminta — lompatan tidak boleh", async () => {
    const id = await permintaanPada("diminta");
    const hasil = await konfirmasiPermintaan(id);
    expect(hasil.ok).toBe(false);
    expect(await sesiDari(id)).toEqual([]);
  });

  it("sesi mewarisi mitra dan JAM dari baris permintaan", async () => {
    const id = await permintaanPada("mitra_siap", MITRA);
    expect(await konfirmasiPermintaan(id)).toEqual({ ok: true });

    const sesi = await sesiDari(id);
    expect(sesi.length).toBe(1);
    expect(sesi[0].partner_id).toBe(MITRA);
    expect(sesi[0].jam_mulai).toBe("09:00:00");
    expect(sesi[0].status).toBe("terjadwal");
  });

  it("DUA konfirmasi bersamaan tetap melahirkan TEPAT SATU sesi", async () => {
    // Pengerasan lama (migration sesi_dari_permintaan) tidak boleh hilang saat
    // rantai diperpanjang MAUPUN saat konfirmasi pindah ke dalam fungsi
    // Postgres. Kegagalannya berbentuk klien kedatangan bidan dua kali, tanpa
    // satu pun error.
    const id = await permintaanPada("mitra_siap", MITRA);
    const hasil = await Promise.all([konfirmasiPermintaan(id), konfirmasiPermintaan(id)]);
    expect(hasil.filter((h) => h.ok).length).toBe(1);
    expect((await sesiDari(id)).length).toBe(1);
  });
});

describe("konfirmasi_permintaan() sebagai RPC — pagar di dalam fungsinya", () => {
  it("KLIEN yang login tidak bisa memanggilnya langsung", async () => {
    // `security definer` mematikan RLS, jadi penjaga perannya harus hidup DI
    // DALAM fungsi. Tanpa itu, klien mana pun bisa mengonfirmasi permintaan
    // jadwalnya sendiri lewat satu panggilan RPC — bentuk celah yang pernah
    // nyata di proyek ini.
    const id = await permintaanPada("mitra_siap", MITRA);
    const sesiKlien = await signInAs("ananda@padma.test");
    const { error } = await sesiKlien.rpc("konfirmasi_permintaan", {
      permintaan_id: id,
      jenjang_saran: null,
    });
    expect(error).not.toBeNull();
    expect(await statusPermintaan(id)).toBe("mitra_siap");
    expect(await sesiDari(id)).toEqual([]);
  });

  it("anon tidak punya hak EXECUTE atasnya", async () => {
    const baris = await querySql<{ ada: boolean }>(
      `select has_function_privilege('anon',
         'public.konfirmasi_permintaan(uuid, jenjang_transport)', 'execute') as ada`,
    );
    expect(baris[0].ada).toBe(false);
  });

  it("TIDAK menerima jenjang_sumber sebagai argumen — ia tidak bisa dipalsukan", async () => {
    // Pagar STRUKTURAL, bukan perilaku: yang dijaga adalah bentuk tanda tangan
    // fungsinya. Begitu `jenjang_sumber` menjadi parameter, admin bisa mencatat
    // jenjang pilihan tangan sebagai hasil hitungan otomatis — dan rekap
    // transport owner membacanya sebagai angka yang tidak pernah diperiksa.
    // `sessions_alasan_penimpaan` tidak menahannya: ia hanya menuntut alasan
    // ketika sumbernya sudah 'admin'.
    const baris = await querySql<{ args: string }>(
      `select pg_get_function_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'konfirmasi_permintaan'`,
    );
    expect(baris.length).toBe(1);
    expect(baris[0].args).not.toContain("jenjang_sumber");
  });

  it("menuliskan jenjang_sumber='otomatis' sendiri ketika ada saran", async () => {
    const id = await permintaanPada("mitra_siap", MITRA);
    await konfirmasiPermintaan(id);
    const { data } = await admin
      .from("sessions")
      .select("jenjang, jenjang_sumber")
      .eq("booking_request_id", id)
      .maybeSingle<{ jenjang: string | null; jenjang_sumber: string | null }>();
    // Bila koordinat fixture menghasilkan saran, sumbernya wajib 'otomatis';
    // bila tidak ada saran, keduanya NULL. Yang dilarang adalah kombinasi
    // "ada jenjang tapi sumbernya bukan otomatis" dari jalur ini.
    if (data?.jenjang !== null) expect(data?.jenjang_sumber).toBe("otomatis");
    else expect(data?.jenjang_sumber).toBeNull();
  });

  it("memulangkan NULL — bukan galat — ketika permintaannya sudah tidak mitra_siap", async () => {
    // Pemanggil membedakan keduanya: NULL berarti "sudah ditangani orang lain"
    // dan berhak atas kalimat yang tenang; galat berarti sesuatu yang lain.
    const id = await permintaanPada("diminta");
    const { data, error } = await (await signInAs("admin@padma.test")).rpc(
      "konfirmasi_permintaan",
      { permintaan_id: id, jenjang_saran: null },
    );
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

describe("trigger perpindahan menahan tembakan langsung ke DB", () => {
  it("update diminta -> dikonfirmasi ditolak, bahkan tanpa lewat action", async () => {
    // Pola tests/money-firewall-struktural.test.ts: pagar yang hanya diuji
    // lewat action adalah pagar yang belum dibuktikan ada.
    const id = await permintaanPada("diminta");
    await expect(
      querySql("update public.booking_requests set status = 'dikonfirmasi' where id = $1", [id]),
    ).rejects.toThrow(/perpindahan status permintaan tidak sah/);
    expect(await statusPermintaan(id)).toBe("diminta");
  });

  it("mitra_siap tanpa partner_id ditolak CHECK", async () => {
    const id = await permintaanPada("mencari_mitra");
    await expect(
      querySql("update public.booking_requests set status = 'mitra_siap' where id = $1", [id]),
    ).rejects.toThrow(/booking_requests_mitra_siap_bermitra/);
  });
});
```

> **Catatan pelaksana:** `querySql` berjalan sebagai `postgres` (superuser), sehingga RLS TIDAK
> berlaku — itu memang yang diinginkan di dua uji terakhir: yang diuji trigger dan CHECK, bukan
> policy. Untuk menguji POLICY, pakai sesi JWT sungguhan lewat `signInAs` (lihat Tugas 10).

- [ ] **Step 7: Tulis dua action baru & ubah konfirmasi**

Di `web/src/app/admin/sesi/aksi.ts` — pola yang sudah berlaku di berkas itu dipertahankan utuh:
`requireRole` di dalam setiap action, keadaan tujuan tidak pernah menjadi parameter, identitas klien
dibaca dari baris permintaan, sesi pengguna (bukan service role), dan setiap UPDATE memeriksa jumlah
baris terpengaruh — UPDATE yang tidak mengenai apa pun dijawab PostgREST dengan 200 + `[]`.

```ts
/**
 * `diminta` -> `mencari_mitra`. Menandai bahwa permintaan ini sedang ditangani.
 *
 * Keadaannya berarti sesuatu bagi klien: passport menampilkan "sedang
 * dicarikan bidan" alih-alih diam. Itulah alasan ia keadaan tersendiri dan
 * bukan sekadar layar yang terbuka di sisi admin.
 */
export async function cariMitra(permintaanId: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from("booking_requests")
    .update({ status: "mencari_mitra" })
    .eq("id", permintaanId)
    .eq("status", "diminta")
    .select("id");

  if ((data ?? []).length === 0) {
    return { ok: false, pesan: "Permintaan sudah ditangani atau tidak ditemukan." };
  }
  revalidatePath("/admin/sesi");
  revalidatePath("/admin");
  revalidatePath("/passport");
  return { ok: true };
}
```

`pilihMitra` memeriksa mitra aktif LEBIH DULU (alasan yang sama dengan yang sudah ditulis di
`konfirmasiPermintaan`: FK hanya menolak mitra yang TIDAK ADA, bukan yang sudah pensiun), lalu
menulis `partner_id` bersama status dalam SATU update — dua update terpisah bisa meninggalkan
`mitra_siap` tanpa mitra bila yang kedua gagal, dan itulah yang dicegah CHECK di migrasi.

**`konfirmasiPermintaan` menjadi SATU TRANSAKSI POSTGRES.** Ini perubahan yang paling dalam di
tugas ini, dan alasannya bukan kerapian.

Bentuk yang ada sekarang menulis DUA kali dari TypeScript: status permintaan menjadi terkonfirmasi,
lalu baris `sessions` lahir. Bila tulisan kedua gagal, kode "mengembalikan" tulisan pertama
(`aksi.ts:147-156`, hari ini kembali ke `menunggu`). Kompensasi seperti itu bisa gagal juga —
jaringan putus, proses mati — dan hasilnya permintaan tersangkut terkonfirmasi tanpa sesi: hilang
dari antrean admin sekaligus dari passport klien, tanpa satu pun error. Draf pertama rencana ini
menjawabnya dengan menambah panah mundur permanen di mesin status. Tinjauan penulis spec menolaknya
dengan alasan yang lebih baik: **jangan melebarkan mesin status untuk menampung operasi yang tidak
atomik — buat operasinya atomik.**

Polanya sudah idiomatik di repo ini: `klaim_sudah_bayar`, `ganti_halaman_materi`,
`perbarui_profil_klien`, `lepas_video_materi` semuanya operasi majemuk yang hidup sebagai fungsi
Postgres.

Buat `web/supabase/migrations/20260909135000_konfirmasi_atomik.sql`:

```sql
-- ============================================================================
-- KONFIRMASI SEBAGAI SATU TRANSAKSI (spec C1 J1/J7)
-- ============================================================================
-- Konfirmasi adalah DUA tulisan yang harus berlaku sebagai SATU keputusan:
-- `booking_requests.status` menjadi 'dikonfirmasi', dan satu baris `sessions`
-- lahir. Dikerjakan dari TypeScript, keduanya adalah dua round-trip terpisah,
-- dan kegagalan di antaranya meninggalkan permintaan terkonfirmasi tanpa sesi
-- — hilang dari antrean admin sekaligus dari passport klien, tanpa error.
-- Kompensasi di sisi klien tidak menutupnya: kompensasinya bisa gagal juga.
--
-- Di dalam fungsi ini keduanya satu transaksi. Kegagalan parsial lenyap sebagai
-- KELAS masalah, bukan ditangani per kasus.
--
-- YANG TIDAK BERUBAH, dan wajib tetap terbukti:
--   * SERIALISASI dua konfirmasi bersamaan. `update … where status='mitra_siap'`
--     di bawah mengunci baris; transaksi kedua menunggu, lalu menilai ulang
--     syaratnya terhadap baris yang sudah berubah dan tidak mengenai apa pun.
--     Indeks `sessions_booking_request_unik` tetap menjadi jaring KEDUA.
--   * IDENTITAS KLIEN DIBACA DARI BARIS PERMINTAAN, tidak pernah dari pemanggil.
--   * KEADAAN TUJUAN TIDAK PERNAH MENJADI PARAMETER.
--
-- `jenjang` dihitung di TypeScript dan DIOPER masuk, bukan dihitung di sini.
-- Menulis ulang haversine dalam SQL berarti dua salinan rumus jarak dalam dua
-- bahasa yang harus sepakat selamanya — persis jenis duplikasi yang sudah
-- ditolak Ruling 20 untuk `LABEL_JENJANG`. Yang dipindahkan ke basis data
-- adalah ATOMISITASnya, bukan domainnya.
--
-- ===== KENAPA HANYA SATU ARGUMEN, DAN KENAPA `jenjang_sumber` BUKAN =====
-- Sebelum RPC ini ada, jalur konfirmasi aman dari klaim palsu bukan karena
-- penjaga melainkan karena ia TIDAK PERNAH membaca FormData sama sekali —
-- komentarnya menyebutnya begitu: "tidak ada klaim pemanggil untuk dipercaya
-- atau ditolak" (src/app/admin/sesi/aksi.ts). Menjadikannya RPC ber-EXECUTE
-- untuk `authenticated` MENGHAPUS sifat itu: sekarang ADA pemanggil, admin bisa
-- memanggilnya langsung tanpa lewat server action, dan pemanggil bisa berbohong.
--
-- `jenjang_sumber` karena itu TIDAK BOLEH menjadi parameter. Satu-satunya
-- pagar yang ada — `sessions_alasan_penimpaan` (migration alamat_dan_koordinat)
-- — hanya menuntut alasan ketika sumbernya 'admin'; tidak ada apa pun yang
-- memaksa 'otomatis' jujur. Bila ia parameter, seorang admin bisa mencatat
-- jenjang pilihan tangan sebagai hasil hitungan otomatis, dan rekap transport
-- owner akan membacanya sebagai angka yang tidak pernah diperiksa siapa pun.
-- Fungsi ini menuliskannya sendiri: 'otomatis' bila ada saran, NULL bila tidak.
-- Penimpaan oleh admin tetap punya jalurnya sendiri (`tetapkanJenjang`), yang
-- memang menuntut alasan.
-- (Ditemukan penulis spec saat meninjau rencana ini, 8 September 2026 —
-- konsekuensi yang lahir DARI pemindahan ke RPC, bukan yang sudah ada.)
--
-- SECURITY DEFINER dengan penjaga peran DI DALAM: pola yang sama dengan
-- `klaim_sudah_bayar`. `search_path` dikunci supaya fungsi ber-definer tidak
-- bisa dibajak lewat skema bayangan.
create or replace function public.konfirmasi_permintaan(
  permintaan_id uuid,
  jenjang_saran jenjang_transport default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.booking_requests%rowtype;
  sesi_id uuid;
begin
  -- Penjaga peran DI DALAM fungsi: `security definer` mematikan RLS, jadi tanpa
  -- baris ini setiap klien yang login bisa mengonfirmasi permintaannya sendiri
  -- lewat RPC — celah yang pernah nyata di proyek ini.
  if user_role() not in ('admin', 'owner') then
    raise exception 'hanya staf yang boleh mengonfirmasi permintaan jadwal'
      using errcode = '42501';
  end if;

  update public.booking_requests
     set status = 'dikonfirmasi'
   where id = permintaan_id
     and status = 'mitra_siap'
  returning * into p;

  -- Tidak mengenai baris mana pun: sudah dikonfirmasi orang lain, dibatalkan
  -- klien, atau belum sampai 'mitra_siap'. NULL dibedakan dari galat oleh
  -- pemanggil, yang memulangkan kalimat untuk manusia.
  if not found then
    return null;
  end if;

  -- CHECK `booking_requests_mitra_siap_bermitra` sudah menjamin ini, tetapi
  -- membiarkannya lolos ke `insert` akan menghasilkan galat FK yang tidak
  -- menyebut sebabnya. Pagar yang berbicara lebih murah daripada pagar yang
  -- benar tetapi bisu.
  if p.partner_id is null then
    raise exception 'permintaan mitra_siap tanpa mitra: %', permintaan_id;
  end if;

  insert into public.sessions (
    client_id, service_id, variant_id, partner_id,
    tanggal, jam_mulai,
    alamat, alamat_lat, alamat_lon,
    jenjang, jenjang_sumber, jenjang_alasan,
    status, booking_request_id
  ) values (
    p.client_id, p.service_id, p.variant_id, p.partner_id,
    p.tanggal, p.jam_mulai,
    -- Alamat & koordinat DISALIN dari baris permintaan, tidak diambil ulang
    -- dari profil klien (spec T6): klien boleh memesan untuk alamat lain, dan
    -- mengambil ulang akan diam-diam mengubah ke mana mitra dikirim.
    p.alamat, p.alamat_lat, p.alamat_lon,
    jenjang_saran,
    -- `jenjang_sumber` DITULIS FUNGSI INI, tidak pernah diterima sebagai
    -- argumen. Lihat dokblok "kenapa hanya SATU argumen" di atas.
    case when jenjang_saran is null then null else 'otomatis' end,
    '',
    'terjadwal', p.id
  )
  returning id into sesi_id;

  return sesi_id;
end;
$$;

-- Anon tidak pernah boleh memanggilnya: anon key tertanam di bundel peramban.
revoke execute on function public.konfirmasi_permintaan(uuid, jenjang_transport)
  from public, anon;
grant execute on function public.konfirmasi_permintaan(uuid, jenjang_transport)
  to authenticated;
```

Server action-nya menjadi tipis — ia menghitung saran jenjang (domain tetap di TypeScript),
memeriksa mitra aktif, lalu memanggil RPC:

```ts
export async function konfirmasiPermintaan(permintaanId: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  // Koordinat dibaca lebih dulu supaya saran jenjang bisa dihitung di sini —
  // rumus jaraknya tinggal di satu bahasa saja (lihat dokblok migrasinya).
  const { data: p } = await supabase
    .from("booking_requests")
    .select("id, alamat_lat, alamat_lon, partner_id, partners ( id, aktif, lat, lon )")
    .eq("id", permintaanId)
    .eq("status", "mitra_siap")
    .maybeSingle();

  if (!p) return { ok: false, pesan: "Permintaan sudah ditangani atau tidak ditemukan." };
  const mitra = p.partners as { aktif: boolean; lat: number | null; lon: number | null } | null;
  if (!mitra?.aktif) {
    return { ok: false, pesan: "Mitra sudah tidak aktif. Pilih mitra lain lebih dulu." };
  }

  const saran = saranJenjang(
    mitra.lat != null && mitra.lon != null ? { lat: mitra.lat, lon: mitra.lon } : null,
    p.alamat_lat != null && p.alamat_lon != null
      ? { lat: p.alamat_lat, lon: p.alamat_lon }
      : null,
  );

  const { data: sesiId, error } = await supabase.rpc("konfirmasi_permintaan", {
    permintaan_id: permintaanId,
    jenjang_saran: saran?.jenjang ?? null,
    // TIDAK ada argumen `jenjang_sumber` — fungsinya yang menuliskannya.
  });

  if (error) return { ok: false, pesan: "Gagal mengonfirmasi. Coba lagi." };
  // Fungsi memulangkan NULL ketika klaimnya tidak mengenai baris mana pun —
  // itu BUKAN galat, dan melaporkannya sebagai keberhasilan adalah kebohongan
  // senyap yang berbentuk sesi yang tidak pernah lahir.
  if (!sesiId) return { ok: false, pesan: "Permintaan sudah ditangani atau tidak ditemukan." };

  revalidatePath("/admin/sesi");
  revalidatePath("/admin");
  revalidatePath("/passport");
  return { ok: true };
}
```

Nilai statusnya tetap ditulis mati di server dan di dalam fungsi — tidak pernah menjadi parameter.
Bila pagar Task 4 memerahkan literalnya di TypeScript, tambahkan konstanta bernama di
`lib/jadwal/status.ts`.

> **Catatan pelaksana:** periksa nama enum jenjang yang sebenarnya sebelum menulis tanda tangan
> fungsi — rencana ini menebaknya `jenjang_transport`:
> ```bash
> cd /Users/arvinfairuz/Documents/padma/web && grep -rn "create type.*jenjang" supabase/migrations/
> ```
> Periksa juga bentuk kembalian `saranJenjang()` di `src/lib/transport/saran.ts`; rencana ini
> mengandaikan `{ jenjang } | null`, mengikuti pemakaiannya di `aksi.ts` hari ini.

- [ ] **Step 8: Layar antrean**

`page.tsx` menarik permintaan dengan `.in("status", STATUS_ANTRE)` (bukan satu status), ikut memilih
`alamat_lat, alamat_lon, partner_id`, dan mengurutkan mitra **per permintaan** dengan
`urutkanMitraMenurutJarak(mitra, koordinatPermintaan)` — jaraknya berbeda untuk setiap alamat, jadi
satu daftar terurut untuk seluruh antrean akan salah untuk semua kecuali satu.

`antrean-permintaan.tsx` menampilkan tombol menurut status:
`diminta` → "Cari bidan"; `mencari_mitra` → daftar mitra terurut (`nama · 3,2 km`) + "Tetapkan
bidan"; `mitra_siap` → nama mitra terpilih + "Konfirmasi". Jarak ditampilkan apa adanya dengan satu
angka desimal, tanpa dibulatkan ke jenjang — admin yang tahu bahwa 4,2 km ke seberang sungai berarti
9 km memutar yang memutuskan.

- [ ] **Step 9: Terapkan, jalankan seluruh uji**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx supabase db reset && npm test
```

- [ ] **Step 10: Commit**

```bash
git add -A web
git commit -m "feat(admin): mitra dipilih dari daftar terurut jarak sebelum konfirmasi (J7)"
```

---

## Task 10: Admin tidak menolak; klien membatalkan sendiri

**Files:**
- Create: `web/supabase/migrations/20260909140000_pembatalan_oleh_klien.sql`
- Create: `web/supabase/migrations/20260909150000_ditolak_tak_terjangkau.sql`
- Modify: `web/src/app/admin/sesi/aksi.ts` (buang pemanggilan `tolakPermintaan` dari layar)
- Modify: `web/src/app/admin/sesi/antrean-permintaan.tsx` (tombol "Tolak" hilang)
- Modify: `web/src/lib/passport/aksi.ts` (action `batalkanPengajuan`)
- Modify: `web/src/app/passport/page.tsx` + `_komponen/kartu-info.tsx` (tombol batal)
- Test: `web/tests/pembatalan-klien.test.ts`

**Interfaces:**
- Consumes: `STATUS_ANTRE` (Task 1).
- Produces: `batalkanPengajuan(permintaanId: string): Promise<Berhasil | Gagal>` di
  `@/lib/passport/aksi`.

**Kenapa dua hal ini satu tugas.** Meniadakan penolakan menutup satu-satunya pintu keluar kedua dari
antrean, sementara `BATAS_PERMINTAAN_MENUNGGU = 5` mengunci klien yang antreannya penuh. Tanpa
penambal, klien yang mengajukan lima tanggal yang tidak bisa dilayani terkunci selamanya dan tidak
seorang pun punya cara membereskannya (spec J8). Menyembunyikan tombol tolak **tanpa** pembatalan
klien di rilis yang sama akan menerbitkan cacat itu ke produksi.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/pembatalan-klien.test.ts`. **Setiap uji pagar di sini WAJIB lewat sesi JWT
sungguhan** (`signInAs`), bukan service role: di bawah service role "pagar bekerja" dan "pagar tidak
ada" terlihat identik — dan sekali itu meloloskan trigger yang benar-benar mati di repo ini.

```ts
/**
 * KLIEN MEMBATALKAN PENGAJUANNYA SENDIRI (spec C1 J8).
 *
 * Empat pagar berlapis diuji satu per satu, karena masing-masing bisa hilang
 * sendiri-sendiri: policy RLS (baris siapa), guard_booking_klien_batal (medan
 * mana), guard_booking_status (status tujuan mana), dan
 * guard_booking_perpindahan (dari keadaan mana).
 *
 * PostgREST menjawab tulisan yang tertahan RLS dengan 200 + [], bukan 403.
 * Karena itu setiap uji membaca ULANG barisnya dengan service role — "tidak ada
 * error" bukan bukti apa pun.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { BATAS_PERMINTAAN_MENUNGGU as BATAS } from "@/lib/passport/batas";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");

const ANANDA = "44444444-4444-4444-4444-444444444401";
/** Klien KEDUA — untuk membuktikan pagar kepemilikan. Sesuaikan dengan seed. */
const KLIEN_LAIN = "44444444-4444-4444-4444-444444444402";
const SVC = "11111111-1111-1111-1111-111111111101";
const MITRA = "33333333-3333-3333-3333-333333333301";
const TGL = "2026-12-28";
const JAM = "09:00";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ref.sesi! }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
}));

const { batalkanPengajuan } = await import("@/lib/passport/aksi");

let VARIAN: string;
let sesiAnanda: SupabaseClient;
let sesiLain: SupabaseClient;

async function bersihkan() {
  await admin.from("sessions").delete().eq("tanggal", TGL);
  await admin.from("booking_requests").delete().eq("tanggal", TGL);
}

async function permintaanPada(
  status: string,
  clientId: string = ANANDA,
  tanggal: string = TGL,
): Promise<string> {
  const { data, error } = await admin
    .from("booking_requests")
    .insert({
      client_id: clientId,
      service_id: SVC,
      variant_id: VARIAN,
      partner_id: status === "mitra_siap" ? MITRA : null,
      tanggal,
      jam_mulai: JAM,
      preferensi_waktu: "pagi",
      alamat: "Jl. Uji Batal No. 3",
      status,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw error;
  return data.id;
}

async function bacaBaris(id: string) {
  const { data } = await admin
    .from("booking_requests")
    .select("status, tanggal, jam_mulai, alamat")
    .eq("id", id)
    .maybeSingle<{ status: string; tanggal: string; jam_mulai: string; alamat: string }>();
  return data;
}

beforeAll(async () => {
  sesiAnanda = await signInAs("ananda@padma.test");
  sesiLain = await signInAs("bunga@padma.test"); // sesuaikan dengan seed
  ref.sesi = sesiAnanda;
  VARIAN = await varianBaku(admin, SVC);
  await bersihkan();
});

beforeEach(async () => {
  ref.sesi = sesiAnanda;
  await bersihkan();
});

afterAll(bersihkan);

describe("klien membatalkan pengajuannya sendiri", () => {
  it("berhasil dari KETIGA keadaan antrean", async () => {
    for (const dari of ["diminta", "mencari_mitra", "mitra_siap"]) {
      await bersihkan();
      const id = await permintaanPada(dari);
      expect(await batalkanPengajuan(id), `dari ${dari}`).toEqual({ ok: true });
      expect((await bacaBaris(id))?.status).toBe("dibatalkan_klien");
    }
  });

  it("antrean berkurang, sehingga klien bisa mengajukan lagi", async () => {
    // INILAH alasan seluruh tugas ini ada. Tanpa jalan keluar ini, klien yang
    // mengajukan lima tanggal yang tidak bisa dilayani terkunci selamanya —
    // admin tidak lagi menolak, dan batasnya tetap lima.
    const ids: string[] = [];
    for (let i = 0; i < BATAS; i++) {
      ids.push(await permintaanPada("diminta", ANANDA, `2027-01-${String(i + 1).padStart(2, "0")}`));
    }
    const { count: sebelum } = await admin
      .from("booking_requests")
      .select("id", { count: "exact", head: true })
      .eq("client_id", ANANDA)
      .in("status", ["diminta", "mencari_mitra", "mitra_siap"]);
    expect(sebelum).toBe(BATAS);

    expect(await batalkanPengajuan(ids[0])).toEqual({ ok: true });

    const { count: sesudah } = await admin
      .from("booking_requests")
      .select("id", { count: "exact", head: true })
      .eq("client_id", ANANDA)
      .in("status", ["diminta", "mencari_mitra", "mitra_siap"]);
    expect(sesudah).toBe(BATAS - 1);

    // Bersihkan tanggal tambahan yang dipakai uji ini.
    await admin.from("booking_requests").delete().in("id", ids);
  });

  it("pengajuan yang sudah DIKONFIRMASI tidak bisa dibatalkan lewat jalur ini", async () => {
    // Sesinya sudah lahir; pembatalan sesi menyangkut uang dan tenggat waktu,
    // dan seluruhnya milik C3 — ia bekerja pada `sessions`, bukan di sini.
    const id = await permintaanPada("dikonfirmasi");
    const hasil = await batalkanPengajuan(id);
    expect(hasil.ok).toBe(false);
    expect((await bacaBaris(id))?.status).toBe("dikonfirmasi");
  });
});

describe("pagar ditembak LANGSUNG ke PostgREST, tanpa server action", () => {
  it("klien LAIN tidak bisa membatalkan pengajuan orang", async () => {
    const id = await permintaanPada("diminta", ANANDA);
    const { data } = await sesiLain
      .from("booking_requests")
      .update({ status: "dibatalkan_klien" })
      .eq("id", id)
      .select("id");
    expect(data ?? []).toEqual([]);
    expect((await bacaBaris(id))?.status).toBe("diminta");
  });

  it("klien tidak bisa menumpangi UPDATE ini untuk mengubah medan LAIN", async () => {
    // Lubang yang paling mudah terlewat: policy UPDATE membuka SELURUH kolom
    // yang boleh ditulis peran itu, bukan hanya `status`. Tanpa kunci kolom,
    // klien bisa menggeser tanggal, jam, atau alamat sambil berpura-pura
    // membatalkan.
    const id = await permintaanPada("diminta", ANANDA);
    const { error } = await sesiAnanda
      .from("booking_requests")
      .update({ status: "dibatalkan_klien", tanggal: "2027-06-01", jam_mulai: "16:00" })
      .eq("id", id)
      .select("id");
    expect(error).not.toBeNull();

    const baris = await bacaBaris(id);
    expect(baris?.tanggal).toBe(TGL);
    expect(baris?.jam_mulai).toBe("09:00:00");
    expect(baris?.status).toBe("diminta");
  });

  it("klien tidak bisa menulis status selain dibatalkan_klien", async () => {
    const id = await permintaanPada("mitra_siap", ANANDA);
    const { error } = await sesiAnanda
      .from("booking_requests")
      .update({ status: "dikonfirmasi" })
      .eq("id", id)
      .select("id");
    expect(error).not.toBeNull();
    expect((await bacaBaris(id))?.status).toBe("mitra_siap");
  });
});

describe("penolakan admin tidak lagi terjangkau dari layar (spec J8)", () => {
  it("tidak ada berkas di src/ yang MEMANGGIL tolakPermintaan", () => {
    // Nilai enum `ditolak` dan penjaganya TETAP di tempatnya — hanya tidak
    // lagi terjangkau dari layar, persis pola saklar paket (lib/paket-tampil.ts).
    // Yang dijaga di sini pemanggilannya, bukan keberadaan fungsinya.
    function berkasTsx(dir: string): string[] {
      const hasil: string[] = [];
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) hasil.push(...berkasTsx(p));
        else if (e.name.endsWith(".tsx")) hasil.push(p);
      }
      return hasil;
    }
    const pemanggil = berkasTsx(path.join(AKAR, "src")).filter((f) =>
      readFileSync(f, "utf8").includes("tolakPermintaan("),
    );
    expect(pemanggil).toEqual([]);
  });

  it("action-nya SENDIRI masih ada, beserta alasannya tertulis", () => {
    const sumber = readFileSync(path.join(AKAR, "src/app/admin/sesi/aksi.ts"), "utf8");
    expect(sumber).toContain("export async function tolakPermintaan");
    expect(sumber).toMatch(/J8/);
  });
});
```

> **Catatan pelaksana:** `KLIEN_LAIN` dan `bunga@padma.test` adalah TEBAKAN. Periksa akun klien
> kedua yang benar-benar ada di seed sebelum menulis:
> ```bash
> cd /Users/arvinfairuz/Documents/padma/web && grep -n "padma.test" supabase/seed.sql | head -20
> ```

- [ ] **Step 2: Jalankan, pastikan MERAH**

- [ ] **Step 3: Tulis migrasi pembatalan**

Buat `web/supabase/migrations/20260909140000_pembatalan_oleh_klien.sql`:

```sql
-- ============================================================================
-- KLIEN MEMBATALKAN PENGAJUANNYA SENDIRI (spec C1 J8)
-- ============================================================================
-- Admin untuk sementara TIDAK menolak pengajuan (tombolnya disembunyikan dengan
-- cara yang sama seperti saklar paket). Itu menutup satu-satunya pintu keluar
-- kedua dari antrean, sementara BATAS_PERMINTAAN_MENUNGGU = 5 mengunci klien
-- yang antreannya penuh: klien yang mengajukan lima tanggal yang tidak bisa
-- dilayani terkunci selamanya, dan tidak seorang pun punya cara membereskannya.
--
-- Penambalnya: kendali atas antrean berpindah ke pemiliknya.
--
-- Seperti seluruh tulisan klien di repo ini, syaratnya ditegakkan DI SINI —
-- bukan hanya di server action. Klien memegang JWT-nya sendiri dan bisa
-- memanggil PostgREST langsung.

-- ===== 1) POLICY UPDATE, DIPERSEMPIT KE BARIS MILIKNYA =====
-- `using` menyaring baris mana yang boleh disentuh; `with check` menyaring
-- baris seperti apa yang boleh dihasilkan. Keduanya perlu: tanpa `with check`,
-- klien bisa memindahkan barisnya ke client_id orang lain.
create policy "booking: klien membatalkan miliknya" on public.booking_requests
  for update to authenticated
  using (
    client_id in (select c.id from public.clients c where c.user_id = auth.uid())
  )
  with check (
    client_id in (select c.id from public.clients c where c.user_id = auth.uid())
  );

-- ===== 2) KUNCI KOLOM =====
-- Policy UPDATE membuka SELURUH kolom yang boleh ditulis peran itu, bukan hanya
-- `status`. Tanpa penjaga ini klien bisa menggeser tanggal, jam, alamat, atau
-- layanan sebuah pengajuan — termasuk pengajuan yang sudah dicarikan mitra —
-- sambil berpura-pura membatalkan. Pola yang diikuti: migration
-- `20260830140000_kunci_kolom_identitas`.
--
-- Daftarnya ditulis sebagai "apa yang BOLEH berubah", bukan "apa yang tidak":
-- kolom baru yang ditambahkan kelak akan otomatis TERKUNCI, bukan otomatis
-- terbuka. Fail-closed.
create or replace function public.guard_booking_klien_batal()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if user_role() = 'klien' then

      -- Satu-satunya perubahan yang boleh dilakukan klien atas barisnya.
      if new.status is distinct from 'dibatalkan_klien'::booking_status then
        raise exception 'klien hanya boleh membatalkan pengajuannya'
          using errcode = '42501';
      end if;

      if old.status not in ('diminta', 'mencari_mitra', 'mitra_siap') then
        raise exception 'pengajuan yang sudah dikonfirmasi tidak bisa dibatalkan dari sini'
          using errcode = '42501';
      end if;

      -- Seluruh medan lain WAJIB sama persis. `is distinct from` (bukan `<>`)
      -- supaya NULL dibandingkan benar.
      if new.id            is distinct from old.id
      or new.client_id     is distinct from old.client_id
      or new.service_id    is distinct from old.service_id
      or new.variant_id    is distinct from old.variant_id
      or new.partner_id    is distinct from old.partner_id
      or new.tanggal       is distinct from old.tanggal
      or new.jam_mulai     is distinct from old.jam_mulai
      or new.preferensi_waktu is distinct from old.preferensi_waktu
      or new.catatan       is distinct from old.catatan
      or new.alamat        is distinct from old.alamat
      or new.alamat_lat    is distinct from old.alamat_lat
      or new.alamat_lon    is distinct from old.alamat_lon
      or new.created_at    is distinct from old.created_at
      then
        raise exception 'klien tidak boleh mengubah isi pengajuan, hanya membatalkannya'
          using errcode = '42501';
      end if;

    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_booking_klien_batal() from public, anon;

create trigger trg_guard_booking_klien_batal
  before update on public.booking_requests
  for each row execute function public.guard_booking_klien_batal();

-- ===== 3) `guard_booking_status` DILONGGARKAN, TEPAT SEBESAR INI =====
-- Versi sebelumnya menolak SETIAP perubahan status oleh klien. Sekarang satu
-- tujuan diizinkan — dan hanya karena tiga penjaga lain di atas sudah
-- mempersempitnya ke "barisnya sendiri, dari keadaan antrean, tanpa menyentuh
-- medan apa pun".
create or replace function public.guard_booking_status()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if user_role() = 'klien' then
      if tg_op = 'INSERT' and new.status is distinct from 'diminta'::booking_status then
        raise exception 'permintaan jadwal baru selalu berstatus diminta'
          using errcode = '42501';
      end if;
      if tg_op = 'UPDATE' and new.status is distinct from old.status then
        if new.status is distinct from 'dibatalkan_klien'::booking_status then
          raise exception 'status permintaan jadwal hanya boleh diubah staf'
            using errcode = '42501';
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_booking_status() from public, anon;
```

Buat juga `web/supabase/migrations/20260909150000_ditolak_tak_terjangkau.sql` — berisi komentar
yang menyatakan mengapa `ditolak` dipertahankan dan tidak lagi terjangkau, supaya keputusannya hidup
di basis data dan bukan hanya di spec:

```sql
comment on type booking_status is
  'Rantai status permintaan C1. ''ditolak'' DIPERTAHANKAN nilainya untuk '
  'permintaan lama, tetapi tidak lagi terjangkau dari layar mana pun (spec J8): '
  'admin tidak menolak, klien yang membatalkan. Menghapus nilainya berarti '
  'kehilangan riwayat. ''menunggu_bayar'' sengaja BELUM ada — ia milik C2, '
  'disisipkan antara ''mitra_siap'' dan ''dikonfirmasi''.';
```

- [ ] **Step 4: Tulis `batalkanPengajuan`**

Di `web/src/lib/passport/aksi.ts`, mengikuti pola `klaimSudahBayar` yang sudah ada (sesi pengguna,
tujuan hardcoded, memeriksa jumlah baris terpengaruh):

```ts
/**
 * Klien membatalkan pengajuannya sendiri (spec J8).
 *
 * Penegaknya ada di basis data — policy "booking: klien membatalkan miliknya"
 * plus tiga trigger yang mempersempitnya ke "barisnya sendiri, dari keadaan
 * antrean, tanpa menyentuh medan apa pun". Yang dilakukan di sini hanyalah
 * memulangkan KALIMAT yang bisa dibaca manusia; ia bukan pagar.
 */
export async function batalkanPengajuan(permintaanId: string): Promise<Berhasil | Gagal> {
  const clientId = await klienSaatIni();
  if (!clientId) return { ok: false, pesan: "Akun belum terhubung." };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("booking_requests")
    .update({ status: "dibatalkan_klien" })
    .eq("id", permintaanId)
    .eq("client_id", clientId)          // pagar kedua; yang pertama policy RLS
    .in("status", STATUS_ANTRE)
    .select("id");

  if (error) return { ok: false, pesan: "Gagal membatalkan. Coba lagi." };
  if ((data ?? []).length === 0) {
    return {
      ok: false,
      pesan: "Pengajuan ini sudah dikonfirmasi atau sudah dibatalkan sebelumnya.",
    };
  }

  revalidatePath("/passport");
  return { ok: true };
}
```

- [ ] **Step 5: Layar**

Buang tombol "Tolak" dari `antrean-permintaan.tsx` beserta impor `tolakPermintaan`. Action-nya
**tetap ada** di `aksi.ts` — persis pola saklar paket: kodenya tinggal, jalannya ditutup. Tambahkan
komentar di atasnya yang menyebut spec J8 dan alasan ia tidak dipanggil.

Di passport, kartu pengajuan yang masih di antrean mendapat tombol "Batalkan pengajuan" dengan
konfirmasi. Kartu yang sudah `dikonfirmasi` **tidak** mendapat tombol itu — kalimatnya menyebut
bahwa perubahan jadwal dilakukan lewat tim PADMA (pembatalan sesi milik C3).

- [ ] **Step 6: Terapkan & jalankan seluruh uji**

```bash
cd /Users/arvinfairuz/Documents/padma/web && npx supabase db reset && npm test
```

- [ ] **Step 7: Commit**

```bash
git add -A web
git commit -m "feat(passport): klien membatalkan pengajuannya, admin tidak lagi menolak (J8)"
```

---

## Task 11: E2E — skrip yang menegaskan dunia sebelum C1

**Dikerjakan sebagai tugas tersendiri, bukan sebagai renungan di akhir.** Ini persis yang
menjatuhkan Tahap A: review akhir menemukan tiga blok E2E yang menegaskan dunia lama, dan rencananya
tidak pernah menyebutnya (keterangan langsung penulis spec).

**Files:**
- Modify: `web/tests/e2e/passport.e2e.ts` — menegaskan `status permintaan = "menunggu"`
- Modify: `web/tests/e2e/admin-operasional.e2e.ts` — menjadwalkan & menyelesaikan sesi lewat panel
- Modify: `web/tests/e2e/access-matrix.e2e.ts` — bila ia menyentuh antrean permintaan
- Modify: `web/tests/e2e/admin-pelengkap.e2e.ts` — bila ia menyentuh status permintaan
- Modify: `web/tests/e2e-selektor.test.ts` — bila selektor layar antrean berubah

`tests/e2e/funnel-skrining.e2e.ts` **tidak** disentuh di rencana ini: ia berakhir di WhatsApp dan
harus ditulis ulang sampai ke pemesanan — pekerjaan itu milik C1-b, yang mengubah layar hasil
skrining.

- [ ] **Step 1: Nyalakan server & jalankan keempat skrip untuk melihat kerusakan sebenarnya**

Daftar di atas adalah dugaan. Yang mengikat adalah hasil run.

```bash
cd /Users/arvinfairuz/Documents/padma/web
npm run build && npm run start   # terminal terpisah, biarkan hidup
```

Lalu, satu per satu (**jangan `test:e2e:semua`, jangan `test:e2e:video`** — Global Constraint 1):

```bash
npm run test:e2e            # access-matrix
npm run test:e2e:passport
npm run test:e2e:admin
npm run test:e2e:pelengkap
npm run test:e2e:owner
```

Catat kegagalan pertama tiap skrip. Skrip ini berhenti pada kegagalan pertama karena `waitFor`
melempar — jadi daftar kepatahannya **tidak pernah lengkap sejak awal**. Perbaiki, jalankan lagi,
tangani apa pun yang muncul di belakangnya.

- [ ] **Step 2: Perbaiki `passport.e2e.ts`**

Assertion 5b berbunyi `br?.[0]?.status === "menunggu"`. Ia harus menjadi `"diminta"`, dan
dokblok di kepala berkas ("Permintaan jadwal dari klien selalu berstatus `menunggu`") ikut
diperbarui — komentar basi di berkas uji adalah cara paling murah menyesatkan pembaca berikutnya.
Fixture insert `booking_requests` di berkas itu juga butuh `jam_mulai`.

- [ ] **Step 3: Perbaiki `admin-operasional.e2e.ts`**

Skrip ini menjadwalkan sesi lewat panel. Alur antreannya kini tiga langkah (Cari bidan → Tetapkan
bidan → Konfirmasi), bukan satu. Perbarui langkahnya, dan tambahkan assertion baru yang menegaskan
rantainya benar-benar dilewati — bukan sekadar bahwa sesinya lahir.

- [ ] **Step 4: Jalankan ulang sampai kelimanya hijau**

- [ ] **Step 5: Commit**

```bash
git add -A web/tests
git commit -m "test(e2e): skrip mengikuti rantai status & jam sesudah C1-a"
```

---

## Task 12: README, catatan tindak lanjut, dan penutupan

- [ ] **Step 0: J13 harus menghasilkan sesuatu yang BISA GAGAL**

J13 menyatakan Circle tidak akan menjadi kasus khusus: tidak ada peserta jamak, tidak ada transport
patungan, tidak ada honor yang dibagi — Circle hanyalah varian berformat lain dengan harga lebih
murah. Karena tidak ada kode yang perlu ditulis, godaannya adalah tidak menulis apa pun — dan
kesunyian itu kelak terbaca sebagai "belum dikerjakan", lalu dibuka lagi untuk ketiga kalinya
(sudah ditunda di spec varian §9 dan spec transport).

Tambahkan ke `web/tests/varian-struktur.test.ts` (atau berkas baru `tests/circle-bukan-rombongan.test.ts`):

```ts
it("Circle tidak punya perlakuan khusus di jalur pemesanan (spec J13)", () => {
  // Klien menutup perkara ini 8 September 2026: tidak ada pembeda antara
  // Private dan Circle SELAIN HARGA. Pemesan Circle tetap satu orang, satu
  // akun, satu sesi. Uji ini bukan menjaga fitur — ia menjaga KETIADAAN
  // fitur, supaya "belum dikerjakan" tidak pernah menjadi kesimpulan orang
  // yang membaca kode ini enam bulan lagi.
  const sumber = [
    "src/lib/passport/aksi.ts",
    "src/app/passport/ajukan/form.tsx",
    "src/app/admin/sesi/aksi.ts",
  ].map((rel) => readFileSync(path.join(AKAR, rel), "utf8"));

  for (const isi of sumber) {
    expect(isi).not.toMatch(/peserta|rombongan|patungan/i);
  }
});
```

Run: `cd web && npx vitest run tests/circle-bukan-rombongan.test.ts` — harus HIJAU sejak awal. Bila
merah, berarti ada kode rombongan yang sudah merayap masuk dan itulah temuannya.

- [ ] **Step 1: Perbarui tabel rute README**

`tests/inventaris-rute.test.ts` menjaga tabel itu dua arah. Rencana ini **tidak** menambah rute,
tetapi mengubah keterangan dua baris yang kini berbohong:

```markdown
| `/passport/ajukan` | Klien | Ajukan jadwal: varian, tanggal, JAM, alamat — selalu berstatus `diminta` |
| `/admin/sesi` | Admin, Owner | Antrean permintaan (cari bidan → tetapkan bidan → konfirmasi), jadwalkan sesi, tandai selesai |
```

Run: `cd web && npx vitest run tests/inventaris-rute.test.ts`

- [ ] **Step 2: Tulis catatan tindak lanjut**

Buat `docs/superpowers/2026-09-09-c1a-tindak-lanjut.md` berisi, jujur dan tanpa dibaguskan: apa yang
benar-benar dikerjakan, apa yang ditemukan di jalan yang tidak ada di spec maupun rencana ini, utang
yang sengaja ditinggalkan, dan hal-hal yang perlu diketahui C1-b sebelum ia mulai. Ikuti bentuk
`docs/superpowers/2026-09-08-panel-sapuan-tindak-lanjut.md`.

Yang **wajib** ada di dalamnya:
- apakah `npx supabase db reset` bekerja di mesin ini (Global Constraint 18 masih terbuka);
- daftar berkas uji yang disunting karena `jam_mulai`, supaya C1-b tahu ia akan menyentuh berkas
  yang sama lagi untuk `screening_id`;
- nama constraint sebenarnya pada `app_setting_keys` (Task 6 Step 3 menebaknya).

- [ ] **Step 3: Verifikasi akhir — jalankan semuanya, dan tunjukkan keluarannya**

Sebelum menyatakan rencana ini selesai (`superpowers:verification-before-completion`): bukti lebih
dulu, klaim menyusul.

```bash
cd /Users/arvinfairuz/Documents/padma/web
npm test                 # umumkan dulu ke sesi lain
npm run lint
npm run build            # matikan `next start` dulu — Global Constraint 3b
```

Lalu, dengan server hidup, kelima skrip E2E dari Task 11 satu per satu.

Tempelkan ringkasan keluaran sungguhannya ke catatan tindak lanjut. **Jangan menyatakan hijau tanpa
keluaran yang menunjukkannya**; bila ada yang merah, tulis apa yang merah dan mengapa.

- [ ] **Step 4: Commit & selesaikan branch**

```bash
cd /Users/arvinfairuz/Documents/padma
git add web/README.md docs/superpowers/2026-09-09-c1a-tindak-lanjut.md
git commit -m "docs(c1a): tabel rute & catatan tindak lanjut rantai status"
```

**Jangan `git add -A`** (Global Constraint 19) — worktree utama memuat aset milik pemilik repo yang
belum ter-commit.

Lalu pakai `superpowers:finishing-a-development-branch` untuk memutuskan cara menggabungkannya.
Rencana C1-b ditulis sesudah ini, dengan kode nyata sebagai acuan.

---

## Yang SENGAJA tidak dikerjakan rencana ini

Ditulis eksplisit supaya tidak dikira terlewat:

- **Skrining sebagai syarat setiap pengajuan** (J3–J6), **skrining merah boleh diulang** (J9), dan
  **fase klien dari skrining** (J11) — C1-b. Sampai itu ada, `booking_requests.screening_id` belum
  lahir dan klien mana pun bisa memesan tanpa skrining.
- **Rating layanan & bidan** (J10) dan **QRIS asli** (J12) — C1-c. Prasyarat J12 sudah beres:
  `web/public/qris-padma.jpeg` di-commit 8 September pukul 14:07 lewat `e520b7a`, dan kini ada di
  `main`.
- **`menunggu_bayar`, pencocokan uang masuk, tenggat bayar, pemberitahuan tiga kanal** — C2.
- **Pembatalan berjenjang waktu, jadwal ulang, kredit layanan, no-show, peninjauan darurat medis** —
  C3. Rencana ini hanya menyediakan bahan bakunya: jam sesi dan `jamSampaiSesi()`.
- **Circle sebagai sesi rombongan** — J13 menyatakan ia tidak ada, dan tidak ada yang perlu
  dikerjakan. Circle adalah varian berformat lain dengan harga lebih murah; formulir pemesanan
  memperlakukannya persis seperti varian mana pun.
- **Katalog produksi & honor transport jenjang >5 km** — utang terbuka yang menunggu klien, bukan
  pekerjaan kode.
