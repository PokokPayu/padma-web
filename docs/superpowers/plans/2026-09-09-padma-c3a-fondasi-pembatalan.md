# PADMA C3-a — Fondasi Pembatalan & Jadwal Ulang: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menjalankan kebijakan pembatalan empat jenjang PADMA dari panel admin — jenjang dihitung dari waktu, kredit terbit sebagai objek hak, jadwal ulang memakai jatah, dan setiap keputusan berjejak.

**Architecture:** Jenjang adalah fungsi murni TypeScript atas `tanggal + jam_mulai` dalam WIB; ia tidak pernah disimpan. Perubahan status sesi berjalan lewat tiga fungsi Postgres *security definer* (`batalkan_sesi`, `jadwal_ulang_sesi`, `tukar_hak_sesi`) supaya dua tulisan yang harus jadi satu keputusan tidak bisa gagal separuh, dan supaya klien tidak pernah perlu diberi hak UPDATE atas `sessions`. Kredit berwujud baris `hak_sesi` tanpa satu pun kolom nominal.

**Tech Stack:** Next.js 16.3.3 (App Router, server actions), Supabase Postgres + RLS, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-padma-c3-pembatalan-design.md`
**Kebijakan sumber:** `docs/superpowers/2026-09-08-kebijakan-pembatalan-klien.md` — salinan utuh poster klien. **Jangan meringkasnya dari ingatan.**

## Global Constraints

- **Zona waktu WIB, offset `+07:00` tetap.** Pakai `instanSesi()` / `jamSampaiSesi()` dari `@/lib/jadwal/jam`. Jangan pernah memakai zona mesin: Vercel berjalan UTC dan pergeserannya tujuh jam.
- **Ambang: `≥ 24 jam` → jenjang 1; `2 ≤ x < 24` → jenjang 2; `< 2 jam` → jenjang 3.** Jenjang 4 = PADMA yang membatalkan, bukan hitungan waktu.
- **Kredit berlaku 30 hari sejak TANGGAL SESI yang batal**, bukan sejak tanggal pembatalan.
- **Jatah jadwal ulang 1× per pemesanan**, menempel pada baris sesi. Jadwal ulang **mengubah baris yang sama**, tidak pernah membuat baris baru.
- **Tidak boleh ada satu pun kolom nominal uang** di tabel baru. `tests/money-firewall-struktural.test.ts` memindai seluruh skema dan akan merah; itu benar, bukan gangguan.
- **Klien tidak boleh diberi policy UPDATE atas `sessions`.** Semua lewat RPC *security definer*.
- **Migrasi nilai enum HARUS terpisah dari migrasi yang memakainya.** `alter type ... add value` lalu memakai nilainya di transaksi yang sama menghasilkan `55P04`. Supabase CLI menjalankan tiap berkas dalam transaksinya sendiri.
- **`create or replace function` mengganti SELURUH badan.** Bila menyentuh fungsi yang sudah ada, salin badan lamanya apa adanya termasuk komentarnya, lalu ubah bagian yang memang berubah. Pelajaran ini dibayar mahal di C1-a.
- **Tabel jejak tanpa foreign key**, dan `authenticated` tidak memegang DELETE atasnya.
- **Semua nama berkas, tabel, kolom, fungsi, dan teks UI dalam bahasa Indonesia**, mengikuti seluruh repo.
- Perintah dijalankan dari `web/`. Uji: `npx vitest run <berkas>`. Suite penuh: `npm test`. Basis data lokal: `npx supabase start` harus sudah jalan.
- **Basis data lokal dipakai bersama sesi lain.** Sebelum menjalankan suite penuh atau `db:recover`, koordinasikan. Uji yang berjalan bersamaan saling memerahkan.
- **Jangan `supabase db push`.** Migrasi diterapkan lokal saja; produksi dikerjakan pemilik.

---

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `web/src/lib/pembatalan/jenjang.ts` (baru) | Fungsi MURNI: jenjang dari waktu, akibat dari jenjang, label untuk manusia. Tanpa impor basis data. |
| `web/supabase/migrations/20260913100000_status_sesi_nilai.sql` (baru) | HANYA `alter type session_status add value 'dibatalkan_klien'`. |
| `web/supabase/migrations/20260913101000_hak_sesi_dan_jejak.sql` (baru) | Tabel `hak_sesi` & `jejak_jadwal`, kolom `sessions.jadwal_ulang_terpakai`, RLS, grant. |
| `web/supabase/migrations/20260913102000_rpc_pembatalan.sql` (baru) | `batalkan_sesi()`, `jadwal_ulang_sesi()`, `tukar_hak_sesi()`. |
| `web/src/lib/pembatalan/hak.ts` (baru) | Membaca `hak_sesi` yang masih berlaku milik seorang klien. |
| `web/src/lib/admin/pembatalan.ts` (baru) | Merakit tampilan admin: jenjang terhitung + akibatnya untuk satu sesi. |
| `web/src/app/admin/sesi/aksi-pembatalan.ts` (baru) | Server action pembungkus ketiga RPC. |
| `web/src/app/admin/sesi/panel-pembatalan.tsx` (baru) | Komponen klien di dalam panel sesi. |
| `web/src/app/admin/sesi/panel-sesi.tsx` (ubah) | Menyisipkan `<PanelPembatalan>`. |
| `web/tests/pembatalan-jenjang.test.ts` (baru) | Fungsi murni, termasuk ambang & jebakan zona waktu. |
| `web/tests/hak-sesi-struktur.test.ts` (baru) | Bentuk tabel, RLS, grant, indeks unik. |
| `web/tests/pembatalan-rpc.test.ts` (baru) | Perilaku ketiga RPC. |
| `web/tests/jejak-yatim.test.ts` (ubah) | Pagar yatim diperluas ke `jejak_jadwal`. |

---

## Task 1: Fungsi jenjang murni

**Files:**
- Create: `web/src/lib/pembatalan/jenjang.ts`
- Test: `web/tests/pembatalan-jenjang.test.ts`

**Interfaces:**
- Consumes: `jamSampaiSesi(tanggal: string, jam: string, sekarang?: Date): number` dari `@/lib/jadwal/jam` — sudah ada, memulangkan pecahan apa adanya (negatif = sudah lewat).
- Produces:
  - `type Jenjang = 1 | 2 | 3 | 4`
  - `type Akibat = "refund" | "hak" | "hangus"`
  - `jenjangPembatalan(tanggal: string, jam: string, sekarang?: Date): 1 | 2 | 3`
  - `akibatPembatalan(jenjang: Jenjang): Akibat`
  - `HARI_BERLAKU_HAK = 30`
  - `kedaluwarsaHak(tanggalSesi: string): string`
  - `LABEL_JENJANG_PEMBATALAN: Record<Jenjang, string>`
  - `KALIMAT_AKIBAT: Record<Akibat, string>`

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/pembatalan-jenjang.test.ts`:

```ts
/**
 * JENJANG PEMBATALAN (spec C3 P1, P2).
 *
 * Seluruh berkas ini berjalan tanpa basis data — jenjang adalah fungsi murni
 * atas waktu. Yang dijaga paling keras: zona waktunya. Vercel berjalan UTC,
 * dan menghitung ambang dengan kalender mesin menggeser batasnya tujuh jam.
 * Bentuk kegagalannya adalah uang klien: refund yang seharusnya penuh berubah
 * menjadi kredit, atau kredit yang hangus sehari lebih awal.
 */
import { describe, it, expect } from "vitest";
import {
  jenjangPembatalan,
  akibatPembatalan,
  kedaluwarsaHak,
  HARI_BERLAKU_HAK,
} from "@/lib/pembatalan/jenjang";

describe("ambang jenjang", () => {
  it("persis 24 jam sebelum sesi masih jenjang 1", () => {
    // Batas atas bersifat INKLUSIF: poster menulis "≥ 24 jam". Klien yang
    // membatalkan tepat 24 jam sebelumnya berhak refund penuh, dan pergeseran
    // satu detik di sini adalah selisih antara uang kembali dan kredit.
    const sesi = { tanggal: "2027-03-10", jam: "09:00" };
    const sekarang = new Date("2027-03-09T02:00:00Z"); // 09:00 WIB, H-1
    expect(jenjangPembatalan(sesi.tanggal, sesi.jam, sekarang)).toBe(1);
  });

  it("sedetik di bawah 24 jam jatuh ke jenjang 2", () => {
    const sekarang = new Date("2027-03-09T02:00:01Z");
    expect(jenjangPembatalan("2027-03-10", "09:00", sekarang)).toBe(2);
  });

  it("persis 2 jam sebelum sesi masih jenjang 2", () => {
    const sekarang = new Date("2027-03-10T00:00:00Z"); // 07:00 WIB
    expect(jenjangPembatalan("2027-03-10", "09:00", sekarang)).toBe(2);
  });

  it("sedetik di bawah 2 jam jatuh ke jenjang 3", () => {
    const sekarang = new Date("2027-03-10T00:00:01Z");
    expect(jenjangPembatalan("2027-03-10", "09:00", sekarang)).toBe(3);
  });

  it("sesi yang SUDAH LEWAT tetap jenjang 3, bukan berputar balik", () => {
    // Selisih negatif. Perbandingan yang ditulis terbalik akan menyebutnya
    // jenjang 1 — dan sesi yang sudah lewat lalu dibatalkan akan mengembalikan
    // uang penuh.
    const sekarang = new Date("2027-03-11T00:00:00Z");
    expect(jenjangPembatalan("2027-03-10", "09:00", sekarang)).toBe(3);
  });
});

describe("zona waktu — satu-satunya uji yang merah bila WIB hilang", () => {
  it("sesi 08.00 WIB dibatalkan 02.00 UTC hari yang sama = 1 jam lagi, bukan sudah lewat", () => {
    // 02:00 UTC = 09:00 WIB. Sesi 08:00 WIB berarti sudah lewat 1 jam →
    // jenjang 3. Yang menghitung dengan kalender UTC akan melihat "08:00 vs
    // 02:00" dan menyimpulkan masih 6 jam lagi → jenjang 2. Uji ini merah
    // TEPAT ketika offset WIB-nya hilang, dan tidak merah karena hal lain.
    const sekarang = new Date("2027-03-10T02:00:00Z");
    expect(jenjangPembatalan("2027-03-10", "08:00", sekarang)).toBe(3);
  });

  it("sesi 08.00 WIB dibatalkan 22.00 UTC hari SEBELUMNYA = 3 jam lagi", () => {
    // 22:00 UTC tanggal 9 = 05:00 WIB tanggal 10. Sesi 08:00 WIB → 3 jam lagi
    // → jenjang 2. Kalender mesin akan menyebutnya beda hari dan salah jenjang.
    const sekarang = new Date("2027-03-09T22:00:00Z");
    expect(jenjangPembatalan("2027-03-10", "08:00", sekarang)).toBe(2);
  });
});

describe("akibat mengikuti jenjang, dan hanya jenjang", () => {
  it("jenjang 1 mengembalikan uang", () => {
    expect(akibatPembatalan(1)).toBe("refund");
  });

  it("jenjang 2 menerbitkan hak, BUKAN uang", () => {
    // Inilah sebabnya jenjang 2 tidak pernah menyentuh tabel uang sama sekali.
    expect(akibatPembatalan(2)).toBe("hak");
  });

  it("jenjang 3 tidak mengembalikan apa pun", () => {
    expect(akibatPembatalan(3)).toBe("hangus");
  });

  it("jenjang 4 — PADMA yang membatalkan — mengembalikan uang penuh", () => {
    expect(akibatPembatalan(4)).toBe("refund");
  });
});

describe("kedaluwarsa hak", () => {
  it("berlakunya 30 hari", () => {
    expect(HARI_BERLAKU_HAK).toBe(30);
  });

  it("dihitung dari TANGGAL SESI, bukan tanggal pembatalan", () => {
    // Keputusan pemilik. Menghitungnya sejak pembatalan menghukum klien yang
    // membatalkan lebih awal — insentif terbalik, karena justru pembatalan
    // awal yang memungkinkan slotnya dijual lagi.
    expect(kedaluwarsaHak("2027-03-10")).toBe("2027-04-09");
  });

  it("menyeberangi pergantian bulan dan tahun dengan benar", () => {
    expect(kedaluwarsaHak("2027-12-20")).toBe("2028-01-19");
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `npx vitest run tests/pembatalan-jenjang.test.ts`
Expected: FAIL — `Cannot find module '@/lib/pembatalan/jenjang'`

- [ ] **Step 3: Tulis implementasinya**

Buat `web/src/lib/pembatalan/jenjang.ts`:

```ts
import { jamSampaiSesi } from "@/lib/jadwal/jam";

/**
 * JENJANG PEMBATALAN — DITURUNKAN, TIDAK PERNAH DISIMPAN (spec C3 P1).
 *
 * Kebijakan lengkapnya ada di `docs/superpowers/2026-09-08-kebijakan-pembatalan-klien.md`,
 * disalin utuh dari poster klien. JANGAN meringkasnya dari ingatan — isinya
 * sudah pernah disalahsebutkan dua kali sebelum berkas kebijakan itu ada.
 *
 * Seluruh berkas ini MURNI: tidak ada impor basis data, tidak ada `new Date()`
 * tersembunyi. `sekarang` selalu bisa disuntikkan, karena fungsi waktu yang
 * membaca jamnya sendiri tidak bisa diuji di ambangnya — dan ambang itulah
 * satu-satunya tempat fungsi ini bisa salah.
 */

export type Jenjang = 1 | 2 | 3 | 4;
export type Akibat = "refund" | "hak" | "hangus";

/** Berapa lama hak sesi berlaku, dalam hari. Angkanya dari poster klien. */
export const HARI_BERLAKU_HAK = 30;

const AMBANG_PENUH_JAM = 24;
const AMBANG_BERANGKAT_JAM = 2;

/**
 * Jenjang sebuah pembatalan menurut sisa waktu menuju sesi.
 *
 * TIDAK memulangkan 4: jenjang 4 bukan pertanyaan waktu melainkan pertanyaan
 * siapa (PADMA yang membatalkan). Memasukkannya ke sini akan memaksa fungsi
 * murni ini tahu tentang aktor, dan aktor datang dari sesi pengguna.
 *
 * Ambang `< 2 jam` sekaligus mewakili "mitra sudah berangkat" (spec C3 P2):
 * dalam praktik PADMA bidan berangkat sekitar dua jam sebelumnya, jadi kedua
 * pemicu itu berimpit dan penanda terpisahnya sengaja tidak dibuat.
 */
export function jenjangPembatalan(
  tanggal: string,
  jam: string,
  sekarang: Date = new Date(),
): 1 | 2 | 3 {
  const sisa = jamSampaiSesi(tanggal, jam, sekarang);
  if (sisa >= AMBANG_PENUH_JAM) return 1;
  if (sisa >= AMBANG_BERANGKAT_JAM) return 2;
  // Termasuk sisa NEGATIF (sesi sudah lewat). Ditulis sebagai jatuhan terakhir,
  // bukan sebagai perbandingan tersendiri, supaya tidak ada celah di antaranya.
  return 3;
}

/**
 * Apa yang klien terima. Diturunkan dari jenjang, tidak pernah dipilih
 * pemanggil — pilihan yang bisa dikirim peramban adalah pilihan yang bisa
 * dinaikkan sendiri oleh klien.
 */
export function akibatPembatalan(jenjang: Jenjang): Akibat {
  if (jenjang === 3) return "hangus";
  if (jenjang === 2) return "hak";
  return "refund"; // jenjang 1 dan 4
}

/**
 * Tanggal kedaluwarsa hak, dihitung dari TANGGAL SESI yang batal.
 *
 * Memakai UTC di dalam sengaja: yang dihitung adalah jarak KALENDER 30 hari,
 * bukan titik waktu. `Date.UTC` membuat penambahan hari tidak pernah tergeser
 * oleh jam atau zona mana pun, dan hasilnya dipulangkan sebagai `YYYY-MM-DD`
 * yang sama bentuknya dengan kolom `date` di basis data.
 */
export function kedaluwarsaHak(tanggalSesi: string): string {
  const [th, bl, hr] = tanggalSesi.split("-").map(Number);
  const t = new Date(Date.UTC(th, bl - 1, hr + HARI_BERLAKU_HAK));
  return t.toISOString().slice(0, 10);
}

export const LABEL_JENJANG_PEMBATALAN: Record<Jenjang, string> = {
  1: "24 jam atau lebih sebelum sesi",
  2: "2–24 jam sebelum sesi",
  3: "Kurang dari 2 jam, atau sesi sudah lewat",
  4: "Dibatalkan PADMA",
};

export const KALIMAT_AKIBAT: Record<Akibat, string> = {
  refund: "Dana dikembalikan penuh.",
  hak: `Dana menjadi hak satu sesi untuk layanan yang sama, berlaku ${HARI_BERLAKU_HAK} hari sejak tanggal sesi.`,
  hangus: "Dana tidak dapat dikembalikan. Jadwal ulang dihitung sebagai pemesanan baru.",
};
```

- [ ] **Step 4: Jalankan uji, pastikan LULUS**

Run: `npx vitest run tests/pembatalan-jenjang.test.ts`
Expected: PASS (16 uji)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/pembatalan/jenjang.ts web/tests/pembatalan-jenjang.test.ts
git commit -m "feat(pembatalan): jenjang diturunkan dari waktu sesi dalam WIB

Fungsi murni, ambangnya 24 jam dan 2 jam. Jenjang 4 sengaja tidak ada di
sini: ia pertanyaan siapa, bukan pertanyaan waktu."
```

---

## Task 2: Tabel `hak_sesi`, `jejak_jadwal`, kolom jatah

**Files:**
- Create: `web/supabase/migrations/20260913100000_status_sesi_nilai.sql`
- Create: `web/supabase/migrations/20260913101000_hak_sesi_dan_jejak.sql`
- Create: `web/tests/hak-sesi-struktur.test.ts`
- Modify: `web/tests/jejak-yatim.test.ts`

**Interfaces:**
- Consumes: `HARI_BERLAKU_HAK = 30` (Task 1) — hanya sebagai rujukan komentar; SQL menuliskan `30` sendiri.
- Produces (dipakai Task 3 & 4): tabel `public.hak_sesi`, `public.jejak_jadwal`, kolom `public.sessions.jadwal_ulang_terpakai boolean not null default false`, nilai enum `session_status.dibatalkan_klien`.

- [ ] **Step 1: Tulis migrasi NILAI ENUM (berkas terpisah)**

Buat `web/supabase/migrations/20260913100000_status_sesi_nilai.sql`:

```sql
-- ============================================================================
-- C3-a (1/2): NILAI ENUM STATUS SESI
-- ============================================================================
-- Berkas ini HANYA menambah anggota enum, dan itu wajib terpisah: nilai yang
-- baru ditambahkan tidak boleh DIPAKAI di transaksi yang sama
-- (`55P04 unsafe use of new value`), sedangkan Supabase CLI menjalankan tiap
-- berkas migrasi dalam transaksinya sendiri. Aturan "tidak boleh di dalam
-- transaksi sama sekali" adalah Postgres SEBELUM v12 dan tidak berlaku di sini.
--
-- `dibatalkan_klien` berdampingan dengan `dibatalkan_padma` yang sudah ada, dan
-- pemisahannya disengaja: status adalah CATATAN TENTANG SIAPA. Jenjang 4
-- (PADMA membatalkan) mengembalikan uang penuh; klien yang membatalkan sendiri
-- tunduk pada jenjang waktu. Menumpangkan keduanya pada satu nilai membuat
-- setiap layar dan setiap laporan salah menyebut apa yang terjadi.
alter type session_status add value 'dibatalkan_klien';
```

- [ ] **Step 2: Tulis migrasi TABEL**

Buat `web/supabase/migrations/20260913101000_hak_sesi_dan_jejak.sql`:

```sql
-- ============================================================================
-- C3-a (2/2): HAK SESI, JEJAK JADWAL, JATAH JADWAL ULANG
-- ============================================================================

-- ---------------------------------------------------------------------------
-- HAK SESI — kredit berwujud OBJEK HAK, bukan saldo (spec C3 P3)
-- ---------------------------------------------------------------------------
-- TIDAK ADA satu pun kolom nominal di sini, dan itu bukan kelalaian melainkan
-- intinya. Money firewall struktural (`tests/money-firewall-struktural.test.ts`)
-- hanya mengizinkan kolom uang di `variant_rates`, `honor_marks`,
-- `transport_rates`, dan `transport_khusus`; menaruh nilai kredit di sini akan
-- merah, dan itu benar. Konsekuensi yang DIINGINKAN: jenjang 2 tidak pernah
-- menyentuh tabel uang sama sekali. Klien menerima HAK, bukan saldo — dan hak
-- tidak bisa dicairkan, tidak bisa dipindahkan, dan tidak menuntut
-- rekonsiliasi.
--
-- Namanya sengaja tidak menyebut "kredit" maupun "paket": bila paket kelak
-- dibuka (saklar PAKET_TAMPIL), paket menerbitkan SEPULUH baris di tabel yang
-- sama alih-alih melahirkan mekanisme kedua.
create table public.hak_sesi (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  -- LAYANAN TERKUNCI. Permintaan pemilik: hak tidak bisa dipindah ke layanan
  -- lain, "agar lebih mudah". Menyimpannya sebagai kolom wajib membuat aturan
  -- itu ditegakkan struktur, bukan diingat pemanggil.
  service_id uuid not null references public.services(id),
  kedaluwarsa date not null,
  -- Sesi yang batal dan melahirkan hak ini. Tanpa FK ke sessions: sesi bisa
  -- dihapus, sedangkan hak yang sudah terbit tetap milik klien.
  sesi_asal_id uuid,
  -- Sesi baru yang menghabiskan hak ini. NULL selama belum dipakai.
  dipakai_sesi_id uuid,
  created_at timestamptz not null default now()
);

-- SATU hak, SATU sesi. Parsial supaya baris yang belum dipakai (NULL) tidak
-- saling bentrok — tanpa `where`, hanya satu hak di seluruh tabel yang boleh
-- belum terpakai.
create unique index hak_sesi_dipakai_sekali
  on public.hak_sesi (dipakai_sesi_id)
  where dipakai_sesi_id is not null;

create index hak_sesi_milik_klien on public.hak_sesi (client_id, kedaluwarsa);

alter table public.hak_sesi enable row level security;

-- Klien MEMBACA miliknya sendiri, dan hanya itu. Tidak ada policy INSERT,
-- UPDATE, maupun DELETE untuk siapa pun kecuali staf: hak terbit dari fungsi
-- `security definer` (Task 3), tidak pernah dari peramban. Klien yang bisa
-- menyisipkan barisnya sendiri adalah klien yang bisa mencetak sesi gratis.
create policy "hak_sesi: klien baca miliknya" on public.hak_sesi for select
  to authenticated
  using (client_id = auth.uid());

create policy "hak_sesi: staf" on public.hak_sesi for all
  to authenticated
  using (public.user_role() in ('admin', 'owner'))
  with check (public.user_role() in ('admin', 'owner'));

-- ---------------------------------------------------------------------------
-- JATAH JADWAL ULANG (spec C3 P4)
-- ---------------------------------------------------------------------------
-- Menempel pada BARIS SESI, dan jadwal ulang mengubah baris yang sama.
-- Alternatif yang ditolak: membatalkan baris lama lalu membuat baris baru.
-- Baris baru lahir dengan jatah kosong, sehingga "1× per pemesanan" bisa
-- di-reset tanpa batas hanya dengan menjadwal ulang berulang — aturannya jadi
-- bohong tanpa satu pun galat. Riwayat perpindahannya tidak hilang: ia hidup
-- di `jejak_jadwal` di bawah.
alter table public.sessions
  add column jadwal_ulang_terpakai boolean not null default false;

-- ---------------------------------------------------------------------------
-- JEJAK JADWAL (spec C3 P6)
-- ---------------------------------------------------------------------------
-- SENGAJA TANPA foreign key ke `sessions`, mengikuti `jejak_status_bayar`:
-- `clients -> sessions` adalah ON DELETE CASCADE, jadi FK ke sana akan
-- menghapus tepat bukti yang menjelaskan penghapusan itu.
--
-- Ongkosnya nyata dan harus ditanggung: setiap berkas uji yang menghapus sesi
-- WAJIB menyapu jejaknya sendiri, atau `tests/jejak-yatim.test.ts` merah di
-- suite yang tidak menyentuh pembatalan sama sekali.
create table public.jejak_jadwal (
  id uuid primary key default gen_random_uuid(),
  sesi_id uuid not null,
  tindakan text not null check (tindakan in ('batal', 'jadwal_ulang', 'tukar_hak')),
  -- 1..4. Disimpan APA ADANYA hasil hitungan saat tindakan dilakukan — ini
  -- catatan sejarah, bukan turunan yang bisa dihitung ulang: aturannya bisa
  -- berubah, dan jejak harus tetap menyebut aturan yang berlaku saat itu.
  jenjang smallint not null check (jenjang between 1 and 4),
  dari_tanggal date,
  dari_jam time,
  ke_tanggal date,
  ke_jam time,
  -- Wajib berisi untuk pengecualian darurat medis (spec C3 P7); untuk tindakan
  -- biasa boleh kosong.
  alasan text not null default '',
  darurat boolean not null default false,
  -- nullable: jalur service role (seed, pembersihan uji) tidak punya auth.uid()
  aktor_id uuid,
  peran_aktor text not null,
  dicatat_pada timestamptz not null default now()
);

create index jejak_jadwal_sesi on public.jejak_jadwal (sesi_id, dicatat_pada);

alter table public.jejak_jadwal enable row level security;

create policy "jejak_jadwal: staf baca" on public.jejak_jadwal for select
  to authenticated
  using (public.user_role() in ('admin', 'owner'));

-- TIDAK ADA policy INSERT/UPDATE/DELETE untuk siapa pun. Barisnya ditulis
-- fungsi `security definer`, dan baris audit tidak boleh dihapus oleh admin
-- yang sedang diaudit. Pembersihan di uji WAJIB lewat service role.
```

- [ ] **Step 3: Terapkan migrasi & tulis uji struktur**

Run: `npx supabase migration up --local`
Expected: dua migrasi baru terpakai tanpa galat.

Buat `web/tests/hak-sesi-struktur.test.ts`:

```ts
/**
 * BENTUK & HAK TABEL C3-a (spec C3 P3, P4, P6).
 *
 * Yang dijaga di sini adalah struktur, bukan perilaku: perilaku RPC diuji di
 * `tests/pembatalan-rpc.test.ts`. Pemisahannya disengaja — struktur yang salah
 * membuat seluruh uji perilaku gagal dengan pesan yang menunjuk ke tempat yang
 * salah.
 */
import { describe, it, expect, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";

const admin = createAdminSupabase();

const ANANDA = "44444444-4444-4444-4444-444444444401";
// Klien KEDUA. Rina punya baris `clients` tetapi SENGAJA tanpa akun auth
// (`scripts/seed-users.ts` menegakkan itu), jadi ia tidak bisa login — dan
// memang tidak perlu: yang diuji adalah Ananda yang login MENCOBA menyentuh
// baris milik orang lain, bukan Rina yang mencoba apa pun.
const RINA = "44444444-4444-4444-4444-444444444402";
const SVC = "11111111-1111-1111-1111-111111111101";

afterAll(async () => {
  await admin.from("hak_sesi").delete().eq("client_id", ANANDA);
  await admin.from("hak_sesi").delete().eq("client_id", RINA);
});

describe("hak_sesi tidak punya satu pun kolom uang", () => {
  it("kolomnya hanya identitas, tanggal, dan rujukan", async () => {
    // Bila kelak seseorang menambahkan `nilai_kredit`, money firewall akan
    // merah lebih dulu. Uji ini menyebut alasannya dengan kalimat, supaya yang
    // membacanya tahu bahwa ketiadaan nominal adalah keputusan.
    const kolom = await querySql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'hak_sesi'`,
    );
    expect(kolom.map((k) => k.column_name).sort()).toEqual(
      [
        "client_id",
        "created_at",
        "dipakai_sesi_id",
        "id",
        "kedaluwarsa",
        "service_id",
        "sesi_asal_id",
      ].sort(),
    );
  });
});

describe("satu hak hanya bisa dipakai sekali", () => {
  it("indeks uniknya PARSIAL — dua hak yang belum dipakai boleh hidup bersama", async () => {
    // Tanpa `where dipakai_sesi_id is not null`, hanya SATU hak di seluruh
    // tabel yang boleh belum terpakai, dan klien kedua yang membatalkan akan
    // ditolak dengan galat yang tidak masuk akal.
    const { error: e1 } = await admin.from("hak_sesi").insert({
      client_id: ANANDA,
      service_id: SVC,
      kedaluwarsa: "2027-12-31",
    });
    const { error: e2 } = await admin.from("hak_sesi").insert({
      client_id: ANANDA,
      service_id: SVC,
      kedaluwarsa: "2027-12-31",
    });
    expect(e1).toBeNull();
    expect(e2).toBeNull();
  });

  it("dua hak TIDAK bisa menunjuk sesi terpakai yang sama", async () => {
    const sesiPalsu = "99999999-9999-9999-9999-999999999901";
    const { data } = await admin
      .from("hak_sesi")
      .select("id")
      .eq("client_id", ANANDA)
      .limit(2);
    const [a, b] = data as { id: string }[];

    const { error: ea } = await admin
      .from("hak_sesi")
      .update({ dipakai_sesi_id: sesiPalsu })
      .eq("id", a.id);
    const { error: eb } = await admin
      .from("hak_sesi")
      .update({ dipakai_sesi_id: sesiPalsu })
      .eq("id", b.id);

    expect(ea).toBeNull();
    expect(eb, "satu sesi bisa lahir dari dua hak sekaligus").not.toBeNull();

    await admin.from("hak_sesi").update({ dipakai_sesi_id: null }).eq("id", a.id);
  });
});

describe("klien tidak bisa mencetak haknya sendiri", () => {
  it("klien MEMBACA miliknya", async () => {
    const sesi = await signInAs("ananda@padma.test");
    const { data, error } = await sesi.from("hak_sesi").select("id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("klien TIDAK bisa menyisipkan hak", async () => {
    // Klien yang bisa menyisipkan barisnya sendiri adalah klien yang bisa
    // mencetak sesi gratis tanpa batas.
    const sesi = await signInAs("ananda@padma.test");
    const { error } = await sesi.from("hak_sesi").insert({
      client_id: ANANDA,
      service_id: SVC,
      kedaluwarsa: "2099-12-31",
    });
    expect(error).not.toBeNull();
  });

  it("klien TIDAK bisa memperpanjang kedaluwarsa haknya", async () => {
    const sesi = await signInAs("ananda@padma.test");
    const { data } = await sesi.from("hak_sesi").select("id").limit(1);
    const { data: sesudah, error } = await sesi
      .from("hak_sesi")
      .update({ kedaluwarsa: "2099-12-31" })
      .eq("id", (data as { id: string }[])[0].id)
      .select("id");
    // RLS tanpa policy UPDATE memulangkan NOL BARIS, bukan galat — bentuk
    // kegagalan yang paling mudah dikira berhasil.
    expect(error === null ? (sesudah ?? []).length : 0).toBe(0);
  });

  it("klien TIDAK bisa melihat hak milik klien lain", async () => {
    await admin.from("hak_sesi").insert({
      client_id: RINA,
      service_id: SVC,
      kedaluwarsa: "2027-12-31",
    });
    const sesi = await signInAs("ananda@padma.test");
    const { data } = await sesi.from("hak_sesi").select("client_id");
    expect((data ?? []).every((h) => h.client_id === ANANDA)).toBe(true);
  });
});

describe("jejak jadwal tidak bisa dihapus oleh yang diaudit", () => {
  it("`authenticated` tidak memegang DELETE", async () => {
    const baris = await querySql<{ ada: boolean }>(
      `select has_table_privilege('authenticated', 'public.jejak_jadwal', 'delete') as ada`,
    );
    expect(baris[0].ada).toBe(false);
  });

  it("tidak punya foreign key ke sessions — cascade akan menghapus buktinya", async () => {
    const fk = await querySql<{ jml: string }>(
      `select count(*) as jml from information_schema.table_constraints
        where table_schema = 'public' and table_name = 'jejak_jadwal'
          and constraint_type = 'FOREIGN KEY'`,
    );
    expect(Number(fk[0].jml)).toBe(0);
  });
});

describe("jatah jadwal ulang lahir kosong", () => {
  it("kolomnya not null dengan default false", async () => {
    const baris = await querySql<{ is_nullable: string; column_default: string }>(
      `select is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'sessions'
          and column_name = 'jadwal_ulang_terpakai'`,
    );
    expect(baris[0].is_nullable).toBe("NO");
    expect(baris[0].column_default).toBe("false");
  });
});
```

- [ ] **Step 4: Perluas pagar jejak yatim**

Di `web/tests/jejak-yatim.test.ts`, tambahkan blok berikut **setelah** describe yang sudah ada (jangan mengubah yang lama):

```ts
describe("higiene jejak_jadwal (C3-a)", () => {
  it("tidak ada baris jejak jadwal YATIM", async () => {
    // Alasan yang sama dengan jejak pembayaran: tabelnya sengaja tanpa foreign
    // key, jadi menghapus sesi tidak menyapu jejaknya. Setiap berkas uji yang
    // membuat lalu menghapus sesi WAJIB menyapu `jejak_jadwal` miliknya sendiri
    // lewat service role — `authenticated` memang tidak boleh punya DELETE.
    const yatim = await querySql<{ id: string; sesi_id: string; tindakan: string }>(
      `select j.id, j.sesi_id, j.tindakan
         from public.jejak_jadwal j
         left join public.sessions s on s.id = j.sesi_id
        where s.id is null`,
    );
    expect(
      yatim.length,
      `${yatim.length} baris jejak_jadwal menunjuk sesi yang sudah tidak ada.\n` +
        yatim.map((y) => `  - ${y.tindakan} pada sesi ${y.sesi_id}`).join("\n"),
    ).toBe(0);
  });
});
```

- [ ] **Step 5: Jalankan uji, pastikan LULUS**

Run: `npx vitest run tests/hak-sesi-struktur.test.ts tests/jejak-yatim.test.ts tests/money-firewall-struktural.test.ts`
Expected: PASS semua. Money firewall wajib tetap hijau — bila merah, ada kolom nominal yang lolos masuk.

- [ ] **Step 6: Commit**

```bash
git add web/supabase/migrations/20260913100000_status_sesi_nilai.sql \
        web/supabase/migrations/20260913101000_hak_sesi_dan_jejak.sql \
        web/tests/hak-sesi-struktur.test.ts web/tests/jejak-yatim.test.ts
git commit -m "feat(pembatalan): hak_sesi tanpa kolom uang, jejak_jadwal, jatah jadwal ulang

Kredit berwujud objek hak, bukan saldo — jenjang 2 karena itu tidak pernah
menyentuh tabel uang sama sekali, dan money firewall yang menegakkannya.
Jatah menempel pada baris sesi supaya jadwal ulang tidak bisa me-reset-nya."
```

---

## Task 3: RPC `batalkan_sesi()`

**Files:**
- Create: `web/supabase/migrations/20260913102000_rpc_pembatalan.sql` (bagian pertama; Task 4 & 5 menambah fungsi ke berkas yang sama)
- Create: `web/tests/pembatalan-rpc.test.ts`

**Interfaces:**
- Consumes: `hak_sesi`, `jejak_jadwal`, nilai enum `dibatalkan_klien` (Task 2); `public.user_role()` (sudah ada).
- Produces: `public.batalkan_sesi(sesi_id uuid, alasan text, darurat boolean) returns jsonb` — memulangkan `{"jenjang": n, "akibat": "refund|hak|hangus", "hak_id": uuid|null}`, atau `null` bila sesi tidak ditemukan / tidak berstatus `terjadwal`.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/pembatalan-rpc.test.ts`:

```ts
/**
 * PEMBATALAN & JADWAL ULANG LEWAT RPC (spec C3 P1, P3, P4, P5, P7).
 *
 * Yang paling penting di berkas ini: pembatalan jenjang 2 adalah DUA tulisan
 * yang harus berlaku sebagai SATU keputusan — sesi menjadi batal, dan haknya
 * terbit. Kegagalan di antaranya meninggalkan klien tanpa sesi dan tanpa
 * gantinya, dan itu bentuk kegagalan paling mahal di seluruh C3.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { querySql } from "./helpers/db";
import { kedaluwarsaHak } from "@/lib/pembatalan/jenjang";

const admin = createAdminSupabase();

const ANANDA = "44444444-4444-4444-4444-444444444401";
// Klien KEDUA. Rina punya baris `clients` tetapi SENGAJA tanpa akun auth
// (`scripts/seed-users.ts` menegakkannya), jadi ia tidak pernah login di sini —
// perannya hanya sebagai PEMILIK baris yang dicoba disentuh Ananda.
const RINA = "44444444-4444-4444-4444-444444444402";
const SVC = "11111111-1111-1111-1111-111111111101";
const MITRA = "33333333-3333-3333-3333-333333333301";

let VARIAN: string;
let sesiKlien: SupabaseClient;
let sesiAdmin: SupabaseClient;

/** Tanggal jauh di depan supaya tidak bentrok dengan fixture berkas lain. */
const TGL_JAUH = "2027-09-20"; // jenjang 1
const TGL_DEKAT = "2027-09-21"; // dipakai dengan jam yang digeser

async function bersihkan() {
  const { data } = await admin
    .from("sessions")
    .select("id")
    .in("tanggal", [TGL_JAUH, TGL_DEKAT, "2027-09-25", "2027-09-26"]);
  const ids = (data ?? []).map((s) => s.id as string);
  if (ids.length > 0) {
    // Jejak DULU: tabelnya tanpa foreign key, jadi tidak ada cascade yang
    // menyapunya, dan `tests/jejak-yatim.test.ts` akan merah bila dilewati.
    await admin.from("jejak_jadwal").delete().in("sesi_id", ids);
    await admin.from("jejak_status_bayar").delete().in("sesi_id", ids);
  }
  await admin.from("hak_sesi").delete().in("client_id", [ANANDA, RINA]);
  await admin.from("sessions").delete().in("tanggal", [TGL_JAUH, TGL_DEKAT, "2027-09-25", "2027-09-26"]);
}

/** Satu sesi terjadwal & lunas milik klien yang disebut. */
async function buatSesiUntuk(klien: string, tanggal: string, jam: string): Promise<string> {
  const { data, error } = await admin
    .from("sessions")
    .insert({
      client_id: klien,
      service_id: SVC,
      variant_id: VARIAN,
      partner_id: MITRA,
      tanggal,
      jam_mulai: jam,
      status: "terjadwal",
      status_bayar: "lunas",
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw error;
  return data.id;
}

/** Pintasan untuk klien uji utama. */
async function buatSesi(tanggal: string, jam: string): Promise<string> {
  return buatSesiUntuk(ANANDA, tanggal, jam);
}

/** Jam yang membuat sesi HARI INI berjarak `jam` dari sekarang, dalam WIB. */
function jamRelatif(jamDariSekarang: number): { tanggal: string; jam: string } {
  const t = new Date(Date.now() + jamDariSekarang * 3_600_000);
  // Digeser ke WIB lalu dipotong — kolomnya date + time menurut Jakarta.
  const wib = new Date(t.getTime() + 7 * 3_600_000);
  return {
    tanggal: wib.toISOString().slice(0, 10),
    jam: wib.toISOString().slice(11, 16),
  };
}

beforeAll(async () => {
  VARIAN = await varianBaku(admin, SVC);
  sesiKlien = await signInAs("ananda@padma.test");
  sesiAdmin = await signInAs("admin@padma.test");
  await bersihkan();
});

beforeEach(bersihkan);
afterAll(bersihkan);

describe("batalkan_sesi — jenjang menentukan akibat", () => {
  it("jenjang 1 (≥24 jam): sesi batal, TIDAK ada hak yang terbit", async () => {
    const { tanggal, jam } = jamRelatif(48);
    const id = await buatSesi(tanggal, jam);

    const { data } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "",
      darurat: false,
    });

    expect(data.jenjang).toBe(1);
    expect(data.akibat).toBe("refund");
    expect(data.hak_id).toBeNull();

    const { count } = await admin
      .from("hak_sesi")
      .select("id", { count: "exact", head: true })
      .eq("client_id", ANANDA);
    expect(count).toBe(0);
  });

  it("jenjang 2 (2–24 jam): sesi batal DAN tepat satu hak terbit", async () => {
    const { tanggal, jam } = jamRelatif(6);
    const id = await buatSesi(tanggal, jam);

    const { data } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "",
      darurat: false,
    });

    expect(data.jenjang).toBe(2);
    expect(data.akibat).toBe("hak");
    expect(data.hak_id).not.toBeNull();

    const { data: hak } = await admin
      .from("hak_sesi")
      .select("service_id, kedaluwarsa, sesi_asal_id, dipakai_sesi_id")
      .eq("id", data.hak_id)
      .single();

    expect(hak!.service_id, "hak terkunci ke layanan yang sama").toBe(SVC);
    expect(hak!.sesi_asal_id).toBe(id);
    expect(hak!.dipakai_sesi_id).toBeNull();
    expect(hak!.kedaluwarsa, "30 hari sejak TANGGAL SESI").toBe(kedaluwarsaHak(tanggal));
  });

  it("jenjang 3 (<2 jam): batal tanpa hak dan tanpa refund", async () => {
    const { tanggal, jam } = jamRelatif(1);
    const id = await buatSesi(tanggal, jam);

    const { data } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "",
      darurat: false,
    });

    expect(data.jenjang).toBe(3);
    expect(data.akibat).toBe("hangus");
    expect(data.hak_id).toBeNull();
  });
});

describe("darurat medis menaikkan ke perlakuan jenjang 1", () => {
  it("sesi 1 jam lagi + darurat + alasan = jenjang 1", async () => {
    // "Ditinjau" di poster berarti keputusan MANUSIA. Sistem tidak pernah
    // mendeteksi keadaan darurat sendiri.
    const { tanggal, jam } = jamRelatif(1);
    const id = await buatSesi(tanggal, jam);

    const { data } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "Klien masuk rumah sakit, konfirmasi via WA 09.15",
      darurat: true,
    });

    expect(data.jenjang).toBe(1);
    expect(data.akibat).toBe("refund");
  });

  it("darurat TANPA alasan DITOLAK", async () => {
    // Pengecualian tanpa catatan adalah pengecualian yang tidak bisa ditinjau
    // siapa pun setelahnya.
    const { tanggal, jam } = jamRelatif(1);
    const id = await buatSesi(tanggal, jam);

    const { error } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "   ",
      darurat: true,
    });
    expect(error).not.toBeNull();
  });

  it("KLIEN tidak bisa menyatakan dirinya darurat", async () => {
    const { tanggal, jam } = jamRelatif(1);
    const id = await buatSesi(tanggal, jam);

    const { error } = await sesiKlien.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "darurat",
      darurat: true,
    });
    expect(error).not.toBeNull();
  });
});

describe("hak & kepemilikan", () => {
  it("klien TIDAK bisa membatalkan sesi orang lain walau tahu id-nya", async () => {
    // Sesinya milik RINA; yang mencoba adalah Ananda yang login. Arah ini
    // dipilih karena Rina sengaja tidak punya akun auth di seed — dan yang
    // sedang diuji memang penyerangnya, bukan korbannya.
    const { tanggal, jam } = jamRelatif(48);
    const id = await buatSesiUntuk(RINA, tanggal, jam);

    const { data, error } = await sesiKlien.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "",
      darurat: false,
    });
    expect(data === null || error !== null).toBe(true);

    const { data: sesudah } = await admin
      .from("sessions")
      .select("status")
      .eq("id", id)
      .single();
    expect(sesudah!.status).toBe("terjadwal");
  });

  it("anon tidak bisa mengeksekusinya sama sekali", async () => {
    const baris = await querySql<{ ada: boolean }>(
      `select has_function_privilege('anon',
         'public.batalkan_sesi(uuid, text, boolean)', 'execute') as ada`,
    );
    expect(baris[0].ada).toBe(false);
  });
});

describe("idempotensi & jejak", () => {
  it("dipanggil DUA KALI tidak menerbitkan dua hak", async () => {
    // Klien yang menekan tombol dua kali karena jaringan lambat tidak boleh
    // mendapat dua kredit.
    const { tanggal, jam } = jamRelatif(6);
    const id = await buatSesi(tanggal, jam);

    await sesiAdmin.rpc("batalkan_sesi", { sesi_id: id, alasan: "", darurat: false });
    const { data: kedua } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "",
      darurat: false,
    });

    expect(kedua, "panggilan kedua mengenai baris yang sudah batal").toBeNull();

    const { count } = await admin
      .from("hak_sesi")
      .select("id", { count: "exact", head: true })
      .eq("sesi_asal_id", id);
    expect(count).toBe(1);
  });

  it("mencatat jejak beraktor, berjenjang, dan bertanggal sesi asal", async () => {
    const { tanggal, jam } = jamRelatif(6);
    const id = await buatSesi(tanggal, jam);
    await sesiAdmin.rpc("batalkan_sesi", { sesi_id: id, alasan: "", darurat: false });

    const { data: jejak } = await admin
      .from("jejak_jadwal")
      .select("tindakan, jenjang, dari_tanggal, peran_aktor, aktor_id")
      .eq("sesi_id", id)
      .single();

    expect(jejak!.tindakan).toBe("batal");
    expect(jejak!.jenjang).toBe(2);
    expect(jejak!.dari_tanggal).toBe(tanggal);
    expect(jejak!.peran_aktor).toBe("admin");
    expect(jejak!.aktor_id, "jejak tanpa aktor tidak bisa ditinjau").not.toBeNull();
  });

  it("STAF yang membatalkan mencatat jenjang 4, bukan jenjang waktu", async () => {
    // Ini pembedaan yang paling mudah hilang: admin membatalkan sesi H-3 hari
    // BUKAN karena kliennya minta, melainkan karena PADMA berhalangan. Yang
    // membedakan bukan waktu melainkan siapa — dan hanya `dibatalkan_padma`
    // yang menyebutnya benar.
    const { tanggal, jam } = jamRelatif(48);
    const id = await buatSesi(tanggal, jam);

    const { data } = await sesiAdmin.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "Bidan sakit mendadak",
      darurat: false,
    });
    expect(data.jenjang).toBe(4);

    const { data: sesudah } = await admin
      .from("sessions")
      .select("status")
      .eq("id", id)
      .single();
    expect(sesudah!.status).toBe("dibatalkan_padma");
  });
});
```

> **Catatan untuk pelaksana:** uji terakhir menuntut `batalkan_sesi` membedakan aktor. Aturannya: **staf yang membatalkan selalu jenjang 4** (`dibatalkan_padma`); **klien yang membatalkan** tunduk pada jenjang waktu (`dibatalkan_klien`). Konsekuensinya, uji-uji jenjang 1/2/3 di atas dijalankan dengan sesi admin **atas nama klien** — supaya keduanya bisa dibedakan, RPC menerima jenjang 4 hanya bila pemanggilnya staf DAN parameter `alasan` terisi. Bila uji jenjang 1/2/3 di atas dijalankan dengan `sesiAdmin` tanpa alasan, jenjangnya dihitung dari waktu. Tulis fungsinya persis begitu; itulah yang membuat seluruh berkas ini konsisten.

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `npx vitest run tests/pembatalan-rpc.test.ts`
Expected: FAIL — `Could not find the function public.batalkan_sesi`

- [ ] **Step 3: Tulis fungsinya**

Buat `web/supabase/migrations/20260913102000_rpc_pembatalan.sql`:

```sql
-- ============================================================================
-- C3-a: PEMBATALAN, JADWAL ULANG, PENUKARAN HAK
-- ============================================================================
-- Ketiganya `security definer`, dan itu keputusan dengan dua alasan (spec C3 P5):
--
--  1. ATOMISITAS. Membatalkan di jenjang 2 adalah dua tulisan yang harus
--     berlaku sebagai satu keputusan: sesi menjadi batal, DAN haknya terbit.
--     Kegagalan di antaranya meninggalkan klien tanpa sesi dan tanpa gantinya.
--
--  2. PERMUKAAN TULIS. Policy UPDATE untuk klien atas `sessions` akan membuka
--     seluruh kolom baris itu — termasuk `status_bayar`, `partner_id`, dan
--     `jenjang`. Fungsi definer membuka TEPAT satu tindakan. Kepemilikan
--     diperiksa DI DALAM fungsi terhadap `auth.uid()`, tidak pernah
--     dipercayakan kepada pemanggil.

-- ---------------------------------------------------------------------------
-- Ambang jenjang, dalam SATU tempat di sisi SQL.
-- ---------------------------------------------------------------------------
-- Rumusnya kembar dengan `jenjangPembatalan()` di TypeScript, dan kembaran itu
-- disengaja & terbatas: TypeScript memakainya untuk MENAMPILKAN akibat sebelum
-- admin menekan, SQL memakainya untuk MEMUTUSKAN. Yang memutuskan tidak boleh
-- ada di lapisan yang bisa dilewati satu panggilan RPC. Pasangan yang sama
-- sudah ada untuk jarak (`jarak_km` vs `haversineKm`), dan dijaga uji
-- `tests/jarak-sql-vs-ts.test.ts`.
create or replace function public.jenjang_pembatalan(tanggal date, jam time)
returns smallint
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    -- `at time zone 'Asia/Jakarta'` mengubah timestamp tanpa zona menjadi
    -- timestamptz yang benar. Menghitungnya dengan zona server (UTC di Vercel)
    -- menggeser batasnya tujuh jam, dan yang bergeser bersamanya adalah uang
    -- klien.
    when ((tanggal + jam) at time zone 'Asia/Jakarta') - now() >= interval '24 hours' then 1
    when ((tanggal + jam) at time zone 'Asia/Jakarta') - now() >= interval '2 hours'  then 2
    else 3
  end::smallint;
$$;

revoke execute on function public.jenjang_pembatalan(date, time) from public, anon;
grant execute on function public.jenjang_pembatalan(date, time) to authenticated;

-- ---------------------------------------------------------------------------
-- BATALKAN SESI
-- ---------------------------------------------------------------------------
-- Aturan aktor, dan ini pembedaan yang paling mudah hilang saat kode dirapikan:
--
--   staf + alasan terisi  → JENJANG 4, status `dibatalkan_padma`
--                            (PADMA yang berhalangan; refund penuh)
--   selain itu            → jenjang dari WAKTU, status `dibatalkan_klien`
--
-- Keduanya sama-sama "batal", dan siapa pun yang menyatukannya akan merasa
-- sedang menyederhanakan. Yang hilang bila disatukan: setiap layar dan setiap
-- laporan berhenti bisa menyebut siapa yang membatalkan.
create or replace function public.batalkan_sesi(
  sesi_id uuid,
  alasan text,
  darurat boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.sessions%rowtype;
  peran text := public.user_role();
  staf boolean := peran in ('admin', 'owner');
  jenjang smallint;
  akibat text;
  hak uuid;
  status_baru session_status;
begin
  -- Darurat medis adalah pengecualian yang HARUS bisa ditinjau setelahnya, dan
  -- pengecualian tanpa catatan tidak bisa ditinjau siapa pun. Diperiksa lebih
  -- dulu supaya penolakannya tidak menyentuh baris apa pun.
  if darurat then
    if not staf then
      raise exception 'hanya staf yang boleh menerapkan pengecualian darurat'
        using errcode = '42501';
    end if;
    if btrim(coalesce(alasan, '')) = '' then
      raise exception 'pengecualian darurat menuntut alasan tertulis'
        using errcode = '23514';
    end if;
  end if;

  select * into s from public.sessions where id = sesi_id;
  if not found then
    return null;
  end if;

  -- Kepemilikan diperiksa DI SINI, bukan dipercayakan kepada pemanggil.
  if not staf and s.client_id <> auth.uid() then
    raise exception 'sesi ini bukan milik Anda' using errcode = '42501';
  end if;

  if staf and btrim(coalesce(alasan, '')) <> '' and not darurat then
    jenjang := 4;
    status_baru := 'dibatalkan_padma';
  else
    jenjang := case when darurat then 1 else public.jenjang_pembatalan(s.tanggal, s.jam_mulai) end;
    status_baru := 'dibatalkan_klien';
  end if;

  akibat := case jenjang when 2 then 'hak' when 3 then 'hangus' else 'refund' end;

  -- Hanya sesi yang MASIH terjadwal bisa dibatalkan. Klausa `and status` inilah
  -- yang membuat pemanggilan kedua tidak mengenai baris apa pun — sehingga
  -- menekan tombol dua kali tidak pernah menerbitkan dua hak.
  update public.sessions
     set status = status_baru
   where id = sesi_id
     and status = 'terjadwal'
  returning * into s;

  if not found then
    return null;
  end if;

  if akibat = 'hak' then
    insert into public.hak_sesi (client_id, service_id, kedaluwarsa, sesi_asal_id)
    values (
      s.client_id,
      s.service_id,
      -- 30 hari sejak TANGGAL SESI, bukan sejak hari ini (spec C3 P3).
      s.tanggal + 30,
      s.id
    )
    returning id into hak;
  end if;

  insert into public.jejak_jadwal (
    sesi_id, tindakan, jenjang, dari_tanggal, dari_jam,
    alasan, darurat, aktor_id, peran_aktor
  ) values (
    s.id, 'batal', jenjang, s.tanggal, s.jam_mulai,
    coalesce(alasan, ''), darurat, auth.uid(), peran
  );

  return jsonb_build_object('jenjang', jenjang, 'akibat', akibat, 'hak_id', hak);
end;
$$;

revoke execute on function public.batalkan_sesi(uuid, text, boolean) from public, anon;
grant execute on function public.batalkan_sesi(uuid, text, boolean) to authenticated;
```

- [ ] **Step 4: Terapkan & jalankan uji**

Run: `npx supabase migration up --local && npx vitest run tests/pembatalan-rpc.test.ts`
Expected: PASS (11 uji)

- [ ] **Step 5: Commit**

```bash
git add web/supabase/migrations/20260913102000_rpc_pembatalan.sql web/tests/pembatalan-rpc.test.ts
git commit -m "feat(pembatalan): batalkan_sesi — dua tulisan, satu keputusan

Jenjang 2 menerbitkan hak DAN membatalkan sesi dalam satu transaksi; gagal
separuh berarti klien kehilangan sesi tanpa gantinya. Staf yang membatalkan
selalu jenjang 4 — yang membedakan bukan waktu melainkan siapa."
```

---

## Task 4: RPC `jadwal_ulang_sesi()`

**Files:**
- Modify: `web/supabase/migrations/20260913102000_rpc_pembatalan.sql` — **tambahkan** fungsi baru di akhir berkas. Jangan menyentuh `batalkan_sesi` maupun `jenjang_pembatalan`.
- Modify: `web/tests/pembatalan-rpc.test.ts` — tambahkan describe baru di akhir.

**Interfaces:**
- Consumes: `public.jenjang_pembatalan(date, time)`, `sessions.jadwal_ulang_terpakai` (Task 2 & 3).
- Produces: `public.jadwal_ulang_sesi(sesi_id uuid, tanggal_baru date, jam_baru time) returns jsonb` — `{"jenjang": n, "jatah_terpakai": bool}`, `null` bila sesi tidak ditemukan/tidak terjadwal. Melempar `23514` bila jatah habis, `23505` bila bidannya bentrok, `22023` bila jamnya di luar `app_settings.jam_layanan`.

- [ ] **Step 1: Tulis uji yang gagal**

Tambahkan di akhir `web/tests/pembatalan-rpc.test.ts`:

```ts
describe("jadwal_ulang_sesi — baris yang SAMA berpindah", () => {
  it("jenjang 1: berpindah tanpa memakai jatah", async () => {
    // Poster memberi pilihan bebas di ≥24 jam: refund penuh ATAU jadwal ulang
    // gratis. Jatah hanya relevan di jendela 2–24 jam.
    const { tanggal, jam } = jamRelatif(48);
    const id = await buatSesi(tanggal, jam);

    const { data } = await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-09-25",
      jam_baru: "10:00",
    });

    expect(data.jenjang).toBe(1);
    expect(data.jatah_terpakai).toBe(false);

    const { data: s } = await admin
      .from("sessions")
      .select("id, tanggal, jam_mulai, status, jadwal_ulang_terpakai")
      .eq("id", id)
      .single();

    expect(s!.id, "baris yang SAMA, bukan baris baru").toBe(id);
    expect(s!.tanggal).toBe("2027-09-25");
    expect(s!.jam_mulai).toBe("10:00:00");
    expect(s!.status).toBe("terjadwal");
    expect(s!.jadwal_ulang_terpakai).toBe(false);
  });

  it("jenjang 2: berpindah DAN jatahnya terpakai", async () => {
    const { tanggal, jam } = jamRelatif(6);
    const id = await buatSesi(tanggal, jam);

    const { data } = await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-09-25",
      jam_baru: "11:00",
    });

    expect(data.jenjang).toBe(2);
    expect(data.jatah_terpakai).toBe(true);

    const { data: s } = await admin
      .from("sessions")
      .select("jadwal_ulang_terpakai")
      .eq("id", id)
      .single();
    expect(s!.jadwal_ulang_terpakai).toBe(true);
  });

  it("jatah HABIS: percobaan kedua di jendela 2–24 jam DITOLAK", async () => {
    // Sesudah jatahnya habis, klien yang tetap ingin berubah harus MEMBATALKAN
    // — dan pembatalan di jendela ini menerbitkan kredit 30 hari. Yang ditolak
    // di sini adalah perpindahannya, bukan haknya untuk berubah.
    const { tanggal, jam } = jamRelatif(6);
    const id = await buatSesi(tanggal, jam);

    await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-09-25",
      jam_baru: "11:00",
    });
    // Sesi kini bertanggal jauh; digeser kembali ke jendela 2–24 jam supaya
    // percobaan kedua benar-benar diuji pada jenjang yang sama.
    const dekat = jamRelatif(6);
    await admin
      .from("sessions")
      .update({ tanggal: dekat.tanggal, jam_mulai: dekat.jam })
      .eq("id", id);

    const { error } = await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-09-26",
      jam_baru: "11:00",
    });
    expect(error).not.toBeNull();
  });

  it("jenjang 3 (<2 jam): jadwal ulang DITOLAK — itu pemesanan baru", async () => {
    const { tanggal, jam } = jamRelatif(1);
    const id = await buatSesi(tanggal, jam);

    const { error } = await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-09-25",
      jam_baru: "12:00",
    });
    expect(error).not.toBeNull();
  });
});

describe("jadwal ulang tunduk pada pagar yang sama dengan pemesanan", () => {
  it("jam DI LUAR app_settings.jam_layanan DITOLAK", async () => {
    // Pagar ini TIDAK diwarisi: `guard_booking_pembatas` adalah trigger
    // `before insert on booking_requests` dan tidak pernah melihat `sessions`.
    // Ia harus ditegakkan di dalam fungsi ini, membaca kunci `app_settings`
    // yang sama supaya jam buka klinik tidak punya dua sumber.
    const { tanggal, jam } = jamRelatif(48);
    const id = await buatSesi(tanggal, jam);

    const { error } = await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-09-25",
      jam_baru: "03:00",
    });
    expect(error).not.toBeNull();
  });

  it("pagar jam BEKERJA untuk sesi klien, bukan diam karena RLS", async () => {
    // C1-a sudah menemukan jebakannya sekali: `guard_booking_pembatas` bersifat
    // SECURITY INVOKER, sehingga ia membaca `app_settings` sebagai klien,
    // mendapat NOL BARIS karena policy, lalu DIAM alih-alih menolak. Pagar yang
    // membaca pengaturannya dengan hak pemanggil adalah pagar yang mati tanpa
    // suara. Uji ini dijalankan dengan sesi KLIEN sungguhan — dijalankan dengan
    // service role, ia lolos vakum.
    const { tanggal, jam } = jamRelatif(48);
    const id = await buatSesi(tanggal, jam);

    const { error } = await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-09-25",
      jam_baru: "23:00",
    });
    expect(error, "pagar jam DIAM di sesi klien — RLS menelan app_settings").not.toBeNull();
  });

  it("bidan yang sudah terisi pada jam itu DITOLAK", async () => {
    const { tanggal, jam } = jamRelatif(48);
    const id = await buatSesi(tanggal, jam);
    await buatSesi("2027-09-25", "10:00"); // bidan sama, slot terisi

    const { error } = await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-09-25",
      jam_baru: "10:00",
    });
    expect(error).not.toBeNull();
  });

  it("mencatat perpindahannya di jejak: dari mana, ke mana", async () => {
    const { tanggal, jam } = jamRelatif(48);
    const id = await buatSesi(tanggal, jam);
    await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-09-25",
      jam_baru: "13:00",
    });

    const { data: jejak } = await admin
      .from("jejak_jadwal")
      .select("tindakan, dari_tanggal, ke_tanggal, ke_jam")
      .eq("sesi_id", id)
      .single();

    expect(jejak!.tindakan).toBe("jadwal_ulang");
    expect(jejak!.dari_tanggal).toBe(tanggal);
    expect(jejak!.ke_tanggal).toBe("2027-09-25");
    expect(jejak!.ke_jam).toBe("13:00:00");
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `npx vitest run tests/pembatalan-rpc.test.ts`
Expected: FAIL — `Could not find the function public.jadwal_ulang_sesi`

- [ ] **Step 3: Tambahkan fungsinya**

Tambahkan di **akhir** `web/supabase/migrations/20260913102000_rpc_pembatalan.sql`:

```sql
-- ---------------------------------------------------------------------------
-- JADWAL ULANG
-- ---------------------------------------------------------------------------
-- MENGUBAH BARIS YANG SAMA, tidak pernah membuat baris baru (spec C3 P4).
-- Baris baru lahir dengan `jadwal_ulang_terpakai = false`, sehingga jatah
-- "1× per pemesanan" bisa di-reset tanpa batas hanya dengan menjadwal ulang
-- berulang — aturannya jadi bohong tanpa satu pun galat.
--
-- Bidannya DIPERTAHANKAN (spec C3 P8): hubungan klien–bidan sudah terbentuk,
-- dan mengganti orang yang akan masuk ke rumah seseorang bukan akibat wajar
-- dari memindahkan jam.
--
-- PAGARNYA TIDAK DIWARISI. `guard_booking_pembatas` adalah trigger
-- `before insert on booking_requests`; ia tidak pernah melihat `sessions`.
-- Jam layanan dibaca lewat `jam_layanan_terpakai()` — fungsi `security definer`
-- yang sudah ada — supaya jam buka klinik tetap punya SATU sumber. Membacanya
-- langsung dari `app_settings` di sini akan mengulang jebakan C1-a: pembacaan
-- dengan hak pemanggil memulangkan nol baris karena policy, dan pagarnya DIAM
-- alih-alih menolak.
create or replace function public.jadwal_ulang_sesi(
  sesi_id uuid,
  tanggal_baru date,
  jam_baru time
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.sessions%rowtype;
  peran text := public.user_role();
  staf boolean := peran in ('admin', 'owner');
  jenjang smallint;
  pakai_jatah boolean := false;
  daftar_jam text;
begin
  select * into s from public.sessions where id = sesi_id;
  if not found then
    return null;
  end if;

  if not staf and s.client_id <> auth.uid() then
    raise exception 'sesi ini bukan milik Anda' using errcode = '42501';
  end if;

  jenjang := public.jenjang_pembatalan(s.tanggal, s.jam_mulai);

  -- Jenjang 3 tidak mengenal jadwal ulang: poster menyebutnya pemesanan baru.
  if jenjang = 3 then
    raise exception 'kurang dari 2 jam sebelum sesi — jadwal ulang dihitung sebagai pemesanan baru'
      using errcode = '23514';
  end if;

  if jenjang = 2 then
    if s.jadwal_ulang_terpakai then
      raise exception 'jatah jadwal ulang gratis untuk pemesanan ini sudah terpakai'
        using errcode = '23514';
    end if;
    pakai_jatah := true;
  end if;

  -- Jam wajib anggota daftar jam layanan. Dibaca lewat fungsi definer yang
  -- sudah ada; daftar kosong berarti pemesanan memang sedang dimatikan.
  daftar_jam := public.jam_layanan_terpakai();
  if daftar_jam is null
     or to_char(jam_baru, 'HH24:MI') <> all (string_to_array(daftar_jam, ',')) then
    raise exception 'jam % di luar jam layanan klinik', to_char(jam_baru, 'HH24:MI')
      using errcode = '22023';
  end if;

  -- Waktu baru harus di masa depan, dan tidak boleh lebih dekat dari ambang
  -- berangkat: memindahkan sesi ke 30 menit lagi bukan jadwal ulang melainkan
  -- cara memaksa bidan berangkat tanpa pemberitahuan.
  if ((tanggal_baru + jam_baru) at time zone 'Asia/Jakarta') - now() < interval '2 hours' then
    raise exception 'waktu baru terlalu dekat — pilih minimal 2 jam dari sekarang'
      using errcode = '23514';
  end if;

  -- Bidan yang sama tidak bisa berada di dua tempat. Sesi yang sedang dipindah
  -- dikecualikan supaya memindahkannya ke jamnya sendiri tidak menabrak diri
  -- sendiri.
  if exists (
    select 1 from public.sessions x
     where x.partner_id = s.partner_id
       and x.tanggal = tanggal_baru
       and x.jam_mulai = jam_baru
       and x.status = 'terjadwal'
       and x.id <> s.id
  ) then
    raise exception 'bidan sudah punya jadwal pada waktu itu — pilih waktu lain'
      using errcode = '23505';
  end if;

  update public.sessions
     set tanggal = tanggal_baru,
         jam_mulai = jam_baru,
         jadwal_ulang_terpakai = s.jadwal_ulang_terpakai or pakai_jatah
   where id = sesi_id
     and status = 'terjadwal';

  if not found then
    return null;
  end if;

  insert into public.jejak_jadwal (
    sesi_id, tindakan, jenjang, dari_tanggal, dari_jam, ke_tanggal, ke_jam,
    aktor_id, peran_aktor
  ) values (
    s.id, 'jadwal_ulang', jenjang, s.tanggal, s.jam_mulai, tanggal_baru, jam_baru,
    auth.uid(), peran
  );

  return jsonb_build_object('jenjang', jenjang, 'jatah_terpakai', pakai_jatah);
end;
$$;

revoke execute on function public.jadwal_ulang_sesi(uuid, date, time) from public, anon;
grant execute on function public.jadwal_ulang_sesi(uuid, date, time) to authenticated;
```

- [ ] **Step 4: Terapkan & jalankan uji**

Run: `npx supabase migration up --local && npx vitest run tests/pembatalan-rpc.test.ts`
Expected: PASS (19 uji)

> Bila uji "pagar jam BEKERJA untuk sesi klien" gagal karena `23:00` ternyata anggota `jam_layanan` di seed, ganti jamnya menjadi nilai yang benar-benar di luar daftar. Periksa daftarnya dengan:
> `npx supabase db query "select value from app_settings where key = 'jam_layanan'"` — atau lewat `querySql` di uji.

- [ ] **Step 5: Commit**

```bash
git add web/supabase/migrations/20260913102000_rpc_pembatalan.sql web/tests/pembatalan-rpc.test.ts
git commit -m "feat(pembatalan): jadwal_ulang_sesi memindahkan baris yang sama

Baris baru akan me-reset jatah 1x per pemesanan tanpa satu pun galat. Pagar
jamnya TIDAK diwarisi dari guard_booking_pembatas — trigger itu hanya melihat
booking_requests — jadi ditegakkan di dalam fungsi, membaca app_settings lewat
fungsi definer supaya tidak diam karena RLS seperti jebakan C1-a."
```

---

## Task 5: RPC `tukar_hak_sesi()`

**Files:**
- Modify: `web/supabase/migrations/20260913102000_rpc_pembatalan.sql` — tambahkan di akhir.
- Modify: `web/tests/pembatalan-rpc.test.ts` — tambahkan describe di akhir.

**Interfaces:**
- Consumes: `hak_sesi` (Task 2), `jam_layanan_terpakai()` (sudah ada).
- Produces: `public.tukar_hak_sesi(hak_id uuid, tanggal_baru date, jam_baru time, mitra uuid) returns uuid` — id sesi baru, atau `null` bila haknya tidak ada / sudah terpakai. Melempar `23514` bila kedaluwarsa.

- [ ] **Step 1: Tulis uji yang gagal**

Tambahkan di akhir `web/tests/pembatalan-rpc.test.ts`:

```ts
describe("tukar_hak_sesi — hak menjadi sesi baru", () => {
  async function terbitkanHak(kedaluwarsa: string): Promise<string> {
    const { data, error } = await admin
      .from("hak_sesi")
      .insert({ client_id: ANANDA, service_id: SVC, kedaluwarsa })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;
    return data.id;
  }

  it("melahirkan sesi terjadwal yang sudah LUNAS", async () => {
    // Uangnya sudah dibayar untuk sesi yang batal. Sesi penggantinya lahir
    // lunas — tanpa itu klien menerima tagihan kedua untuk sesi yang sudah ia
    // bayar, persis kesalahan yang C2 tutup saat sesi lahir dari konfirmasi.
    const hak = await terbitkanHak("2027-12-31");

    const { data: sesiBaru } = await sesiAdmin.rpc("tukar_hak_sesi", {
      hak_id: hak,
      tanggal_baru: "2027-09-25",
      jam_baru: "14:00",
      mitra: MITRA,
    });

    const { data: s } = await admin
      .from("sessions")
      .select("status, status_bayar, service_id, client_id")
      .eq("id", sesiBaru)
      .single();

    expect(s!.status).toBe("terjadwal");
    expect(s!.status_bayar).toBe("lunas");
    expect(s!.service_id).toBe(SVC);
    expect(s!.client_id).toBe(ANANDA);
  });

  it("hak yang sudah dipakai TIDAK bisa dipakai lagi", async () => {
    const hak = await terbitkanHak("2027-12-31");
    await sesiAdmin.rpc("tukar_hak_sesi", {
      hak_id: hak,
      tanggal_baru: "2027-09-25",
      jam_baru: "15:00",
      mitra: MITRA,
    });

    const { data: kedua, error } = await sesiAdmin.rpc("tukar_hak_sesi", {
      hak_id: hak,
      tanggal_baru: "2027-09-26",
      jam_baru: "15:00",
      mitra: MITRA,
    });
    expect(kedua === null || error !== null).toBe(true);
  });

  it("hak KEDALUWARSA ditolak — dan ditolaknya di basis data", async () => {
    // Pemeriksaannya di sini, bukan di TypeScript: kedaluwarsa yang hanya
    // diperiksa di layar adalah kedaluwarsa yang bisa dilewati satu panggilan
    // RPC.
    const hak = await terbitkanHak("2020-01-01");

    const { error } = await sesiAdmin.rpc("tukar_hak_sesi", {
      hak_id: hak,
      tanggal_baru: "2027-09-25",
      jam_baru: "16:00",
      mitra: MITRA,
    });
    expect(error).not.toBeNull();
  });

  it("klien tidak bisa menukar hak milik orang lain", async () => {
    // Haknya milik RINA; Ananda yang login mencobanya.
    const { data: h, error: eh } = await admin
      .from("hak_sesi")
      .insert({ client_id: RINA, service_id: SVC, kedaluwarsa: "2027-12-31" })
      .select("id")
      .single<{ id: string }>();
    if (eh) throw eh;
    const hak = h.id;

    // 16:00 dan BUKAN 17:00: jam layanan seed hanya
    // 08,09,10,11,13,14,15,16. Memakai jam di luar daftar membuat uji ini
    // hijau karena jamnya tak sah, bukan karena kepemilikannya ditolak — uji
    // yang lolos karena sebab lain tidak menjaga apa pun.
    const { data, error } = await sesiKlien.rpc("tukar_hak_sesi", {
      hak_id: hak,
      tanggal_baru: "2027-09-25",
      jam_baru: "16:00",
      mitra: MITRA,
    });
    expect(data === null || error !== null).toBe(true);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `npx vitest run tests/pembatalan-rpc.test.ts`
Expected: FAIL — `Could not find the function public.tukar_hak_sesi`

- [ ] **Step 3: Tambahkan fungsinya**

Tambahkan di **akhir** `web/supabase/migrations/20260913102000_rpc_pembatalan.sql`:

```sql
-- ---------------------------------------------------------------------------
-- TUKAR HAK MENJADI SESI
-- ---------------------------------------------------------------------------
-- Sesi penggantinya lahir `status_bayar = 'lunas'`, dan itu wajib: uangnya
-- sudah dibayar untuk sesi yang batal. Tanpa ini klien menerima tagihan kedua
-- untuk sesi yang sudah ia bayar — kesalahan yang sama sudah ditutup di C2 saat
-- sesi lahir dari konfirmasi.
--
-- `varian` sengaja TIDAK diminta pemanggil: ia diwarisi dari sesi asal bila
-- ada, karena hak menjanjikan "satu sesi untuk layanan yang sama", dan varian
-- yang berbeda adalah harga yang berbeda.
create or replace function public.tukar_hak_sesi(
  hak_id uuid,
  tanggal_baru date,
  jam_baru time,
  mitra uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  h public.hak_sesi%rowtype;
  peran text := public.user_role();
  staf boolean := peran in ('admin', 'owner');
  varian uuid;
  daftar_jam text;
  sesi_baru uuid;
begin
  select * into h from public.hak_sesi where id = hak_id;
  if not found then
    return null;
  end if;

  if not staf and h.client_id <> auth.uid() then
    raise exception 'hak ini bukan milik Anda' using errcode = '42501';
  end if;

  if h.dipakai_sesi_id is not null then
    return null;
  end if;

  if h.kedaluwarsa < (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'hak ini sudah kedaluwarsa pada %', h.kedaluwarsa
      using errcode = '23514';
  end if;

  daftar_jam := public.jam_layanan_terpakai();
  if daftar_jam is null
     or to_char(jam_baru, 'HH24:MI') <> all (string_to_array(daftar_jam, ',')) then
    raise exception 'jam % di luar jam layanan klinik', to_char(jam_baru, 'HH24:MI')
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.sessions x
     where x.partner_id = mitra
       and x.tanggal = tanggal_baru
       and x.jam_mulai = jam_baru
       and x.status = 'terjadwal'
  ) then
    raise exception 'bidan sudah punya jadwal pada waktu itu — pilih waktu lain'
      using errcode = '23505';
  end if;

  select s.variant_id into varian
    from public.sessions s
   where s.id = h.sesi_asal_id;

  insert into public.sessions (
    client_id, service_id, variant_id, partner_id,
    tanggal, jam_mulai, status, status_bayar
  ) values (
    h.client_id, h.service_id, varian, mitra,
    tanggal_baru, jam_baru, 'terjadwal', 'lunas'
  )
  returning id into sesi_baru;

  -- Indeks unik parsial `hak_sesi_dipakai_sekali` menjamin dua penukaran
  -- serentak tidak bisa melahirkan dua sesi dari satu hak: yang kedua gagal di
  -- indeks, dan seluruh transaksinya ikut batal bersama sesinya.
  update public.hak_sesi set dipakai_sesi_id = sesi_baru where id = hak_id;

  insert into public.jejak_jadwal (
    sesi_id, tindakan, jenjang, ke_tanggal, ke_jam, aktor_id, peran_aktor
  ) values (
    sesi_baru, 'tukar_hak', 2, tanggal_baru, jam_baru, auth.uid(), peran
  );

  return sesi_baru;
end;
$$;

revoke execute on function public.tukar_hak_sesi(uuid, date, time, uuid) from public, anon;
grant execute on function public.tukar_hak_sesi(uuid, date, time, uuid) to authenticated;
```

- [ ] **Step 4: Terapkan & jalankan uji**

Run: `npx supabase migration up --local && npx vitest run tests/pembatalan-rpc.test.ts tests/jejak-yatim.test.ts`
Expected: PASS (23 uji + 3 uji jejak)

- [ ] **Step 5: Commit**

```bash
git add web/supabase/migrations/20260913102000_rpc_pembatalan.sql web/tests/pembatalan-rpc.test.ts
git commit -m "feat(pembatalan): tukar_hak_sesi melahirkan sesi pengganti yang lahir lunas

Uangnya sudah dibayar untuk sesi yang batal; sesi pengganti yang lahir 'belum'
akan menagih klien dua kali. Kedaluwarsa diperiksa di basis data, bukan di
layar yang bisa dilewati satu panggilan RPC."
```

---

## Task 6: Panel admin — jenjang terlihat sebelum tombol ditekan

**Files:**
- Create: `web/src/lib/admin/pembatalan.ts`
- Create: `web/src/app/admin/sesi/aksi-pembatalan.ts`
- Create: `web/src/app/admin/sesi/panel-pembatalan.tsx`
- Modify: `web/src/app/admin/sesi/panel-sesi.tsx`
- Create: `web/tests/admin-panel-pembatalan.test.ts`

**Interfaces:**
- Consumes: `jenjangPembatalan`, `akibatPembatalan`, `LABEL_JENJANG_PEMBATALAN`, `KALIMAT_AKIBAT` (Task 1); RPC `batalkan_sesi`, `jadwal_ulang_sesi` (Task 3 & 4). `BarisSesiDaftar` dari `@/lib/admin/sesi` — sudah ada; bacalah tipenya sebelum menulis, dan pakai medan `tanggal` & `jamMulai` yang sudah ada di sana.
- Produces: `ringkasanPembatalan(tanggal: string, jamMulai: string): { jenjang: 1|2|3; label: string; kalimat: string }`; server action `batalkanSesiAdmin(formData: FormData)` & `jadwalUlangSesiAdmin(formData: FormData)` yang memulangkan `{ ok: true } | { ok: false; pesan: string }`.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/admin-panel-pembatalan.test.ts`:

```ts
/**
 * PANEL PEMBATALAN ADMIN (spec C3 P1, P7).
 *
 * Yang dijaga di sini bukan tampilan melainkan SATU janji: admin melihat
 * jenjang yang sudah dihitung beserta akibatnya SEBELUM menekan, dan tidak
 * pernah mengetik jenjangnya sendiri. Admin yang mengetik jenjang adalah admin
 * yang salah mengetik jenjang.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ringkasanPembatalan } from "@/lib/admin/pembatalan";
import { jamDariDb } from "@/lib/jadwal/jam";

const akar = path.resolve(__dirname, "..");

describe("ringkasan yang dilihat admin", () => {
  it("menyebut jenjang DAN akibatnya dalam kalimat manusia", () => {
    const sekarang = new Date("2027-03-08T02:00:00Z");
    const r = ringkasanPembatalan("2027-03-10", "09:00", sekarang);
    expect(r.jenjang).toBe(1);
    expect(r.kalimat).toContain("dikembalikan penuh");
  });

  it("jendela 2–24 jam menyebut hak, bukan uang", () => {
    const sekarang = new Date("2027-03-10T00:00:00Z"); // 07:00 WIB
    const r = ringkasanPembatalan("2027-03-10", "09:00", sekarang);
    expect(r.jenjang).toBe(2);
    expect(r.kalimat).toContain("hak satu sesi");
    expect(r.kalimat).not.toMatch(/Rp/);
  });
});

describe("panel tidak pernah meminta admin mengetik jenjang", () => {
  const sumber = readFileSync(
    path.join(akar, "src/app/admin/sesi/panel-pembatalan.tsx"),
    "utf8",
  );

  it("tidak ada medan masukan jenjang", () => {
    expect(sumber).not.toMatch(/name="jenjang"/);
  });

  it("jam dari basis data dilewatkan `jamDariDb`, bukan dioper apa adanya", () => {
    // `jamMulai` bernilai 'HH:MM:SS'; `instanSesi` hanya menerima 'HH:MM' dan
    // MELEMPAR untuk selainnya. Mengopernya apa adanya mematikan panel untuk
    // setiap sesi terjadwal — dan itu tidak akan terlihat di uji mana pun yang
    // hanya memanggil `ringkasanPembatalan` dengan literal 'HH:MM'.
    expect(sumber).toContain("jamDariDb(jamMulai)");
  });

  it("alasan darurat WAJIB terisi di markup, bukan hanya di basis data", () => {
    // Basis data memang menolaknya, tapi pagar yang hanya di basis data
    // memberi admin galat sesudah menekan alih-alih sebelum.
    expect(sumber).toMatch(/required/);
  });
});

describe("aksi pembatalan tidak memakai service role", () => {
  it("berkas aksinya tidak menyentuh service role", () => {
    // `src/app/admin/**` tidak boleh memuat service role
    // (`tests/admin-shell.test.ts`): jejak audit harus menyebut aktor yang
    // NYATA, dan service role tidak punya `auth.uid()`.
    const sumber = readFileSync(
      path.join(akar, "src/app/admin/sesi/aksi-pembatalan.ts"),
      "utf8",
    );
    expect(sumber).not.toContain("createAdminSupabase");
    expect(sumber).not.toContain("SERVICE_ROLE");
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `npx vitest run tests/admin-panel-pembatalan.test.ts`
Expected: FAIL — `Cannot find module '@/lib/admin/pembatalan'`

- [ ] **Step 3: Tulis ketiga berkasnya**

Buat `web/src/lib/admin/pembatalan.ts`:

```ts
import {
  jenjangPembatalan,
  akibatPembatalan,
  LABEL_JENJANG_PEMBATALAN,
  KALIMAT_AKIBAT,
} from "@/lib/pembatalan/jenjang";

/**
 * Apa yang admin lihat SEBELUM menekan (spec C3 P1).
 *
 * Murni, dan itu disengaja: ia dipanggil saat render di server maupun di
 * komponen klien, dan tidak boleh menyentuh basis data di kedua tempat. Yang
 * MEMUTUSKAN tetap fungsi Postgres — ini hanya menerangkan.
 */
export function ringkasanPembatalan(
  tanggal: string,
  jamMulai: string,
  sekarang: Date = new Date(),
): { jenjang: 1 | 2 | 3; label: string; kalimat: string } {
  const jenjang = jenjangPembatalan(tanggal, jamMulai, sekarang);
  return {
    jenjang,
    label: LABEL_JENJANG_PEMBATALAN[jenjang],
    kalimat: KALIMAT_AKIBAT[akibatPembatalan(jenjang)],
  };
}
```

Buat `web/src/app/admin/sesi/aksi-pembatalan.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";

type Berhasil = { ok: true };
type Gagal = { ok: false; pesan: string };

/**
 * Pembungkus RPC pembatalan (spec C3 P5).
 *
 * Ditulis dengan SESI ADMIN sungguhan, bukan service role: jejak audit harus
 * menyebut aktor yang nyata, dan service role tidak punya `auth.uid()` sama
 * sekali. `src/app/admin/**` juga memang dilarang memuat service role
 * (`tests/admin-shell.test.ts`).
 */
export async function batalkanSesiAdmin(formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { error } = await supabase.rpc("batalkan_sesi", {
    sesi_id: String(formData.get("sesi") ?? ""),
    alasan: String(formData.get("alasan") ?? ""),
    darurat: formData.get("darurat") === "on",
  });

  if (error) return { ok: false, pesan: error.message };

  revalidatePath("/admin/sesi");
  revalidatePath("/passport");
  return { ok: true };
}

export async function jadwalUlangSesiAdmin(formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { error } = await supabase.rpc("jadwal_ulang_sesi", {
    sesi_id: String(formData.get("sesi") ?? ""),
    tanggal_baru: String(formData.get("tanggal") ?? ""),
    jam_baru: String(formData.get("jam") ?? ""),
  });

  if (error) return { ok: false, pesan: error.message };

  revalidatePath("/admin/sesi");
  revalidatePath("/passport");
  return { ok: true };
}
```

Buat `web/src/app/admin/sesi/panel-pembatalan.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { batalkanSesiAdmin, jadwalUlangSesiAdmin } from "./aksi-pembatalan";
import { ringkasanPembatalan } from "@/lib/admin/pembatalan";

const KELAS_LABEL = "block text-[12.5px] font-bold text-panel-muted";
const KELAS_MEDAN =
  "mt-1 w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13px] text-panel-ink";

/**
 * PEMBATALAN & JADWAL ULANG di panel sesi (spec C3 P1, P7).
 *
 * Jenjangnya DITAMPILKAN, tidak diketik. Admin yang mengetik jenjang adalah
 * admin yang salah mengetik jenjang — dan yang salah bukan angkanya melainkan
 * uang klien.
 *
 * Hitungan di sini hanya MENERANGKAN; yang MEMUTUSKAN adalah fungsi Postgres.
 * Keduanya memakai ambang yang sama, dan bila keduanya berselisih, yang
 * berlaku adalah basis data — layar ini hanya akan terlihat salah, tidak bisa
 * membuat keputusan yang salah.
 */
export function PanelPembatalan({
  sesiId,
  tanggal,
  jamMulai,
  jadwalUlangTerpakai,
}: {
  sesiId: string;
  tanggal: string;
  jamMulai: string;
  jadwalUlangTerpakai: boolean;
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [darurat, setDarurat] = useState(false);

  // `jamDariDb` WAJIB di sini. `BarisSesiDaftar.jamMulai` bernilai 'HH:MM:SS'
  // apa adanya dari Postgres, sedangkan `instanSesi` di balik
  // `ringkasanPembatalan` hanya menerima 'HH:MM' dan MELEMPAR untuk selainnya —
  // sengaja, supaya tanggal yang diam-diam menjadi NaN tidak merambat menjadi
  // pagar waktu yang terbuka tanpa galat. Mengopernya apa adanya membuat panel
  // ini mati saat dirender untuk SETIAP sesi terjadwal.
  const r = ringkasanPembatalan(tanggal, jamDariDb(jamMulai));

  return (
    <section className="grid gap-3 rounded-lg border border-panel-border p-3.5">
      <div>
        <p className="text-[13px] font-bold text-panel-ink">
          Jenjang {r.jenjang} — {r.label}
        </p>
        <p className="text-[12.5px] text-panel-muted">{r.kalimat}</p>
        {jadwalUlangTerpakai && (
          <p className="mt-1 text-[12px] font-semibold text-clay">
            Jatah jadwal ulang gratis untuk pemesanan ini sudah terpakai.
          </p>
        )}
      </div>

      <form
        action={(fd) =>
          mulai(async () => {
            fd.set("sesi", sesiId);
            const hasil = await batalkanSesiAdmin(fd);
            setPesan(hasil.ok ? null : hasil.pesan);
          })
        }
        className="grid gap-2"
      >
        <label className={KELAS_LABEL}>
          Alasan
          {/* WAJIB saat darurat dicentang — pengecualian tanpa catatan tidak
              bisa ditinjau siapa pun setelahnya. Basis data menolaknya juga,
              tapi pagar yang hanya di basis data memberi galat SESUDAH admin
              menekan. */}
          <input name="alasan" required={darurat} className={KELAS_MEDAN} />
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-panel-ink">
          <input
            type="checkbox"
            name="darurat"
            checked={darurat}
            onChange={(e) => setDarurat(e.target.checked)}
          />
          Darurat medis — perlakukan sebagai jenjang 1
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-clay/40 px-3 py-1.5 text-[12.5px] font-bold text-clay disabled:opacity-60"
        >
          {pending ? "Memproses…" : "Batalkan sesi"}
        </button>
      </form>

      <form
        action={(fd) =>
          mulai(async () => {
            fd.set("sesi", sesiId);
            const hasil = await jadwalUlangSesiAdmin(fd);
            setPesan(hasil.ok ? null : hasil.pesan);
          })
        }
        className="grid gap-2 border-t border-panel-border pt-3"
      >
        <label className={KELAS_LABEL}>
          Tanggal baru
          <input type="date" name="tanggal" required className={KELAS_MEDAN} />
        </label>
        <label className={KELAS_LABEL}>
          Jam baru
          <input type="time" name="jam" required step={900} className={KELAS_MEDAN} />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-panel-ink px-3.5 py-2 text-[12.5px] font-bold text-panel-surface disabled:opacity-60"
        >
          {pending ? "Memproses…" : "Jadwal ulang"}
        </button>
      </form>

      {pesan && <p className="text-[12px] font-semibold text-clay">{pesan}</p>}
    </section>
  );
}
```

- [ ] **Step 4: Sisipkan ke panel sesi**

Di `web/src/app/admin/sesi/panel-sesi.tsx`: tambahkan impor
`import { PanelPembatalan } from "./panel-pembatalan";` di antara impor yang sudah ada, lalu render komponennya **hanya untuk sesi yang masih terjadwal**, tepat sebelum `</div>` penutup terluar:

```tsx
      {sesi.status === "terjadwal" && (
        <PanelPembatalan
          sesiId={sesi.id}
          tanggal={sesi.tanggal}
          jamMulai={sesi.jamMulai}
          jadwalUlangTerpakai={sesi.jadwalUlangTerpakai}
        />
      )}
```

Bila `BarisSesiDaftar` di `web/src/lib/admin/sesi.ts` belum memuat `jadwalUlangTerpakai`, tambahkan medannya di tipe itu dan isi dari kolom `jadwal_ulang_terpakai` pada query yang sudah ada di berkas yang sama. Jangan mengubah medan lain.

- [ ] **Step 5: Jalankan uji & pemeriksaan penuh**

Run: `npx vitest run tests/admin-panel-pembatalan.test.ts tests/admin-shell.test.ts tests/pagar-batas-server-klien.test.ts`
Expected: PASS semua.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/admin/pembatalan.ts web/src/app/admin/sesi/aksi-pembatalan.ts \
        web/src/app/admin/sesi/panel-pembatalan.tsx web/src/app/admin/sesi/panel-sesi.tsx \
        web/src/lib/admin/sesi.ts web/tests/admin-panel-pembatalan.test.ts
git commit -m "feat(admin): panel pembatalan menampilkan jenjang, tidak memintanya

Admin yang mengetik jenjang adalah admin yang salah mengetik jenjang, dan yang
salah bukan angkanya melainkan uang klien. Hitungan di layar hanya menerangkan;
yang memutuskan tetap fungsi Postgres."
```

---

## Task 7: Suite penuh, lint, build, catatan tindak lanjut

**Files:**
- Create: `docs/superpowers/2026-09-09-c3a-tindak-lanjut.md`

- [ ] **Step 1: Jalankan seluruh suite**

Run: `npm test`
Expected: seluruh berkas hijau. **Koordinasikan lebih dulu** — basis data lokal dipakai bersama sesi lain, dan dua jalannya vitest serentak saling memerahkan.

Bila `tests/jejak-yatim.test.ts` merah, penyebabnya hampir pasti berkas uji baru yang menghapus sesi tanpa menyapu `jejak_jadwal`-nya. Perbaiki di `bersihkan()` berkas itu, bukan dengan melonggarkan pagarnya.

Bila `tests/money-firewall-struktural.test.ts` merah, ada kolom nominal yang masuk ke `hak_sesi`. Buang kolomnya; jangan menambahkan pengecualian ke daftar firewall.

- [ ] **Step 2: Lint & build**

Run: `npm run lint && npm run build`
Expected: 0 error. `npm run build` menjalankan `tsc` atas SELURUH repo termasuk `tests/` — galat tipe di berkas uji menggagalkan build walau `npx tsc --noEmit` yang disaring ke `src/` terlihat bersih.

- [ ] **Step 3: Tulis catatan tindak lanjut**

Buat `docs/superpowers/2026-09-09-c3a-tindak-lanjut.md` yang memuat, masing-masing dengan alasannya:

1. Rantai status sesi sesudah C3-a, dan pembedaan `dibatalkan_klien` vs `dibatalkan_padma` (siapa, bukan kapan).
2. Kembaran rumus jenjang di SQL dan TypeScript — mengapa disengaja, dan apa yang berlaku bila keduanya berselisih (basis data).
3. Bahwa pagar jam **tidak** diwarisi dari `guard_booking_pembatas`, dan mengapa fungsi barunya harus `security definer`.
4. Kewajiban menyapu `jejak_jadwal` di setiap uji yang menghapus sesi.
5. Yang belum dikerjakan dan menunggu C3-b/C3-c: klien belum bisa menekan apa pun sendiri, dan akibat `refund` baru dicatat sebagai jejak — belum ada permintaan refund maupun rekening tujuan.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/2026-09-09-c3a-tindak-lanjut.md
git commit -m "docs(c3a): catatan tindak lanjut fondasi pembatalan"
```

---

## Self-Review

**Cakupan spec:** P1 → Task 1 & 3 (`jenjang_pembatalan`). P2 → Task 1 (ambang `< 2 jam`, tanpa penanda berangkat). P3 → Task 2 & 3 (`hak_sesi`, kedaluwarsa dari tanggal sesi). P4 → Task 2 & 4 (jatah, baris yang sama berpindah). P5 → Task 3, 4, 5 (RPC definer; tidak ada policy UPDATE baru). P6 → Task 2 (`jejak_jadwal` tanpa FK) & Task 2 Step 4 (pagar yatim). P7 → Task 3 & 6 (darurat, alasan wajib, hanya staf). P8 → Task 4 (bidan dipertahankan, pagar ditegakkan di fungsi). P9 → **sengaja di luar C3-a**, dicatat di Task 7 Step 3 poin 5 sebagai seam menuju C3-c.

**Yang TIDAK dicakup rencana ini, sesuai pemecahan spec:** klien menekan sendiri (C3-b), permintaan refund & rekening tujuan (C3-c).
