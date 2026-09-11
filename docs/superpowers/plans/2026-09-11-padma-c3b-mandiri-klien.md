# PADMA C3-b — Klien Membatalkan & Menjadwal Ulang Sendiri: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memberi klien tombolnya sendiri di Passport — membatalkan sesi, menggeser jadwal, dan membelanjakan kredit — dengan akibat uangnya tertulis di layar sebelum ia menekan.

**Architecture:** Tidak ada policy tulis baru untuk klien. Ketiga tindakan memakai RPC *security definer* yang sudah lahir di C3-a dan sejak awal memeriksa kepemilikan lewat `clients.user_id` — yang C3-b tambahkan hanyalah pemanggil, layar, dan dua aturan yang belum ada di fungsi itu (rantai kredit berhenti setelah satu putaran; darurat berlaku untuk jadwal ulang).

**Tech Stack:** Next.js 16.3.3 (App Router, server actions), Supabase Postgres + RLS, TypeScript, Vitest, Playwright-via-tsx.

**Spec:** `docs/superpowers/specs/2026-09-09-padma-c3-pembatalan-design.md`
**Kebijakan sumber:** `docs/superpowers/2026-09-08-kebijakan-pembatalan-klien.md` — salinan utuh poster klien. **Jangan meringkasnya dari ingatan.**
**Pendahulu:** C3-a ter-merge (`94d761d`). Catatan tindak lanjutnya `docs/superpowers/2026-09-09-c3a-tindak-lanjut.md` memuat empat keputusan yang sengaja ditunda ke rencana ini — tiga di antaranya sudah dijawab pemilik dan masuk spec (`cfe9cab`).

## Global Constraints

- **Klien TIDAK boleh diberi policy UPDATE atas `sessions` maupun `hak_sesi`.** Semua lewat RPC *security definer*. Ini pagar yang sengaja ditutup sejak migrasi `20260829180000` dan tidak dibuka demi kenyamanan.
- **Klien tidak pernah bisa menyatakan dirinya darurat, dan tidak pernah bisa mengaku PADMA.** Server action klien mengunci `oleh: "klien"` dan `darurat: false` sebagai literal — tidak pernah dari `FormData`.
- **Jenjang diturunkan saat dibaca, tidak pernah disimpan.** Ambang `>= 24 jam` → 1, `>= 2 jam` → 2, selain itu 3, seluruhnya WIB (`+07:00` tetap, lewat `@/lib/jadwal/jam`). Yang MEMUTUSKAN tetap Postgres; layar hanya menerangkan.
- **Kredit berlaku 30 hari sejak TANGGAL SESI yang batal**, dan **rantainya berhenti setelah satu putaran**: sesi yang lahir dari penukaran kredit, bila dibatalkan lagi, TIDAK menerbitkan kredit kedua.
- **Jatah jadwal ulang 1× per pemesanan**, hanya termakan di jenjang 2. Jatah habis → layar MENAWARKAN batal-jadi-kredit dalam satu langkah, dengan akibatnya tertulis; tidak pernah membatalkan otomatis.
- **Tidak boleh ada satu pun kolom nominal uang** di tabel atau tipe baru. `tests/money-firewall-struktural.test.ts` memindai seluruh skema.
- **`src/app/admin/**` tidak boleh memuat service role** (`tests/admin-shell.test.ts`). **`src/app/passport/**` tidak boleh mengekspor `revalidate` atau memakai `unstable_cache`** (`tests/passport-shell.test.ts`) — pengaturan itu menghapus `private` dari `Cache-Control` sehingga data satu klien boleh disimpan CDN dan disajikan ke klien lain.
- **`create or replace function` mengganti SELURUH badan.** Salin badan lamanya apa adanya termasuk komentarnya, lalu ubah bagian yang memang berubah. Pelajaran ini dibayar mahal di C1-a.
- **Seluruh nama berkas, tabel, kolom, fungsi, dan teks UI dalam bahasa Indonesia.**
- Perintah dijalankan dari `web/`. Uji: `npx vitest run <berkas>`. Migrasi: `npx supabase migration up --local` — dan bila berkasnya sudah tercatat applied, terapkan isinya langsung lewat psql sehingga berkas & basis data selaras. **Jangan `supabase db push`.**
- **Basis data lokal dipakai bersama sesi lain.** Jangan menjalankan suite penuh tanpa koordinasi. Bila migrasi cabang ini hilang karena sesi lain menjalankan `db reset`, pulihkan dengan `npx supabase migration up --include-all` (WAJIB `--include-all`).
- **Setiap berkas uji yang membuat sesi WAJIB menyapu `jejak_jadwal` dan `hak_sesi` miliknya** — kedua tabel jejak sengaja tanpa foreign key, dan sisa baris memerahkan `tests/jejak-yatim.test.ts` di berkas yang sama sekali lain. Sapu berdasarkan **id yang dicatat**, bukan daftar tanggal tetap: helper yang memakai tanggal relatif pernah membocorkan 148 baris sekaligus (lihat catatan C3-a §Debris).

---

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `web/supabase/migrations/20260915100000_c3b_rantai_kredit_darurat.sql` (baru) | Dua aturan yang belum ada: rantai kredit berhenti setelah satu putaran (`batalkan_sesi`), dan `darurat` pada `jadwal_ulang_sesi`. |
| `web/src/lib/pembatalan/hak.ts` (dipindah dari `web/src/lib/admin/hak.ts`) | Membaca hak yang masih berlaku milik satu klien. Dipakai panel admin DAN Passport — satu pembaca, bukan dua yang harus sepakat selamanya. |
| `web/src/lib/passport/pembatalan.ts` (baru) | Merakit apa yang dibutuhkan layar klien untuk satu sesi: jenjang terhitung, kalimat akibatnya, jatah, dan daftar jam layanan. |
| `web/src/app/passport/sesi/[id]/aksi.ts` (baru) | Server action klien: batalkan & jadwal ulang. Mengunci `oleh`/`darurat` sebagai literal. |
| `web/src/app/passport/sesi/[id]/kartu-pembatalan.tsx` (baru) | Komponen klien: penjelasan jenjang, batal dua-ketukan, formulir jadwal ulang, tawaran saat jatah habis. |
| `web/src/app/passport/sesi/[id]/page.tsx` (ubah) | Menyisipkan kartu itu untuk sesi `terjadwal`. |
| `web/src/app/passport/kredit/page.tsx` (baru) | Daftar kredit klien beserta tanggal kedaluwarsanya. |
| `web/src/app/passport/kredit/kartu-kredit.tsx` (baru) | Komponen klien: satu kredit + formulir penukarannya. |
| `web/src/app/passport/kredit/aksi.ts` (baru) | Server action penukaran; bidan DIWARISI dari sesi asal, tidak dipilih klien. |
| `web/src/app/passport/nav.tsx` (ubah) | Satu entri menuju `/passport/kredit`. |
| `web/src/lib/passport/data.ts` (ubah) | `KOLOM_SESI` + `petakanSesi` membawa `jadwal_ulang_terpakai`. |
| `web/src/lib/passport/turunan.ts` (ubah) | `SesiRingkas.jadwalUlangTerpakai: boolean`. |
| `web/src/lib/admin/hak.ts` (dihapus) | Isinya pindah; pemanggil admin diarahkan ke lokasi baru. |
| `web/tests/c3b-rantai-darurat.test.ts` (baru) | Kedua aturan baru di basis data. |
| `web/tests/passport-pembatalan-klien.test.ts` (baru) | Hak & pagar jalur klien. |
| `web/tests/passport-kredit.test.ts` (baru) | Penukaran kredit oleh klien. |
| `web/tests/e2e/pembatalan-klien.e2e.ts` (baru) | Jalur penuh lewat peramban. |
| `web/tests/inventaris-rute.test.ts` (ubah) | Rute `/passport/kredit` masuk tabel README. |

---

## Task 1: Dua aturan yang belum ada di basis data

**Files:**
- Create: `web/supabase/migrations/20260915100000_c3b_rantai_kredit_darurat.sql`
- Test: `web/tests/c3b-rantai-darurat.test.ts`

**Interfaces:**
- Consumes: `public.batalkan_sesi(sesi_id uuid, alasan text, darurat boolean, oleh text) returns jsonb`, `public.jadwal_ulang_sesi(sesi_id uuid, tanggal_baru date, jam_baru time) returns jsonb`, `public.tukar_hak_sesi(hak_id uuid, tanggal_baru date, jam_baru time, mitra uuid) returns uuid`, `public.jenjang_pembatalan(date, time) returns smallint`, `public.user_role() returns text` — semuanya sudah ada dari C3-a.
- Produces: `jadwal_ulang_sesi` bertanda tangan BARU `(sesi_id uuid, tanggal_baru date, jam_baru time, darurat boolean, alasan text)`; `batalkan_sesi` tanda tangannya TETAP.

> **Baca dulu `web/supabase/migrations/20260913102000_rpc_pembatalan.sql` seluruhnya.** Kedua fungsi yang kamu sentuh hidup di sana, dan `create or replace` mengganti seluruh badannya — apa yang tidak kamu salin, hilang.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/c3b-rantai-darurat.test.ts`:

```ts
/**
 * DUA ATURAN YANG LAHIR DI C3-b (spec P4, P7).
 *
 *  1. Rantai kredit BERHENTI setelah satu putaran. Tanpa ini, masa berlaku
 *     30 hari berhenti benar: tiap putaran menerbitkan kredit baru yang
 *     kedaluwarsanya dihitung dari tanggal sesi yang BARU, sehingga kredit
 *     memperbarui dirinya sendiri tanpa batas dan slot bidan tersandera
 *     selamanya oleh satu pembayaran.
 *
 *  2. Darurat medis berlaku untuk JADWAL ULANG, bukan hanya pembatalan.
 *     Poster memang menyebut "reschedule", dan tanpa jalur ini satu-satunya
 *     yang tersedia bagi klien yang masuk rumah sakit satu jam sebelum sesinya
 *     adalah batal-darurat lalu memesan ulang dari nol — bukan hal yang sama.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { querySql } from "./helpers/db";

const admin = createAdminSupabase();

const ANANDA = "44444444-4444-4444-4444-444444444401";
const SVC = "11111111-1111-1111-1111-111111111101";
const MITRA = "33333333-3333-3333-3333-333333333301";

let VARIAN: string;
let sesiKlien: SupabaseClient;
let sesiAdmin: SupabaseClient;

/**
 * Id setiap sesi yang dibuat berkas ini — termasuk yang LAHIR DARI RPC.
 * Menyapu berdasarkan daftar tanggal tetap pernah membocorkan 148 baris
 * sekaligus, karena helper waktunya memakai tanggal relatif yang bergerak.
 */
const SESI_MILIK_UJI = new Set<string>();

function catatSesi(id: unknown) {
  if (typeof id === "string" && id.length > 0) SESI_MILIK_UJI.add(id);
}

async function bersihkan() {
  const ids = [...SESI_MILIK_UJI];
  if (ids.length > 0) {
    // Jejak DULU: kedua tabel jejak sengaja tanpa foreign key, jadi tidak ada
    // cascade yang menyapunya.
    await admin.from("jejak_jadwal").delete().in("sesi_id", ids);
    await admin.from("jejak_status_bayar").delete().in("sesi_id", ids);
  }
  await admin.from("hak_sesi").delete().eq("client_id", ANANDA);
  if (ids.length > 0) await admin.from("sessions").delete().in("id", ids);
  SESI_MILIK_UJI.clear();
}

/** Sesi terjadwal & lunas milik Ananda, `jamDariSekarang` jam dari sekarang. */
async function buatSesi(jamDariSekarang: number): Promise<string> {
  const t = new Date(Date.now() + jamDariSekarang * 3_600_000);
  const wib = new Date(t.getTime() + 7 * 3_600_000);
  const tanggal = wib.toISOString().slice(0, 10);
  // Dibulatkan ke kelipatan 30 menit: constraint `sessions_jam_bulat`
  // menolak selainnya. Pembulatan memundurkan jam sesi, jadi ia mendekatkan
  // sesi ke sekarang — aman selama offset yang dipakai jauh dari ambang.
  const menit = wib.getUTCMinutes() < 30 ? "00" : "30";
  const jam = `${wib.toISOString().slice(11, 13)}:${menit}`;

  const { data, error } = await admin
    .from("sessions")
    .insert({
      client_id: ANANDA,
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
  catatSesi(data.id);
  return data.id;
}

beforeAll(async () => {
  VARIAN = await varianBaku(admin, SVC);
  sesiKlien = await signInAs("ananda@padma.test");
  sesiAdmin = await signInAs("admin@padma.test");
  await bersihkan();
});

beforeEach(bersihkan);
afterAll(bersihkan);

describe("rantai kredit berhenti setelah satu putaran", () => {
  it("sesi ASLI yang batal di jendela 2–24 jam menerbitkan kredit", async () => {
    const id = await buatSesi(6);
    const { data } = await sesiKlien.rpc("batalkan_sesi", {
      sesi_id: id,
      alasan: "",
      darurat: false,
      oleh: "klien",
    });
    expect(data.jenjang).toBe(2);
    expect(data.akibat).toBe("hak");
    expect(data.hak_id).not.toBeNull();
  });

  it("sesi yang LAHIR DARI KREDIT dan dibatalkan lagi TIDAK menerbitkan kredit kedua", async () => {
    // Inilah aturannya. Tanpa ini kreditnya memperbarui dirinya sendiri
    // selamanya: kedaluwarsa kredit baru dihitung dari tanggal sesi yang baru.
    const asli = await buatSesi(6);
    const { data: batal1 } = await sesiKlien.rpc("batalkan_sesi", {
      sesi_id: asli,
      alasan: "",
      darurat: false,
      oleh: "klien",
    });

    // Tukar kreditnya jadi sesi baru, lalu geser sesi itu ke jendela 2–24 jam.
    const { data: sesiBaru } = await sesiAdmin.rpc("tukar_hak_sesi", {
      hak_id: batal1.hak_id,
      tanggal_baru: "2027-10-20",
      jam_baru: "10:00",
      mitra: MITRA,
    });
    catatSesi(sesiBaru);

    const dekat = new Date(Date.now() + 6 * 3_600_000);
    const wib = new Date(dekat.getTime() + 7 * 3_600_000);
    await admin
      .from("sessions")
      .update({
        tanggal: wib.toISOString().slice(0, 10),
        jam_mulai: `${wib.toISOString().slice(11, 13)}:${wib.getUTCMinutes() < 30 ? "00" : "30"}`,
      })
      .eq("id", sesiBaru);

    const { data: batal2 } = await sesiKlien.rpc("batalkan_sesi", {
      sesi_id: sesiBaru,
      alasan: "",
      darurat: false,
      oleh: "klien",
    });

    expect(batal2.jenjang, "jenjangnya tetap dihitung dari waktu").toBe(2);
    expect(batal2.hak_id, "kredit kedua TERBIT — rantainya tidak berhenti").toBeNull();

    const { count } = await admin
      .from("hak_sesi")
      .select("id", { count: "exact", head: true })
      .eq("client_id", ANANDA);
    expect(count, "hanya kredit pertama yang boleh ada").toBe(1);
  });

  it("akibatnya tetap dikabarkan JUJUR — bukan diam-diam disebut `hangus`", async () => {
    // Klien tidak menerima kredit, tetapi sebabnya BUKAN karena ia terlambat.
    // Menyebutnya `hangus` akan membuat layar mengatakan hal yang salah tentang
    // mengapa. Akibatnya punya namanya sendiri.
    const asli = await buatSesi(6);
    const { data: b1 } = await sesiKlien.rpc("batalkan_sesi", {
      sesi_id: asli, alasan: "", darurat: false, oleh: "klien",
    });
    const { data: sesiBaru } = await sesiAdmin.rpc("tukar_hak_sesi", {
      hak_id: b1.hak_id, tanggal_baru: "2027-10-21", jam_baru: "10:00", mitra: MITRA,
    });
    catatSesi(sesiBaru);
    const dekat = new Date(Date.now() + 6 * 3_600_000);
    const wib = new Date(dekat.getTime() + 7 * 3_600_000);
    await admin.from("sessions").update({
      tanggal: wib.toISOString().slice(0, 10),
      jam_mulai: `${wib.toISOString().slice(11, 13)}:${wib.getUTCMinutes() < 30 ? "00" : "30"}`,
    }).eq("id", sesiBaru);

    const { data: b2 } = await sesiKlien.rpc("batalkan_sesi", {
      sesi_id: sesiBaru, alasan: "", darurat: false, oleh: "klien",
    });
    expect(b2.akibat).toBe("kredit_habis");
  });
});

describe("darurat berlaku untuk jadwal ulang", () => {
  it("staf memindahkan sesi di BAWAH 2 jam dengan alasan tertulis", async () => {
    const id = await buatSesi(1); // jenjang 3 — normalnya jadwal ulang ditolak
    const { data, error } = await sesiAdmin.rpc("jadwal_ulang_sesi", {
      sesi_id: id,
      tanggal_baru: "2027-10-22",
      jam_baru: "10:00",
      darurat: true,
      alasan: "Klien masuk rumah sakit, konfirmasi via WA 09.15",
    });
    expect(error).toBeNull();
    expect(data.jenjang).toBe(1);

    const { data: s } = await admin
      .from("sessions")
      .select("tanggal, status, jadwal_ulang_terpakai")
      .eq("id", id)
      .single();
    expect(s!.tanggal).toBe("2027-10-22");
    expect(s!.status).toBe("terjadwal");
    expect(s!.jadwal_ulang_terpakai, "darurat TIDAK memakan jatah klien").toBe(false);
  });

  it("darurat TANPA alasan DITOLAK", async () => {
    const id = await buatSesi(1);
    const { error } = await sesiAdmin.rpc("jadwal_ulang_sesi", {
      sesi_id: id, tanggal_baru: "2027-10-22", jam_baru: "10:00",
      darurat: true, alasan: "   ",
    });
    expect(error?.code).toBe("23514");
  });

  it("KLIEN tidak bisa menyatakan dirinya darurat", async () => {
    const id = await buatSesi(1);
    const { error } = await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id, tanggal_baru: "2027-10-22", jam_baru: "10:00",
      darurat: true, alasan: "saya darurat",
    });
    expect(error?.code).toBe("42501");
  });

  it("tanpa darurat, jenjang 3 tetap DITOLAK seperti sebelumnya", async () => {
    const id = await buatSesi(1);
    const { error } = await sesiKlien.rpc("jadwal_ulang_sesi", {
      sesi_id: id, tanggal_baru: "2027-10-22", jam_baru: "10:00",
      darurat: false, alasan: "",
    });
    expect(error?.code).toBe("23514");
  });

  it("darurat mencatat alasannya di jejak", async () => {
    const id = await buatSesi(1);
    await sesiAdmin.rpc("jadwal_ulang_sesi", {
      sesi_id: id, tanggal_baru: "2027-10-23", jam_baru: "10:00",
      darurat: true, alasan: "Rawat inap",
    });
    const { data: jejak } = await admin
      .from("jejak_jadwal")
      .select("tindakan, darurat, alasan, peran_aktor")
      .eq("sesi_id", id)
      .single();
    expect(jejak!.tindakan).toBe("jadwal_ulang");
    expect(jejak!.darurat).toBe(true);
    expect(jejak!.alasan).toBe("Rawat inap");
    expect(jejak!.peran_aktor).toBe("admin");
  });

  it("tanda tangan LAMA sudah tidak ada — pemanggil lama gagal keras, bukan salah diam-diam", async () => {
    const baris = await querySql<{ ada: boolean }>(
      `select exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'jadwal_ulang_sesi'
            and pg_get_function_identity_arguments(p.oid) = 'sesi_id uuid, tanggal_baru date, jam_baru time without time zone'
       ) as ada`,
    );
    expect(baris[0].ada).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `npx vitest run tests/c3b-rantai-darurat.test.ts`
Expected: FAIL — `jadwal_ulang_sesi` belum menerima `darurat`, dan `akibat` belum mengenal `kredit_habis`.

- [ ] **Step 3: Tulis migrasinya**

Buat `web/supabase/migrations/20260915100000_c3b_rantai_kredit_darurat.sql`. **Salin badan kedua fungsi dari `20260913102000_rpc_pembatalan.sql` apa adanya**, lalu terapkan HANYA perubahan berikut.

Pada `batalkan_sesi` — sisipkan tepat sebelum `akibat := case jenjang ...`:

```sql
  -- RANTAI KREDIT BERHENTI SETELAH SATU PUTARAN (spec C3 P4, keputusan pemilik
  -- 9 Sep 2026).
  --
  -- "Sesi ini lahir dari kredit" tidak menuntut kolom baru: `tukar_hak_sesi`
  -- sudah menuliskan `hak_sesi.dipakai_sesi_id = <sesi baru>`, jadi
  -- pertanyaannya dijawab dengan mencari balik. Menambahkan kolom kedua yang
  -- menyatakan hal yang sama akan melahirkan dua sumber yang suatu hari
  -- berselisih.
  --
  -- Tanpa aturan ini masa berlaku 30 hari berhenti benar: tiap putaran
  -- menerbitkan kredit baru yang kedaluwarsanya dihitung dari tanggal sesi
  -- yang BARU, sehingga kredit memperbarui dirinya sendiri tanpa batas dan
  -- slot bidan tersandera selamanya oleh satu pembayaran.
  lahir_dari_kredit := exists (
    select 1 from public.hak_sesi h where h.dipakai_sesi_id = s.id
  );
```

dan ganti baris `akibat := ...` menjadi:

```sql
  akibat := case
    -- `kredit_habis` PUNYA NAMANYA SENDIRI, tidak dilebur ke `hangus`.
    -- Keduanya berarti "klien tidak menerima apa pun", tetapi SEBABNYA
    -- berbeda: `hangus` karena ia terlambat, `kredit_habis` karena kreditnya
    -- memang hanya sekali. Layar yang menyebut sebab yang salah membuat klien
    -- mengira dirinya dihukum atas waktu.
    when jenjang = 2 and lahir_dari_kredit then 'kredit_habis'
    when jenjang = 2 then 'hak'
    when jenjang = 3 then 'hangus'
    else 'refund'
  end;
```

Deklarasikan `lahir_dari_kredit boolean;` di blok `declare`, dan ubah blok penerbitan hak menjadi `if akibat = 'hak' then` (nilainya kini bisa `kredit_habis`, yang tidak menerbitkan apa pun).

Pada `jadwal_ulang_sesi` — tanda tangannya bertambah dua argumen, dan yang lama WAJIB dibuang:

```sql
-- Tanda tangan lama DIBUANG, bukan dibiarkan berdampingan. Dua fungsi
-- bernama sama dengan jumlah argumen berbeda berarti pemanggil yang lupa
-- diperbarui tetap berhasil memanggil yang lama — gagal diam-diam, bentuk
-- kegagalan yang paling mahal. Aplikasi belum rilis, jadi tidak ada pemanggil
-- luar yang perlu ditunggu.
drop function if exists public.jadwal_ulang_sesi(uuid, date, time);

create or replace function public.jadwal_ulang_sesi(
  sesi_id uuid,
  tanggal_baru date,
  jam_baru time,
  darurat boolean,
  alasan text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
```

Di dalam badannya, sisipkan pemeriksaan darurat **sebelum baris apa pun disentuh** (pola yang sama dengan `batalkan_sesi`):

```sql
  -- DARURAT MEDIS pada jadwal ulang (spec C3 P7, keputusan pemilik 9 Sep 2026).
  -- Poster menyebut "ditinjau untuk RESCHEDULE tanpa penalti", dan tanpa jalur
  -- ini satu-satunya yang tersedia bagi klien yang masuk rumah sakit satu jam
  -- sebelum sesinya adalah batal-darurat -> refund -> memesan ulang dari nol:
  -- uang keluar lalu masuk lagi, bidannya lepas, dan orang yang sedang dirawat
  -- disuruh mengisi ulang formulir.
  --
  -- Diperiksa lebih dulu supaya penolakannya tidak menyentuh baris apa pun.
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
```

lalu gerbangkan ketiga pagar waktunya pada `not darurat` — jenjang 3 ditolak, jatah dipakai, dan ambang 2 jam untuk waktu baru:

```sql
  -- Jenjang 3 tidak mengenal jadwal ulang: poster menyebutnya pemesanan baru.
  -- KECUALI darurat, yang justru hampir selalu jatuh di jendela ini.
  if jenjang = 3 and not darurat then
    raise exception 'kurang dari 2 jam sebelum sesi — jadwal ulang dihitung sebagai pemesanan baru'
      using errcode = '23514';
  end if;

  -- Darurat TIDAK memakan jatah klien: "tanpa penalti" di poster berarti
  -- keadaan daruratnya tidak boleh membuatnya kehilangan hak yang ia punya
  -- untuk keadaan biasa.
  if jenjang = 2 and not darurat then
    if s.jadwal_ulang_terpakai then
      raise exception 'jatah jadwal ulang gratis untuk pemesanan ini sudah terpakai'
        using errcode = '23514';
    end if;
    pakai_jatah := true;
  end if;
```

dan pada pagar "waktu baru minimal 2 jam dari sekarang", tambahkan `and not darurat` dengan komentar bahwa sesi darurat justru sering dipindah ke waktu dekat. Jenjang yang DILAPORKAN saat darurat adalah `1` (perlakuan tanpa penalti) — setel `jenjang := 1;` di dalam cabang darurat, sesudah jenjang waktunya dihitung, supaya jejak dan nilai kembaliannya menyebut perlakuan yang sebenarnya berlaku.

Terakhir, `insert into public.jejak_jadwal` pada fungsi ini harus ikut membawa `alasan` dan `darurat` (sebelumnya keduanya memakai nilai bawaan kolom).

Tutup berkas dengan grant yang sama seperti aslinya:

```sql
revoke execute on function public.jadwal_ulang_sesi(uuid, date, time, boolean, text)
  from public, anon;
grant execute on function public.jadwal_ulang_sesi(uuid, date, time, boolean, text)
  to authenticated;
```

- [ ] **Step 4: Perbarui pemanggil `jadwal_ulang_sesi` yang sudah ada**

Tanda tangannya berubah, jadi pemanggil lama akan gagal keras. Ada dua:
- `web/src/app/admin/sesi/aksi-pembatalan.ts` — fungsi `jadwalUlangSesiAdmin`. Tambahkan `darurat` dan `alasan` dari `FormData` (admin memang berhak keduanya).
- `web/tests/pembatalan-rpc.test.ts` — setiap `rpc("jadwal_ulang_sesi", …)` perlu dua argumen baru. Untuk uji yang tidak sedang menguji darurat, kirim `darurat: false, alasan: ""`.

Cari sendiri dengan `grep -rn "jadwal_ulang_sesi" src tests` agar tidak ada yang terlewat.

- [ ] **Step 5: Terapkan & jalankan uji**

Run: `npx supabase migration up --local && npx vitest run tests/c3b-rantai-darurat.test.ts tests/pembatalan-rpc.test.ts tests/jejak-yatim.test.ts`
Expected: PASS semua.

- [ ] **Step 6: Commit**

```bash
git add web/supabase/migrations/20260915100000_c3b_rantai_kredit_darurat.sql \
        web/tests/c3b-rantai-darurat.test.ts \
        web/src/app/admin/sesi/aksi-pembatalan.ts web/tests/pembatalan-rpc.test.ts
git commit -m "feat(pembatalan): rantai kredit berhenti, dan darurat berlaku untuk jadwal ulang

Tanpa yang pertama, masa berlaku 30 hari berhenti benar: tiap putaran
menerbitkan kredit yang kedaluwarsanya dihitung dari tanggal sesi baru.
Tanpa yang kedua, klien yang masuk rumah sakit satu jam sebelum sesinya hanya
bisa refund lalu memesan ulang dari nol — dan poster menjanjikan reschedule."
```

---

## Task 2: Satu pembaca hak, dan sesi yang membawa jatahnya

**Files:**
- Create: `web/src/lib/pembatalan/hak.ts` (isi dipindah dari `web/src/lib/admin/hak.ts`)
- Delete: `web/src/lib/admin/hak.ts`
- Modify: `web/src/app/admin/klien/[id]/page.tsx`, `web/src/app/admin/klien/[id]/kartu-hak.tsx`, `web/tests/admin-hak-tukar.test.ts` (impor saja — berkas uji itu me-mock `createServerSupabase` dan mengimpor fungsinya secara dinamis; jalur impornya ikut berubah)
- Modify: `web/src/lib/passport/data.ts`, `web/src/lib/passport/turunan.ts`
- Test: `web/tests/passport-pembatalan-klien.test.ts` (dibuat di sini, ditambah di Task 3)

**Interfaces:**
- Consumes: `hakBerlakuKlien(clientId: string, hariIni: string): Promise<HakKlien[]>` dan `type HakKlien = { id, namaLayanan, kedaluwarsa, tanggalAsal }` — sudah ada di `web/src/lib/admin/hak.ts`, dipindah apa adanya.
- Produces: `@/lib/pembatalan/hak` mengekspor `hakBerlakuKlien` dan `HakKlien`; `SesiRingkas.jadwalUlangTerpakai: boolean`.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/passport-pembatalan-klien.test.ts`:

```ts
/**
 * JALUR KLIEN: HAK BACA & BENTUK DATA (spec C3 P5).
 *
 * Yang dijaga berkas ini bukan tampilan melainkan permukaan: klien boleh
 * MEMBACA haknya sendiri, dan tidak boleh menulis apa pun — termasuk lewat
 * jalur yang baru dibuka C3-b.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";

const admin = createAdminSupabase();
const ANANDA = "44444444-4444-4444-4444-444444444401";
const RINA = "44444444-4444-4444-4444-444444444402";
const SVC = "11111111-1111-1111-1111-111111111101";

afterAll(async () => {
  await admin.from("hak_sesi").delete().in("client_id", [ANANDA, RINA]);
});

describe("pembaca hak dipakai bersama, bukan disalin", () => {
  it("hidup di `lib/pembatalan`, bukan di `lib/admin`", () => {
    // Panel admin DAN Passport membaca hak yang sama dengan aturan yang sama
    // (belum ditukar, belum kedaluwarsa). Dua salinan yang harus sepakat
    // selamanya adalah kembaran yang akhirnya menyimpang — dan yang menyimpang
    // di sini adalah kredit yang terlihat di satu layar tetapi tidak di layar
    // lain.
    expect(() => readFileSync(path.resolve(__dirname, "..", "src/lib/admin/hak.ts"))).toThrow();
  });

  it("pemanggil lamanya ikut diarahkan ke lokasi baru", () => {
    // `tests/admin-hak-tukar.test.ts` sudah menguji PERILAKU fungsi ini secara
    // menyeluruh (termasuk me-mock `createServerSupabase`, yang menuntut
    // cookie permintaan dan karena itu tidak bisa dipanggil polos dari vitest).
    // Yang dijaga di SINI hanya satu: berkas itu mengimpor dari lokasi baru,
    // sehingga tidak ada dua salinan yang harus sepakat selamanya.
    const uji = readFileSync(
      path.resolve(__dirname, "admin-hak-tukar.test.ts"),
      "utf8",
    );
    expect(uji).toContain("@/lib/pembatalan/hak");
    expect(uji).not.toContain("@/lib/admin/hak");
  });
});

describe("klien tidak punya permukaan tulis baru", () => {
  it("tidak ada policy tulis atas `sessions` yang terbuka bagi klien", async () => {
    // Diperiksa langsung ke katalog, bukan disimpulkan dari perilaku.
    //
    // `cmd` TIDAK boleh disaring ke 'UPDATE' saja: policy "sessions: staf"
    // dibuat `for all`, jadi ia tercatat sebagai 'ALL' dan saringan 'UPDATE'
    // akan memulangkan nol baris apa pun yang terjadi — uji yang hijau
    // selamanya dan tidak menjaga apa pun. Ambil SEMUA policy non-SELECT, lalu
    // tuntut tiap satunya bergerbang `user_role()`.
    const baris = await querySql<{ policyname: string; cmd: string; qual: string | null }>(
      `select policyname, cmd, qual::text
         from pg_policies
        where schemaname = 'public' and tablename = 'sessions'`,
    );
    const tulis = baris.filter((b) => b.cmd !== "SELECT");
    expect(tulis.length, "tidak ada policy tulis sama sekali — pagarnya hilang").toBeGreaterThan(0);
    const terbukaKlien = tulis.filter((b) => !(b.qual ?? "").includes("user_role()"));
    expect(terbukaKlien).toEqual([]);
  });

  it("`hak_sesi` tidak punya policy tulis untuk klien", async () => {
    const baris = await querySql<{ cmd: string; qual: string | null }>(
      `select cmd, qual::text from pg_policies
        where schemaname = 'public' and tablename = 'hak_sesi'`,
    );
    const tulisKlien = baris.filter(
      (b) => b.cmd !== "SELECT" && !(b.qual ?? "").includes("user_role()"),
    );
    expect(tulisKlien).toEqual([]);
  });

  it("klien tidak bisa mengubah `jadwal_ulang_terpakai` sesinya sendiri", async () => {
    // Kolom itu adalah jatahnya. Bila klien bisa menulisnya, aturan "1x per
    // pemesanan" dibatalkan oleh satu permintaan PATCH.
    const sesi = await signInAs("ananda@padma.test");
    const { data } = await sesi
      .from("sessions")
      .update({ jadwal_ulang_terpakai: false })
      .eq("client_id", ANANDA)
      .select("id");
    expect(data ?? []).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `npx vitest run tests/passport-pembatalan-klien.test.ts`
Expected: FAIL — `Cannot find module '@/lib/pembatalan/hak'`

- [ ] **Step 3: Pindahkan berkasnya & perbarui pemanggil**

```bash
git mv web/src/lib/admin/hak.ts web/src/lib/pembatalan/hak.ts
```

Ubah dokbloknya agar menyebut kedua pemakainya (panel admin dan Passport), bukan hanya admin — komentar yang menyebut satu pemakai padahal ada dua adalah komentar yang berbohong. Lalu perbarui SELURUH pemanggilnya dari `@/lib/admin/hak` menjadi `@/lib/pembatalan/hak` — cari dengan `grep -rn "lib/admin/hak" src tests` agar tidak ada yang terlewat. Saat ini ada tiga: `src/app/admin/klien/[id]/page.tsx`, `src/app/admin/klien/[id]/kartu-hak.tsx`, dan `tests/admin-hak-tukar.test.ts`.

- [ ] **Step 4: Bawa jatah ke bentuk sesi klien**

Di `web/src/lib/passport/turunan.ts`, tambahkan ke `SesiRingkas`:

```ts
  /**
   * Jatah jadwal ulang gratis pemesanan ini — `true` berarti sudah terpakai
   * (spec C3 P4). Dibawa sampai ke layar karena klien harus TAHU sebelum
   * menekan bahwa perubahan berikutnya bukan lagi penggeseran gratis.
   */
  jadwalUlangTerpakai: boolean;
```

Di `web/src/lib/passport/data.ts`: tambahkan `jadwal_ulang_terpakai` ke `KOLOM_SESI`, ke tipe `BarisSesi`, dan ke hasil `petakanSesi` (`jadwalUlangTerpakai: r.jadwal_ulang_terpakai`).

- [ ] **Step 5: Jalankan uji**

Run: `npx vitest run tests/passport-pembatalan-klien.test.ts tests/admin-hak-tukar.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: uji PASS; `tsc` bersih kecuali galat bernama `LayoutProps` (bawaan Next.js).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/pembatalan/hak.ts web/src/lib/passport/data.ts web/src/lib/passport/turunan.ts \
        "web/src/app/admin/klien/[id]/page.tsx" "web/src/app/admin/klien/[id]/kartu-hak.tsx" \
        web/tests/admin-hak-tukar.test.ts web/tests/passport-pembatalan-klien.test.ts
git commit -m "refactor(hak): satu pembaca untuk panel admin dan Passport

Dua salinan yang harus sepakat selamanya adalah kembaran yang akhirnya
menyimpang — dan yang menyimpang di sini adalah kredit yang terlihat di satu
layar tetapi tidak di layar lain."
```

---

## Task 3: Server action klien, dengan aktornya terkunci

**Files:**
- Create: `web/src/lib/passport/pembatalan.ts`
- Create: `web/src/app/passport/sesi/[id]/aksi.ts`
- Modify: `web/tests/passport-pembatalan-klien.test.ts` (tambah blok di akhir)

**Interfaces:**
- Consumes: `jenjangPembatalan`, `akibatPembatalan`, `KALIMAT_AKIBAT`, `LABEL_JENJANG_PEMBATALAN` dari `@/lib/pembatalan/jenjang`; `jamDariDb` dari `@/lib/jadwal/jam`; `bacaPengaturan()` dari `@/lib/settings` (medan `jamLayanan` SUDAH `string[]`); RPC `batalkan_sesi(sesi_id, alasan, darurat, oleh)` dan `jadwal_ulang_sesi(sesi_id, tanggal_baru, jam_baru, darurat, alasan)`.
- Produces:
  - `ringkasanUntukKlien(tanggal: string, jamMulai: string, jadwalUlangTerpakai: boolean, sekarang?: Date): RingkasKlien` di `@/lib/passport/pembatalan`, dengan `type RingkasKlien = { jenjang: 1|2|3; label: string; kalimat: string; bolehJadwalUlang: boolean; jatahHabis: boolean }`
  - server action `batalkanSesiKlien(formData: FormData): Promise<Hasil>` dan `jadwalUlangSesiKlien(formData: FormData): Promise<Hasil>`, dengan `type Hasil = { ok: true; pesan: string } | { ok: false; pesan: string }`

- [ ] **Step 1: Tulis uji yang gagal**

Tambahkan di akhir `web/tests/passport-pembatalan-klien.test.ts`:

```ts
describe("ringkasan yang dilihat klien", () => {
  it("jenjang 1: boleh jadwal ulang, kalimatnya menyebut dana kembali", async () => {
    const { ringkasanUntukKlien } = await import("@/lib/passport/pembatalan");
    const r = ringkasanUntukKlien("2027-03-10", "09:00:00", false, new Date("2027-03-08T02:00:00Z"));
    expect(r.jenjang).toBe(1);
    expect(r.bolehJadwalUlang).toBe(true);
    expect(r.jatahHabis).toBe(false);
    expect(r.kalimat).toContain("dikembalikan penuh");
  });

  it("menerima jam 'HH:MM:SS' apa adanya dari Postgres", async () => {
    // `instanSesi` di balik hitungan jenjang hanya menerima 'HH:MM' dan
    // MELEMPAR untuk selainnya. Kolomnya bernilai 'HH:MM:SS', jadi lapisan ini
    // yang wajib memendekkannya — bukan setiap pemanggil, satu per satu.
    const { ringkasanUntukKlien } = await import("@/lib/passport/pembatalan");
    expect(() =>
      ringkasanUntukKlien("2027-03-10", "09:00:00", false, new Date("2027-03-08T02:00:00Z")),
    ).not.toThrow();
  });

  it("jenjang 2 dengan jatah UTUH: boleh jadwal ulang", async () => {
    const { ringkasanUntukKlien } = await import("@/lib/passport/pembatalan");
    const r = ringkasanUntukKlien("2027-03-10", "09:00:00", false, new Date("2027-03-10T00:00:00Z"));
    expect(r.jenjang).toBe(2);
    expect(r.bolehJadwalUlang).toBe(true);
    expect(r.jatahHabis).toBe(false);
  });

  it("jenjang 2 dengan jatah HABIS: tidak boleh, dan itu ditandai tersendiri", async () => {
    // `jatahHabis` dibedakan dari sekadar `!bolehJadwalUlang` karena layarnya
    // berbeda: yang satu menawarkan batal-jadi-kredit, yang lain (jenjang 3)
    // tidak menawarkan apa pun.
    const { ringkasanUntukKlien } = await import("@/lib/passport/pembatalan");
    const r = ringkasanUntukKlien("2027-03-10", "09:00:00", true, new Date("2027-03-10T00:00:00Z"));
    expect(r.jenjang).toBe(2);
    expect(r.bolehJadwalUlang).toBe(false);
    expect(r.jatahHabis).toBe(true);
  });

  it("jenjang 3: tidak boleh jadwal ulang, dan jatahnya tidak relevan", async () => {
    const { ringkasanUntukKlien } = await import("@/lib/passport/pembatalan");
    const r = ringkasanUntukKlien("2027-03-10", "09:00:00", false, new Date("2027-03-10T00:30:00Z"));
    expect(r.jenjang).toBe(3);
    expect(r.bolehJadwalUlang).toBe(false);
    expect(r.jatahHabis).toBe(false);
  });
});

describe("aktor klien TERKUNCI di sumber, bukan dipercayakan ke formulir", () => {
  const sumber = readFileSync(
    path.resolve(__dirname, "..", "src/app/passport/sesi/[id]/aksi.ts"),
    "utf8",
  );

  it("`oleh` ditulis sebagai literal \"klien\"", () => {
    // Bila ia datang dari FormData, klien bisa mengirim "padma" dan
    // mengubah pembatalannya sendiri menjadi jenjang 4 — refund penuh kapan
    // pun, termasuk satu jam sebelum bidan berangkat.
    expect(sumber).toMatch(/oleh:\s*"klien"/);
    expect(sumber).not.toMatch(/oleh:.*formData/);
  });

  it("`darurat` ditulis sebagai literal false", () => {
    // Darurat adalah keputusan manusia di pihak PADMA (spec P7). Klien yang
    // bisa menyatakan dirinya darurat memegang tombol refund penuh.
    expect(sumber).toMatch(/darurat:\s*false/);
    expect(sumber).not.toMatch(/darurat:.*formData/);
  });

  it("tidak memuat service role", () => {
    // Jejak audit harus menyebut aktor yang NYATA; service role tidak punya
    // `auth.uid()` sama sekali, sehingga jejaknya lahir tanpa penanggung jawab.
    expect(sumber).not.toContain("createAdminSupabase");
    expect(sumber).not.toContain("SERVICE_ROLE");
  });

  it("memperlakukan `data === null` sebagai GAGAL", () => {
    // RPC memulangkan NULL — bukan galat — ketika barisnya tidak lagi
    // `terjadwal`. Aksi yang hanya melihat `error` melaporkan berhasil untuk
    // panggilan yang tidak mengenai apa pun, dan klien menutup layar yakin
    // sesinya sudah batal.
    expect(sumber).toMatch(/data === null|!data/);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `npx vitest run tests/passport-pembatalan-klien.test.ts`
Expected: FAIL — modul `@/lib/passport/pembatalan` dan berkas aksi belum ada.

- [ ] **Step 3: Tulis lapisan ringkasannya**

Buat `web/src/lib/passport/pembatalan.ts`:

```ts
import {
  jenjangPembatalan,
  akibatPembatalan,
  LABEL_JENJANG_PEMBATALAN,
  KALIMAT_AKIBAT,
} from "@/lib/pembatalan/jenjang";
import { jamDariDb } from "@/lib/jadwal/jam";

/**
 * APA YANG KLIEN LIHAT SEBELUM MENEKAN (spec C3 P1, P4).
 *
 * MURNI, dan `sekarang` selalu bisa disuntikkan: fungsi waktu yang membaca
 * jamnya sendiri tidak bisa diuji di ambangnya, dan ambang itulah satu-satunya
 * tempat ia bisa salah.
 *
 * Yang MEMUTUSKAN tetap fungsi Postgres. Ini hanya menerangkan — dan bila
 * keduanya berselisih, yang berlaku adalah basis data: layar akan terlihat
 * salah, tetapi tidak bisa membuat keputusan yang salah.
 */

export type RingkasKlien = {
  jenjang: 1 | 2 | 3;
  label: string;
  kalimat: string;
  /** Boleh menggeser jadwal tanpa kehilangan apa pun. */
  bolehJadwalUlang: boolean;
  /**
   * Jatah penggeseran gratisnya sudah terpakai DAN ia sedang di jendela yang
   * menuntut jatah. Dibedakan dari sekadar `!bolehJadwalUlang` karena layarnya
   * berbeda: yang ini menawarkan batal-jadi-kredit, sedangkan jenjang 3 tidak
   * menawarkan apa pun.
   */
  jatahHabis: boolean;
};

export function ringkasanUntukKlien(
  tanggal: string,
  /** 'HH:MM:SS' apa adanya dari Postgres — dipendekkan DI SINI. */
  jamMulai: string,
  jadwalUlangTerpakai: boolean,
  sekarang: Date = new Date(),
): RingkasKlien {
  // `jamDariDb` WAJIB di sini, bukan di pemanggil. `instanSesi` di balik
  // hitungan jenjang hanya menerima 'HH:MM' dan MELEMPAR untuk selainnya —
  // sengaja, supaya waktu yang diam-diam menjadi NaN tidak merambat menjadi
  // pagar yang terbuka tanpa galat. Meletakkannya di setiap pemanggil berarti
  // menunggu salah satu pemanggil lupa.
  const jenjang = jenjangPembatalan(tanggal, jamDariDb(jamMulai), sekarang);
  const jatahHabis = jenjang === 2 && jadwalUlangTerpakai;

  return {
    jenjang,
    label: LABEL_JENJANG_PEMBATALAN[jenjang],
    kalimat: KALIMAT_AKIBAT[akibatPembatalan(jenjang)],
    bolehJadwalUlang: jenjang === 1 || (jenjang === 2 && !jadwalUlangTerpakai),
    jatahHabis,
  };
}
```

- [ ] **Step 4: Tulis server action-nya**

Buat `web/src/app/passport/sesi/[id]/aksi.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

type Hasil = { ok: true; pesan: string } | { ok: false; pesan: string };

/**
 * PEMBATALAN & JADWAL ULANG OLEH KLIEN (spec C3 P5).
 *
 * Tidak ada policy UPDATE baru atas `sessions`. Keduanya memanggil fungsi
 * Postgres `security definer` yang sejak C3-a memeriksa kepemilikan sendiri
 * terhadap `auth.uid()` lewat `clients.user_id` — jadi mengirim id sesi orang
 * lain ditolak basis data, bukan oleh perbandingan yang ditulis di sini.
 *
 * ===== DUA NILAI YANG TIDAK PERNAH DATANG DARI FORMULIR =====
 * `oleh` dan `darurat` ditulis sebagai LITERAL. Keduanya menentukan uang:
 * `oleh: "padma"` memaksa jenjang 4 (refund penuh kapan pun), dan
 * `darurat: true` memaksa perlakuan jenjang 1. Menerimanya dari `FormData`
 * berarti menyerahkan keduanya kepada peramban — dan peramban dikendalikan
 * orang yang diuntungkannya.
 */
export async function batalkanSesiKlien(formData: FormData): Promise<Hasil> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase.rpc("batalkan_sesi", {
    sesi_id: String(formData.get("sesi") ?? ""),
    alasan: "",
    darurat: false,
    oleh: "klien",
  });

  if (error) return { ok: false, pesan: kalimatGalat(error.message) };
  // NULL, bukan galat: sesinya sudah tidak `terjadwal` — dibatalkan di tab
  // lain, atau sudah ditangani tim. Melaporkannya berhasil membuat klien
  // menutup layar yakin sesuatu terjadi.
  if (data === null) {
    return { ok: false, pesan: "Sesi ini sudah tidak bisa dibatalkan. Muat ulang halamannya." };
  }

  revalidatePath("/passport/sesi/[id]", "page");
  revalidatePath("/passport/sesi");
  revalidatePath("/passport");
  revalidatePath("/passport/kredit");

  const akibat = (data as { akibat: string }).akibat;
  return { ok: true, pesan: KALIMAT_HASIL[akibat] ?? "Sesi Anda sudah dibatalkan." };
}

export async function jadwalUlangSesiKlien(formData: FormData): Promise<Hasil> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase.rpc("jadwal_ulang_sesi", {
    sesi_id: String(formData.get("sesi") ?? ""),
    tanggal_baru: String(formData.get("tanggal") ?? ""),
    jam_baru: String(formData.get("jam") ?? ""),
    darurat: false,
    alasan: "",
  });

  if (error) return { ok: false, pesan: kalimatGalat(error.message) };
  if (data === null) {
    return { ok: false, pesan: "Sesi ini sudah tidak bisa digeser. Muat ulang halamannya." };
  }

  revalidatePath("/passport/sesi/[id]", "page");
  revalidatePath("/passport/sesi");
  revalidatePath("/passport");
  return { ok: true, pesan: "Jadwal Anda sudah dipindahkan." };
}

/**
 * Kalimat yang dibaca klien sesudah pembatalannya berhasil.
 *
 * `kredit_habis` PUNYA kalimatnya sendiri dan tidak dilebur ke `hangus`:
 * keduanya berarti "tidak menerima apa pun", tetapi sebabnya berbeda, dan
 * klien yang dikabari sebab yang salah akan mengira dirinya dihukum atas waktu.
 */
const KALIMAT_HASIL: Record<string, string> = {
  refund: "Sesi dibatalkan. Dana Anda dikembalikan penuh — tim PADMA menghubungi Anda untuk prosesnya.",
  hak: "Sesi dibatalkan. Dana Anda menjadi kredit satu sesi untuk layanan yang sama, berlaku 30 hari — lihat di halaman Kredit.",
  kredit_habis:
    "Sesi dibatalkan. Sesi ini sendiri berasal dari kredit, dan kredit hanya berlaku satu kali — jadi tidak ada kredit baru yang terbit.",
  hangus: "Sesi dibatalkan. Karena kurang dari 2 jam sebelum jadwalnya, dananya tidak dapat dikembalikan.",
};

/**
 * Pesan Postgres ditulis untuk pengembang. Yang sampai ke klien hanya kalimat
 * yang bisa ia tindak; sisanya diseragamkan supaya isi basis data tidak bocor
 * ke layar.
 */
function kalimatGalat(mentah: string): string {
  if (mentah.includes("jatah jadwal ulang")) {
    return "Jatah penggeseran gratis untuk pemesanan ini sudah terpakai.";
  }
  if (mentah.includes("kurang dari 2 jam")) {
    return "Kurang dari 2 jam sebelum sesi — jadwal ulang dihitung sebagai pemesanan baru.";
  }
  if (mentah.includes("jam layanan")) return "Jam itu di luar jam layanan klinik.";
  if (mentah.includes("bidan sudah punya jadwal")) {
    return "Bidan Anda sudah punya jadwal pada waktu itu. Pilih waktu lain.";
  }
  if (mentah.includes("terlalu dekat")) {
    return "Waktu baru terlalu dekat — pilih minimal 2 jam dari sekarang.";
  }
  return "Tidak bisa diproses. Coba lagi, atau hubungi tim PADMA.";
}
```

- [ ] **Step 5: Jalankan uji**

Run: `npx vitest run tests/passport-pembatalan-klien.test.ts tests/pagar-batas-server-klien.test.ts tests/passport-shell.test.ts`
Expected: PASS semua.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/passport/pembatalan.ts "web/src/app/passport/sesi/[id]/aksi.ts" \
        web/tests/passport-pembatalan-klien.test.ts
git commit -m "feat(passport): aksi batal & jadwal ulang klien, aktornya terkunci

oleh dan darurat ditulis sebagai literal, tidak pernah dari FormData: keduanya
menentukan uang, dan menerimanya dari peramban berarti menyerahkannya kepada
orang yang diuntungkannya."
```

---

## Task 4: Layar detail sesi — akibatnya tertulis sebelum ditekan

**Files:**
- Create: `web/src/app/passport/sesi/[id]/kartu-pembatalan.tsx`
- Modify: `web/src/app/passport/sesi/[id]/page.tsx`
- Test: `web/tests/passport-kartu-pembatalan.test.ts`

**Interfaces:**
- Consumes: `ringkasanUntukKlien` dari `@/lib/passport/pembatalan` (Task 3); `batalkanSesiKlien`, `jadwalUlangSesiKlien` dari `./aksi` (Task 3); `SesiRingkas.jadwalUlangTerpakai` (Task 2); `bacaPengaturan()` dari `@/lib/settings` — medan `jamLayanan` SUDAH `string[]`.
- Produces: komponen `<KartuPembatalan>` dengan prop `{ sesiId, tanggal, jamMulai, jadwalUlangTerpakai, jamPilihan }`.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/passport-kartu-pembatalan.test.ts`:

```ts
/**
 * KARTU PEMBATALAN DI PASSPORT (spec C3 P4, P5).
 *
 * Uji berbasis pemindaian sumber, dan itu disengaja: komponennya klien murni
 * (suite berjalan tanpa jsdom), sedangkan yang dijaga di sini adalah JANJI
 * yang harus terbaca di layar sebelum klien menekan. Setiap pola dipilih agar
 * tidak bisa cocok secara kebetulan.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const akar = path.resolve(__dirname, "..");
const sumber = readFileSync(
  path.join(akar, "src/app/passport/sesi/[id]/kartu-pembatalan.tsx"),
  "utf8",
);
const halaman = readFileSync(
  path.join(akar, "src/app/passport/sesi/[id]/page.tsx"),
  "utf8",
);

describe("akibatnya tertulis SEBELUM klien menekan", () => {
  it("kalimat akibat dirender, bukan hanya dihitung", () => {
    expect(sumber).toMatch(/\{r\.kalimat\}/);
  });

  it("membatalkan menuntut DUA ketukan", () => {
    // Pola yang sama dengan `tombol-batal.tsx` untuk pengajuan, dan alasannya
    // sama: kartu ini dibuka sambil lalu, dan yang hilang bila salah tekan
    // adalah sesi berbayar.
    expect(sumber).toMatch(/konfirmasi/i);
    expect(sumber).toMatch(/setKonfirmasi/);
  });

  it("jam ditawarkan sebagai PILIHAN, bukan medan waktu bebas", () => {
    // Basis data menuntut keanggotaan `app_settings.jam_layanan` DAN kelipatan
    // 30 menit. Medan `type="time"` menerima 09:17, dan setiap 09:17 berakhir
    // sebagai galat sesudah klien menekan kirim.
    expect(sumber).toMatch(/<select[\s\S]{0,200}name="jam"/);
    expect(sumber).not.toMatch(/type="time"/);
  });
});

describe("jatah habis DITAWARI jalan keluarnya", () => {
  it("menyebut kredit 30 hari pada cabang jatah habis", () => {
    // Spec P4: menolak lalu menyuruh menghubungi admin menyerahkan nasib uang
    // klien pada waktu balas admin — bila tenggat 2 jam keburu lewat ia jatuh
    // ke jenjang 3 dan uangnya benar-benar hangus.
    expect(sumber).toMatch(/jatahHabis/);
    expect(sumber).toMatch(/kredit/i);
    expect(sumber).toMatch(/30 hari/);
  });

  it("tawarannya tetap menuntut ketukan kedua, tidak pernah membatalkan otomatis", () => {
    // Klien menekan tombol yang menurutnya MEMINDAHKAN jadwal. Membatalkan
    // sesinya diam-diam karena itu adalah mengambil keputusan atas namanya.
    expect(sumber).not.toMatch(/jatahHabis[\s\S]{0,200}batalkanSesiKlien\(/);
  });
});

describe("kartunya hanya untuk sesi yang masih terjadwal", () => {
  it("dirender di balik penjaga status", () => {
    // Menawarkan tombol batal pada sesi yang sudah selesai atau sudah batal
    // adalah tombol yang pasti ditolak basis data — dan tombol yang berbohong
    // adalah cara tercepat membuat orang berhenti memercayai layarnya.
    expect(halaman).toMatch(/sesi\.status === "terjadwal"[\s\S]{0,400}KartuPembatalan/);
  });

  it("jam layanan dibaca di server dan dioper sebagai prop", () => {
    // Komponen klien tidak mengambil data sendiri; seluruh isinya datang dari
    // server. Ini juga yang membuat daftarnya SATU sumber dengan yang dibaca
    // RPC.
    expect(halaman).toMatch(/jamPilihan=/);
    expect(sumber).not.toMatch(/@\/lib\/supabase/);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `npx vitest run tests/passport-kartu-pembatalan.test.ts`
Expected: FAIL — berkas komponennya belum ada.

- [ ] **Step 3: Tulis komponennya**

Buat `web/src/app/passport/sesi/[id]/kartu-pembatalan.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { batalkanSesiKlien, jadwalUlangSesiKlien } from "./aksi";
import { ringkasanUntukKlien } from "@/lib/passport/pembatalan";

/**
 * MENGUBAH ATAU MEMBATALKAN SATU KUNJUNGAN (spec C3 P4, P5, P8).
 *
 * Yang membedakan kartu ini dari sekadar dua tombol: akibat uangnya TERTULIS
 * sebelum klien menekan. Kebijakan empat jenjang PADMA berarti menekan tombol
 * yang sama pada jam yang berbeda menghasilkan hal yang sangat berbeda — dan
 * orang yang tidak diberi tahu perbedaannya akan merasa dijebak, bukan dilayani.
 *
 * Hitungan di sini hanya MENERANGKAN; yang MEMUTUSKAN adalah fungsi Postgres.
 * Keduanya memakai ambang yang sama. Bila berselisih, basis data yang berlaku —
 * layar ini akan terlihat salah, tetapi tidak bisa membuat keputusan yang salah.
 *
 * Bidan TIDAK ikut dipilih ulang (spec P8): hubungan klien–bidan sudah
 * terbentuk, dan mengganti orang yang akan masuk ke rumah seseorang bukan
 * akibat wajar dari memindahkan jam.
 */
export function KartuPembatalan({
  sesiId,
  tanggal,
  jamMulai,
  jadwalUlangTerpakai,
  jamPilihan,
}: {
  sesiId: string;
  tanggal: string;
  /** 'HH:MM:SS' apa adanya dari Postgres. */
  jamMulai: string;
  jadwalUlangTerpakai: boolean;
  /** `app_settings.jam_layanan` — sumber yang SAMA dengan yang dibaca RPC. */
  jamPilihan: string[];
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [konfirmasiBatal, setKonfirmasiBatal] = useState(false);
  const [bukaGeser, setBukaGeser] = useState(false);

  const r = ringkasanUntukKlien(tanggal, jamMulai, jadwalUlangTerpakai);

  if (pesan) {
    return (
      <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
        <p className="text-[13.5px] leading-relaxed text-ink">{pesan}</p>
      </section>
    );
  }

  return (
    <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
      <h2 className="mb-1 font-serif text-xl text-night">Ubah atau batalkan</h2>
      <p className="mb-1 text-[12.5px] font-semibold text-ink-soft">{r.label}</p>
      <p className="mb-4 text-[13px] leading-relaxed text-[#3C4C42]">{r.kalimat}</p>

      {r.bolehJadwalUlang && !bukaGeser && (
        <button
          type="button"
          onClick={() => setBukaGeser(true)}
          className="mb-3 block w-full rounded-xl border border-black/15 px-4 py-3 text-[13px] font-bold text-ink"
        >
          Geser jadwal
        </button>
      )}

      {r.bolehJadwalUlang && bukaGeser && (
        <form
          action={(fd) =>
            mulai(async () => {
              fd.set("sesi", sesiId);
              const hasil = await jadwalUlangSesiKlien(fd);
              setPesan(hasil.pesan);
            })
          }
          className="mb-4 grid gap-2"
        >
          <label className="block text-[12.5px] font-semibold text-ink-soft">
            Tanggal baru
            <input
              type="date"
              name="tanggal"
              required
              className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5 text-[13px]"
            />
          </label>
          <label className="block text-[12.5px] font-semibold text-ink-soft">
            Jam baru
            {/* PILIHAN, bukan medan waktu bebas: basis data menuntut keanggotaan
                `app_settings.jam_layanan` DAN kelipatan 30 menit, jadi setiap
                09:17 yang bisa diketik berakhir sebagai galat sesudah dikirim. */}
            <select
              name="jam"
              required
              defaultValue=""
              className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5 text-[13px]"
            >
              <option value="" disabled>
                Pilih jam…
              </option>
              {jamPilihan.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-night px-4 py-3 text-[13px] font-bold text-paper disabled:opacity-60"
          >
            {pending ? "Memproses…" : "Pindahkan jadwal"}
          </button>
        </form>
      )}

      {/* JATAH HABIS — ditawari jalan keluarnya, bukan sekadar ditolak (spec P4).
          Menolak lalu menyuruh menghubungi admin menyerahkan nasib uang klien
          pada waktu balas admin: bila tenggat dua jam keburu lewat ia jatuh ke
          jenjang 3 dan dananya benar-benar hangus. */}
      {r.jatahHabis && (
        <p className="mb-3 rounded-xl border border-[#E9D9A8] bg-[#F7EDD3] p-3 text-[12.5px] leading-relaxed text-[#8A6A1B]">
          Jatah penggeseran gratis untuk pemesanan ini sudah terpakai. Anda masih bisa
          membatalkannya — dananya menjadi kredit satu sesi untuk layanan yang sama, berlaku
          30 hari.
        </p>
      )}

      {!konfirmasiBatal ? (
        <button
          type="button"
          onClick={() => setKonfirmasiBatal(true)}
          className="block text-left text-[12.5px] font-semibold text-clay underline underline-offset-2"
        >
          Batalkan kunjungan ini
        </button>
      ) : (
        /* DUA ketukan, bukan satu. Pola yang sama dengan `tombol-batal.tsx`
           untuk pengajuan, dan alasannya sama: halaman ini dibuka sambil lalu,
           dan yang hilang bila salah tekan adalah sesi yang sudah dibayar. */
        <div className="grid gap-2">
          <p className="text-[12.5px] font-semibold text-ink">Yakin membatalkan? {r.kalimat}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                mulai(async () => {
                  const fd = new FormData();
                  fd.set("sesi", sesiId);
                  const hasil = await batalkanSesiKlien(fd);
                  setPesan(hasil.pesan);
                })
              }
              className="rounded-xl border border-clay/40 px-4 py-2.5 text-[12.5px] font-bold text-clay disabled:opacity-60"
            >
              {pending ? "Memproses…" : "Ya, batalkan"}
            </button>
            <button
              type="button"
              onClick={() => setKonfirmasiBatal(false)}
              className="text-[12.5px] font-semibold text-ink-soft underline underline-offset-2"
            >
              Tidak jadi
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Sisipkan ke halaman detail**

Di `web/src/app/passport/sesi/[id]/page.tsx`:

1. Tambahkan impor `import { KartuPembatalan } from "./kartu-pembatalan";` dan `import { bacaPengaturan } from "@/lib/settings";`.
2. Sesudah `if (!sesi) notFound();`, baca jam layanannya:

```ts
  // Daftar jam dibaca di SERVER dan dioper sebagai prop: komponen klien tidak
  // mengambil data sendiri, dan daftarnya jadi SATU sumber dengan yang dibaca
  // fungsi Postgres saat menolak jam di luar jam layanan.
  const pengaturan = await bacaPengaturan();
  const jamPilihan = pengaturan.jamLayanan;
```

`pengaturan.jamLayanan` SUDAH berupa `string[]` — `bacaPengaturan()` menguraikannya sendiri lewat `uraikanDaftarJam` (lihat `web/src/lib/settings.ts:80`). Menguraikannya sekali lagi di sini adalah galat tipe.

3. Render kartunya tepat sesudah `<section>` rincian sesi (sebelum `{bolehDinilai && …}`):

```tsx
      {sesi.status === "terjadwal" && (
        <KartuPembatalan
          sesiId={sesi.id}
          tanggal={sesi.tanggal}
          jamMulai={sesi.jamMulai}
          jadwalUlangTerpakai={sesi.jadwalUlangTerpakai}
          jamPilihan={jamPilihan}
        />
      )}
```

- [ ] **Step 5: Jalankan uji**

Run: `npx vitest run tests/passport-kartu-pembatalan.test.ts tests/passport-shell.test.ts tests/pagar-batas-server-klien.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: uji PASS; `tsc` bersih kecuali `LayoutProps`.

- [ ] **Step 6: Commit**

```bash
git add "web/src/app/passport/sesi/[id]/kartu-pembatalan.tsx" \
        "web/src/app/passport/sesi/[id]/page.tsx" \
        web/tests/passport-kartu-pembatalan.test.ts
git commit -m "feat(passport): klien bisa membatalkan & menggeser sesinya sendiri

Akibat uangnya tertulis sebelum ditekan. Menekan tombol yang sama pada jam
berbeda menghasilkan hal yang sangat berbeda, dan orang yang tidak diberi tahu
perbedaannya akan merasa dijebak, bukan dilayani."
```

---

## Task 5: Halaman kredit — hak yang akhirnya punya tombolnya

**Files:**
- Create: `web/src/app/passport/kredit/page.tsx`, `web/src/app/passport/kredit/kartu-kredit.tsx`, `web/src/app/passport/kredit/aksi.ts`
- Modify: `web/src/app/passport/nav.tsx`, `web/README.md` (tabel rute)
- Test: `web/tests/passport-kredit.test.ts`

**Interfaces:**
- Consumes: `hakBerlakuKlien(clientId, hariIni)` dan `HakKlien` dari `@/lib/pembatalan/hak` (Task 2); `ambilKlien` dari `@/lib/passport/data`; `hariIniJakarta` dan `formatTanggalID` dari `@/lib/passport/waktu`; RPC `tukar_hak_sesi(hak_id, tanggal_baru, jam_baru, mitra)`.
- Produces: rute `/passport/kredit`; server action `tukarKreditKlien(formData: FormData): Promise<Hasil>`.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `web/tests/passport-kredit.test.ts`:

```ts
/**
 * KREDIT KLIEN & PENUKARANNYA (spec C3 P3, P8).
 *
 * Sampai C3-a, kredit yang terbit tidak bisa dilihat atau ditukar dari layar
 * klien mana pun — ia hanya ada di panel admin. Berkas ini menjaga dua hal:
 * kreditnya benar-benar terlihat pemiliknya, dan BIDANNYA tidak ikut dipilih
 * klien.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";

const admin = createAdminSupabase();
const ANANDA = "44444444-4444-4444-4444-444444444401";
const RINA = "44444444-4444-4444-4444-444444444402";
const SVC = "11111111-1111-1111-1111-111111111101";
const MITRA = "33333333-3333-3333-3333-333333333301";

const SESI_MILIK_UJI = new Set<string>();
function catatSesi(id: unknown) {
  if (typeof id === "string" && id.length > 0) SESI_MILIK_UJI.add(id);
}

let VARIAN: string;

async function bersihkan() {
  const ids = [...SESI_MILIK_UJI];
  if (ids.length > 0) {
    await admin.from("jejak_jadwal").delete().in("sesi_id", ids);
    await admin.from("jejak_status_bayar").delete().in("sesi_id", ids);
  }
  await admin.from("hak_sesi").delete().in("client_id", [ANANDA, RINA]);
  if (ids.length > 0) await admin.from("sessions").delete().in("id", ids);
  SESI_MILIK_UJI.clear();
}

beforeAll(async () => {
  VARIAN = await varianBaku(admin, SVC);
  await bersihkan();
});
afterAll(bersihkan);

describe("klien melihat kreditnya sendiri, dan hanya miliknya", () => {
  it("membaca hak miliknya lewat sesi pengguna", async () => {
    await admin.from("hak_sesi").insert({
      client_id: ANANDA, service_id: SVC, kedaluwarsa: "2099-12-31",
    });
    const sesi = await signInAs("ananda@padma.test");
    const { data, error } = await sesi.from("hak_sesi").select("id, client_id");
    expect(error).toBeNull();
    expect((data ?? []).every((h) => h.client_id === ANANDA)).toBe(true);
  });

  it("hak milik klien LAIN tidak pernah ikut terbaca", async () => {
    await admin.from("hak_sesi").insert({
      client_id: RINA, service_id: SVC, kedaluwarsa: "2099-12-31",
    });
    const sesi = await signInAs("ananda@padma.test");
    const { data } = await sesi.from("hak_sesi").select("client_id");
    expect((data ?? []).some((h) => h.client_id === RINA)).toBe(false);
  });
});

describe("bidan DIWARISI, tidak dipilih klien", () => {
  const sumber = readFileSync(
    path.resolve(__dirname, "..", "src/app/passport/kredit/aksi.ts"),
    "utf8",
  );
  const kartu = readFileSync(
    path.resolve(__dirname, "..", "src/app/passport/kredit/kartu-kredit.tsx"),
    "utf8",
  );

  it("formulir klien tidak punya medan bidan sama sekali", () => {
    // Spec P8: hubungan klien–bidan sudah terbentuk, dan memilih ulang orang
    // yang akan masuk ke rumah seseorang bukan akibat wajar dari menukar
    // kredit. Panel ADMIN memang punya medan itu — admin menangani kasus yang
    // bidan aslinya sudah tidak tersedia.
    expect(kartu).not.toMatch(/name="mitra"/);
  });

  it("`mitra` tidak pernah datang dari FormData", () => {
    expect(sumber).not.toMatch(/mitra:\s*String\(formData/);
  });

  it("memperlakukan `data === null` sebagai GAGAL", () => {
    // `tukar_hak_sesi` memulangkan NULL — bukan galat — bila haknya sudah
    // ditukar penukaran lain. Melaporkannya berhasil membuat klien menutup
    // layar yakin sesi penggantinya sudah ada.
    expect(sumber).toMatch(/data === null|!data/);
  });

  it("tidak memuat service role", () => {
    expect(sumber).not.toContain("createAdminSupabase");
    expect(sumber).not.toContain("SERVICE_ROLE");
  });
});

describe("penukaran oleh klien benar-benar melahirkan sesi", () => {
  it("sesi pengganti lahir LUNAS dengan bidan sesi asalnya", async () => {
    // Uangnya sudah dibayar untuk sesi yang batal; pengganti yang lahir
    // 'belum' akan menagih klien untuk sesi yang sudah ia bayar.
    const { data: asal } = await admin
      .from("sessions")
      .insert({
        client_id: ANANDA, service_id: SVC, variant_id: VARIAN, partner_id: MITRA,
        tanggal: "2027-11-01", jam_mulai: "09:00",
        status: "dibatalkan_klien", status_bayar: "lunas",
        alamat: "Jl. Uji Kredit No. 4", alamat_lat: -7.9666, alamat_lon: 112.6966,
      })
      .select("id")
      .single<{ id: string }>();
    catatSesi(asal!.id);

    const { data: hak } = await admin
      .from("hak_sesi")
      .insert({
        client_id: ANANDA, service_id: SVC,
        kedaluwarsa: "2099-12-31", sesi_asal_id: asal!.id,
      })
      .select("id")
      .single<{ id: string }>();

    const sesi = await signInAs("ananda@padma.test");
    const { data: baru, error } = await sesi.rpc("tukar_hak_sesi", {
      hak_id: hak!.id,
      tanggal_baru: "2027-11-20",
      jam_baru: "10:00",
      mitra: MITRA,
    });
    expect(error).toBeNull();
    catatSesi(baru);

    const { data: s } = await admin
      .from("sessions")
      .select("status, status_bayar, partner_id, alamat")
      .eq("id", baru)
      .single();
    expect(s!.status).toBe("terjadwal");
    expect(s!.status_bayar).toBe("lunas");
    expect(s!.partner_id).toBe(MITRA);
    expect(s!.alamat, "alamat diwarisi dari sesi asal").toBe("Jl. Uji Kredit No. 4");
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan GAGAL**

Run: `npx vitest run tests/passport-kredit.test.ts`
Expected: FAIL — berkas `src/app/passport/kredit/aksi.ts` belum ada.

- [ ] **Step 3: Tulis server action-nya**

Buat `web/src/app/passport/kredit/aksi.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

type Hasil = { ok: true; pesan: string } | { ok: false; pesan: string };

/**
 * MENUKAR KREDIT MENJADI SESI (spec C3 P3, P8).
 *
 * BIDANNYA DIWARISI dari sesi yang batal, tidak dipilih klien. Hubungan
 * klien–bidan sudah terbentuk, dan memilih ulang orang yang akan masuk ke
 * rumah seseorang bukan akibat wajar dari menukar kredit. Panel admin memang
 * punya medan bidan — itu untuk kasus yang bidan aslinya sudah tidak tersedia,
 * dan kasus seperti itu memang milik manusia.
 *
 * Seluruh pagar — kepemilikan, keterpakaian, kedaluwarsa, keanggotaan jam
 * layanan, bentrok bidan, waktu minimal 2 jam dari sekarang — hidup DI DALAM
 * `tukar_hak_sesi`. Yang ada di sini hanyalah menemukan bidannya dan
 * menerjemahkan kegagalan menjadi kalimat.
 */
export async function tukarKreditKlien(formData: FormData): Promise<Hasil> {
  const supabase = await createServerSupabase();
  const hakId = String(formData.get("hak") ?? "");

  // Bidan dicari dari sesi ASAL hak ini, dengan sesi pengguna: RLS yang
  // memutuskan hak dan sesi siapa yang terlihat, bukan perbandingan di sini.
  const { data: hak } = await supabase
    .from("hak_sesi")
    .select("id, sesi_asal_id")
    .eq("id", hakId)
    .maybeSingle<{ id: string; sesi_asal_id: string | null }>();

  if (!hak?.sesi_asal_id) {
    // Hak tanpa sesi asal tidak punya bidan yang bisa diwarisi — dan menebak
    // bidan mana pun berarti mengirim orang asing ke rumah klien.
    return {
      ok: false,
      pesan: "Kredit ini perlu dijadwalkan tim PADMA. Hubungi kami lewat WhatsApp.",
    };
  }

  const { data: asal } = await supabase
    .from("sessions")
    .select("partner_id")
    .eq("id", hak.sesi_asal_id)
    .maybeSingle<{ partner_id: string }>();

  if (!asal?.partner_id) {
    return {
      ok: false,
      pesan: "Kredit ini perlu dijadwalkan tim PADMA. Hubungi kami lewat WhatsApp.",
    };
  }

  const { data, error } = await supabase.rpc("tukar_hak_sesi", {
    hak_id: hakId,
    tanggal_baru: String(formData.get("tanggal") ?? ""),
    jam_baru: String(formData.get("jam") ?? ""),
    mitra: asal.partner_id,
  });

  if (error) {
    if (error.message.includes("kedaluwarsa")) {
      return { ok: false, pesan: "Kredit ini sudah lewat masa berlakunya." };
    }
    if (error.message.includes("jam layanan")) {
      return { ok: false, pesan: "Jam itu di luar jam layanan klinik." };
    }
    if (error.message.includes("bidan sudah punya jadwal")) {
      return { ok: false, pesan: "Bidan Anda sudah punya jadwal pada waktu itu. Pilih waktu lain." };
    }
    if (error.message.includes("terlalu dekat")) {
      return { ok: false, pesan: "Pilih waktu minimal 2 jam dari sekarang." };
    }
    return { ok: false, pesan: "Tidak bisa diproses. Coba lagi, atau hubungi tim PADMA." };
  }

  // NULL, bukan galat: haknya sudah ditukar penukaran lain — tab kedua, atau
  // admin yang mendahului. Melaporkannya berhasil membuat klien menutup layar
  // yakin sesi penggantinya sudah ada.
  if (data === null) {
    return { ok: false, pesan: "Kredit ini sudah dipakai. Muat ulang halamannya." };
  }

  revalidatePath("/passport/kredit");
  revalidatePath("/passport/sesi");
  revalidatePath("/passport");
  return { ok: true, pesan: "Kredit Anda sudah menjadi kunjungan terjadwal." };
}
```

- [ ] **Step 4: Tulis kartu & halamannya**

Buat `web/src/app/passport/kredit/kartu-kredit.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { tukarKreditKlien } from "./aksi";

/**
 * SATU KREDIT beserta formulir penukarannya (spec C3 P3).
 *
 * TIDAK ADA medan bidan, dan itu disengaja (spec P8): bidannya diwarisi dari
 * sesi yang batal. Tidak ada nominal juga, dan itu struktural — `hak_sesi`
 * memang tidak punya kolom uang sama sekali. Kredit di PADMA berbentuk HAK
 * SATU SESI untuk layanan yang sama, bukan saldo.
 */
export function KartuKredit({
  hakId,
  namaLayanan,
  kedaluwarsa,
  jamPilihan,
}: {
  hakId: string;
  namaLayanan: string;
  /** Sudah diformat di server. */
  kedaluwarsa: string;
  jamPilihan: string[];
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [buka, setBuka] = useState(false);

  return (
    <article className="mb-3.5 rounded-2xl border-[1.6px] border-dashed border-gold bg-[#FDFAF1] p-4">
      <b className="block text-sm text-night">{namaLayanan}</b>
      <span className="block text-[12px] text-ink-soft">Berlaku sampai {kedaluwarsa}</span>

      {pesan ? (
        <p className="mt-2 text-[12.5px] font-semibold text-ink">{pesan}</p>
      ) : !buka ? (
        <button
          type="button"
          onClick={() => setBuka(true)}
          className="mt-3 block w-full rounded-xl bg-night px-4 py-3 text-[13px] font-bold text-paper"
        >
          Pakai kredit ini
        </button>
      ) : (
        <form
          action={(fd) =>
            mulai(async () => {
              fd.set("hak", hakId);
              const hasil = await tukarKreditKlien(fd);
              setPesan(hasil.pesan);
            })
          }
          className="mt-3 grid gap-2"
        >
          <label className="block text-[12.5px] font-semibold text-ink-soft">
            Tanggal
            <input
              type="date"
              name="tanggal"
              required
              className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5 text-[13px]"
            />
          </label>
          <label className="block text-[12.5px] font-semibold text-ink-soft">
            Jam
            {/* Pilihan, bukan medan waktu bebas — basis data menuntut
                keanggotaan `app_settings.jam_layanan`. */}
            <select
              name="jam"
              required
              defaultValue=""
              className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5 text-[13px]"
            >
              <option value="" disabled>
                Pilih jam…
              </option>
              {jamPilihan.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </label>
          <span className="text-[11.5px] leading-relaxed text-ink-soft">
            Bidan yang datang tetap sama dengan kunjungan Anda sebelumnya.
          </span>
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-night px-4 py-3 text-[13px] font-bold text-paper disabled:opacity-60"
          >
            {pending ? "Memproses…" : "Jadwalkan"}
          </button>
        </form>
      )}
    </article>
  );
}
```

Buat `web/src/app/passport/kredit/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { ambilKlien } from "@/lib/passport/data";
import { hakBerlakuKlien } from "@/lib/pembatalan/hak";
import { hariIniJakarta, formatTanggalID } from "@/lib/passport/waktu";
import { bacaPengaturan } from "@/lib/settings";
import { KartuKredit } from "./kartu-kredit";

export const metadata = { title: "Kredit" };

// Sama seperti rute passport lain: dilarang mengekspor pengaturan revalidasi
// Next.js (ditulis tanpa mengeja bentuknya, karena tests/passport-shell.test.ts
// memindai sumber berkas ini apa adanya) — pengaturan itu menghapus `private`
// dari Cache-Control sehingga kredit satu klien boleh disimpan CDN dan
// disajikan ke klien lain.

/**
 * KREDIT LAYANAN MILIK KLIEN (spec C3 P3).
 *
 * Sampai C3-a, kredit yang terbit tidak punya satu pun layar: klien yang
 * membatalkan di jendela 2–24 jam menerima hak yang tidak ada tombolnya.
 * Halaman ini tombolnya.
 *
 * `hariIniJakarta()` dioper sebagai argumen, bukan dibaca di dalam pembacanya:
 * Vercel berjalan UTC sementara klinik hidup di WIB, dan membaca jam sistem di
 * sana akan menyembunyikan kredit yang sebenarnya masih berlaku selama tujuh
 * jam setiap hari — kredit yang tidak muncul di layar adalah kredit yang
 * hangus tanpa satu pun galat.
 */
export default async function HalamanKredit() {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  const [hak, pengaturan] = await Promise.all([
    hakBerlakuKlien(klien.id, hariIniJakarta()),
    bacaPengaturan(),
  ]);
  // Sudah berupa string[]: `bacaPengaturan()` yang menguraikannya.
  const jamPilihan = pengaturan.jamLayanan;

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-6">
      <h1 className="mb-1 font-serif text-xl text-night">Kredit layanan</h1>
      <p className="mb-4 text-[12.5px] leading-relaxed text-ink-soft">
        Terbit ketika sebuah kunjungan dibatalkan 2–24 jam sebelum jadwalnya. Berlaku untuk
        layanan yang sama, 30 hari sejak tanggal kunjungan yang batal.
      </p>

      {hak.length === 0 ? (
        <p className="text-[13px] italic text-ink-soft">
          Anda belum punya kredit layanan.
        </p>
      ) : (
        hak.map((h) => (
          <KartuKredit
            key={h.id}
            hakId={h.id}
            namaLayanan={h.namaLayanan}
            kedaluwarsa={formatTanggalID(h.kedaluwarsa)}
            jamPilihan={jamPilihan}
          />
        ))
      )}
    </section>
  );
}
```

- [ ] **Step 5: Daftarkan rutenya**

1. Di `web/src/app/passport/nav.tsx`, tambahkan entri `/passport/kredit` berlabel `Kredit`, mengikuti bentuk entri yang sudah ada di berkas itu (baca dulu — jangan menebak bentuk objeknya).
2. Di `web/README.md`, tambahkan barisnya ke tabel rute. `tests/inventaris-rute.test.ts` memeriksa dua arah: rute tanpa baris DAN baris tanpa rute sama-sama merah.

- [ ] **Step 6: Jalankan uji**

Run: `npx vitest run tests/passport-kredit.test.ts tests/inventaris-rute.test.ts tests/passport-shell.test.ts tests/jejak-yatim.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS semua; `tsc` bersih kecuali `LayoutProps`.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/passport/kredit web/src/app/passport/nav.tsx web/README.md \
        web/tests/passport-kredit.test.ts
git commit -m "feat(passport): kredit layanan akhirnya punya layarnya sendiri

Sampai sekarang klien yang membatalkan di jendela 2-24 jam menerima hak yang
tidak ada tombolnya. Bidannya diwarisi dari sesi yang batal, tidak dipilih
klien: mengganti orang yang akan masuk ke rumah seseorang bukan akibat wajar
dari menukar kredit."
```

---

## Task 6: E2E jalur penuh, pemeriksaan menyeluruh, catatan

**Files:**
- Create: `web/tests/e2e/pembatalan-klien.e2e.ts`
- Modify: `web/package.json` (skrip `test:e2e:batal` dan `test:e2e:semua`)
- Create: `docs/superpowers/2026-09-11-c3b-tindak-lanjut.md`

**Interfaces:**
- Consumes: seluruh permukaan Task 1–5.

- [ ] **Step 1: Tulis skrip E2E**

Buat `web/tests/e2e/pembatalan-klien.e2e.ts`, mengikuti bentuk `web/tests/e2e/bayar-pengajuan.e2e.ts` — **baca berkas itu lebih dulu** untuk pola `login()`, `catat()`, `teksTerlihat()`, dan struktur `keadaanAwal()`/`bersihkan()`.

Yang wajib dibuktikan lewat peramban sungguhan, karena tidak satu pun bisa dibuktikan dari unit test:

1. Klien membuka `/passport/sesi/<id>` untuk sesi ±48 jam lagi → kartunya menyebut **jenjang 1** dan kalimat "dikembalikan penuh".
2. Klien menggeser jadwal lewat formulir → barisnya benar-benar **pindah tanggal**, statusnya tetap `terjadwal`, dan `jadwal_ulang_terpakai` tetap `false` (jenjang 1 tidak memakai jatah).
3. Sesi digeser ke ±6 jam lagi (lewat service role), klien memuat ulang → kartunya kini menyebut **jenjang 2** dan kalimat yang menyebut kredit.
4. Klien menggeser lagi → berhasil, dan `jadwal_ulang_terpakai` menjadi **true**.
5. Sesi dikembalikan ke jendela 2–24 jam, klien memuat ulang → kartunya menampilkan **tawaran jatah habis** yang menyebut kredit 30 hari, dan tombol "Geser jadwal" **tidak dirender**.
6. Klien membatalkan (dua ketukan) → status `dibatalkan_klien`, dan **tepat satu** baris `hak_sesi` terbit dengan `kedaluwarsa` = tanggal sesi + 30 hari.
7. Klien membuka `/passport/kredit` → kreditnya terlihat beserta tanggal kedaluwarsanya, dan **tidak ada** medan pilihan bidan di formulirnya.
8. Klien menukarnya → sesi baru lahir `terjadwal` + `lunas`, dengan **bidan yang sama** dan **alamat yang sama** seperti sesi asalnya.
9. Klien membatalkan sesi hasil tukar itu di jendela 2–24 jam → statusnya `dibatalkan_klien`, dan **tidak ada kredit kedua** yang terbit. Ini pembuktian rantai kredit yang berhenti, dan ia hanya bisa dilihat ujung-ke-ujung.
10. **Nol rupiah**: tidak ada `Rp` di seluruh halaman kredit, dan tidak ada kata "honor" di mana pun.

Pembersihannya WAJIB melacak id setiap sesi yang lahir — termasuk yang lahir dari RPC penukaran — dan menyapu `jejak_jadwal`, `jejak_status_bayar`, `hak_sesi`, lalu `sessions`. Skripnya harus idempoten: bersihkan di awal DAN di akhir.

- [ ] **Step 2: Daftarkan skripnya**

Di `web/package.json`: tambahkan `"test:e2e:batal": "tsx tests/e2e/pembatalan-klien.e2e.ts"` dan sambungkan ke `test:e2e:semua`.

- [ ] **Step 3: Jalankan E2E**

```bash
npm run dev   # di terminal terpisah, tunggu sampai siap
npm run test:e2e:batal
```
Expected: seluruh pemeriksaan lolos.

> **Bila `npm run test:e2e:bayar` kamu jalankan dan ia merah:** itu BUKAN regresi pekerjaan ini. Skrip itu sudah rusak sejak tab Permintaan dirombak — ia mencari tombol "Cari bidan" di dalam `[data-permintaan]`, sementara `data-permintaan` kini menempel pada `<tr>` dan tombolnya hidup di panel geser (lihat `docs/superpowers/2026-09-09-tagihan-email-katalog-tindak-lanjut.md` §G). Jangan memperbaikinya di sini; catat saja.

- [ ] **Step 4: Suite penuh, lint, build**

**Koordinasikan lebih dulu** — basis data lokal dipakai bersama sesi lain.

```bash
npx vitest run
npm run lint
npm run build
```
Ketiganya wajib bersih. Sesudah suite penuh, hitung ulang baris `sessions` dengan service role dan pastikan kembali ke jumlah seed (8) — bila bertambah, ada berkas uji yang bocor dan itu akan memerahkan berkas lain.

`npm run build` menjalankan `tsc` atas SELURUH repo termasuk `tests/`, jadi galat tipe di berkas uji menggagalkan build walau `npx tsc --noEmit` yang disaring ke `src/` terlihat bersih.

- [ ] **Step 5: Tulis catatan tindak lanjut**

Buat `docs/superpowers/2026-09-11-c3b-tindak-lanjut.md`, mengikuti bentuk `docs/superpowers/2026-09-09-c3a-tindak-lanjut.md` — **baca berkas itu lebih dulu**. Setiap poin menyebut ALASANNYA. Wajib memuat:

1. Apa yang kini bisa dilakukan klien sendiri, dan apa yang TETAP hanya bisa dilakukan admin (darurat, memilih bidan lain, kredit tanpa sesi asal) — beserta alasan tiap pembatasan.
2. Rantai kredit berhenti setelah satu putaran: bagaimana ia ditegakkan **tanpa kolom baru** (`hak_sesi.dipakai_sesi_id` dicari balik), dan mengapa menambah kolom kedua yang menyatakan hal sama akan melahirkan dua sumber yang suatu hari berselisih.
3. `kredit_habis` sengaja BUKAN `hangus`: keduanya berarti klien tidak menerima apa pun, tetapi sebabnya berbeda, dan layar yang menyebut sebab yang salah membuat klien mengira dirinya dihukum atas waktu.
4. `oleh` dan `darurat` dikunci sebagai literal di server action klien — apa yang bisa terjadi bila keduanya datang dari `FormData`.
5. Tanda tangan `jadwal_ulang_sesi` berubah dan yang lama **di-drop**: pemanggil yang lupa diperbarui gagal keras, bukan salah diam-diam.
6. Bahwa `test:e2e:bayar` masih merah karena sebab yang lahir sebelum pekerjaan ini, dan apa yang sebenarnya perlu diperbaiki di sana.
7. Yang menunggu **C3-c**: refund jenjang 1 & 4 masih hanya tercatat sebagai jejak — belum ada permintaan refund, rekening tujuan, maupun bukti transfer balik. Klien yang membatalkan H-3 hari membaca "dana dikembalikan penuh" dan sesudah itu tidak ada apa pun di sistem yang melacaknya.

- [ ] **Step 6: Commit**

```bash
git add web/tests/e2e/pembatalan-klien.e2e.ts web/package.json \
        docs/superpowers/2026-09-11-c3b-tindak-lanjut.md
git commit -m "test(e2e): corong pembatalan klien ujung ke ujung, dan catatan C3-b"
```

---

## Self-Review

**Cakupan spec.** P1 (jenjang diturunkan) → Task 3 `ringkasanUntukKlien`. P3 (kredit objek hak) → Task 5. P4 (jatah, jatah habis, rantai kredit) → Task 1 + Task 3 + Task 4. P5 (tanpa policy UPDATE baru; semua lewat RPC) → Task 2 (uji pagar) + Task 3. P7 (darurat, kini termasuk jadwal ulang) → Task 1. P8 (klien mengusulkan waktu, bidan dipertahankan) → Task 4 + Task 5.

**Di luar rencana ini, sesuai pemecahan spec:** refund berbukti, rekening tujuan, bukti transfer balik — seluruhnya C3-c.

**Konsistensi tipe.** `RingkasKlien` (Task 3) dipakai apa adanya di Task 4. `HakKlien` (Task 2) dipakai di Task 5. `Hasil` bernama sama di kedua berkas aksi dan berbentuk sama. `jadwalUlangTerpakai` dieja identik di `SesiRingkas` (Task 2), prop komponen (Task 4), dan argumen `ringkasanUntukKlien` (Task 3). Nilai `akibat` yang dikenali `KALIMAT_HASIL` (Task 3) — `refund`, `hak`, `kredit_habis`, `hangus` — cocok persis dengan yang dihasilkan `batalkan_sesi` sesudah Task 1.

**Satu hal yang sengaja TIDAK diperbaiki di sini:** `test:e2e:bayar` yang sudah merah sebelum pekerjaan ini. Memperbaikinya adalah pekerjaan tab Permintaan, dan mencampurnya ke sini akan membuat diff C3-b memuat perubahan yang tidak seorang pun minta.
