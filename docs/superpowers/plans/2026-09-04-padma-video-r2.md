# Rantai Video R2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengganti video berbasis URL penyedia dengan video yang tinggal di bucket R2 privat: admin mengunggah berkas langsung dari browser lewat presigned PUT, pasien menontonnya lewat presigned GET yang hanya diterbitkan sesudah RLS mengizinkan.

**Architecture:** Byte video tidak pernah menyentuh server PADMA. Server action menerbitkan presigned PUT yang **path, MIME, dan ukurannya terikat tanda tangan**; browser mengunggah langsung ke R2. Untuk menonton, route handler memeriksa hak lewat query ber-RLS memakai sesi pasien, baru sesudah barisnya kembali menerbitkan presigned GET 2 jam — dan URL itu tidak pernah masuk HTML, melainkan diambil komponen klien lalu dipasang lewat properti `video.src`.

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, Supabase (Postgres + RLS), Cloudflare R2 lewat `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-31-padma-materi-berkas-design.md` — §5 Video, §6 Video, §7 Video, §8, §11, §12, dan **amandemen §13b** (A-1 sampai A-6). Amandemen itu mengoreksi spec di tiga titik; baca lebih dulu.

---

## Global Constraints

Berlaku untuk **semua** task. Semuanya pelajaran yang sudah dibayar mahal di repo ini.

- **`Content-Type` dan `Content-Length` WAJIB ikut ditandatangani** (`signableHeaders: new Set(["content-type"])` plus `ContentLength` pada perintahnya). Tanpa yang pertama, presigned PUT untuk `video/mp4` menerima `text/html` dengan HTTP 200 — terbukti empiris di spike, dan MIME itulah yang masuk `material_videos.mime` lalu dipakai `<video>`.
- **Yang dipagari `ContentLength` adalah ukuran PERSIS, bukan maksimum.** Server memeriksa `byte <= MAKS_BYTE_VIDEO` **sebelum** menandatangani, lalu menandatangani angka itu apa adanya.
- **Path objek ditentukan SERVER**, tidak pernah dikirim browser. Browser yang memilih path adalah browser yang bisa menimpa video materi lain.
- **Presigned URL tidak pernah masuk log, pesan galat, HTML, maupun RSC payload.** Ia tautan unduhan; membocorkannya ke log berarti membocorkan videonya.
- **Presigned GET diterbitkan hanya SESUDAH query ber-RLS mengembalikan barisnya.** Service role menembus segala pagar, jadi urutan ini sama mengikatnya dengan pada route halaman e-book.
- **`materials.aktif` dievaluasi DI DALAM policy**, bukan hanya di query aplikasi. Policy yang ada sudah begitu — jangan menulis ulang tanpa mempertahankan syaratnya.
- **Nama policy dipertahankan PERSIS** saat menulis ulang. Policy bernama baru akan BERDAMPINGAN dengan yang lama (RLS meng-OR policy permisif) sehingga celahnya tetap terbuka tanpa satu pun error.
- **JANGAN mencabut atau memasang GRANT KOLOM.** Grant `material_videos` saat ini **tingkat tabel** (diverifikasi: `role_table_grants` memberi `authenticated` SELECT/INSERT/UPDATE tanpa batasan kolom, dan tidak ada DELETE), jadi kolom `mime` yang baru mewarisi haknya sendiri. Menambah grant kolom justru akan memecah `select *`.
- **Tabel baru lahir TANPA RLS** — tidak ada tabel baru di rencana ini, tetapi bila muncul, wajib `enable row level security` + `revoke all` + `grant` yang persis dibutuhkan.
- **PostgREST menjawab HTTP 200 + `[]` untuk UPDATE/DELETE yang ditolak RLS.** Setiap server action wajib `.select(...)` lalu memeriksa panjangnya.
- **Server action & route handler adalah endpoint mandiri.** `requireRole([...])` ditulis DI DALAM setiap action; route handler memeriksa sesinya sendiri.
- **Panel admin & passport WAJIB `createServerSupabase()`.** `createAdminSupabase()` (service role) hanya di titik yang disebut eksplisit task.
- **Semua tanggal berbentuk string.** `toISOString`, `setDate`, `getDay` DILARANG.
- **Money firewall:** tidak satu pun kolom baru boleh memuat kata `bayar|harga|honor|tarif|biaya|total|nominal|amount|price|fee|rate|cost|payment`.
- **Cap waktu migration ditulis MANUAL** dan harus lebih besar dari berkas terakhir. Berkas terakhir saat rencana ini ditulis: `20260903000000_kunci_paksa_aktor_penugasan.sql`.
- **Tes video hidup di berkas terpisah yang MELEWATKAN DIRINYA** bila kredensial R2 tidak ada (spec §11), supaya suite tetap hijau di mesin tanpa akun Cloudflare.
- Setelah setiap task: `npx tsc --noEmit`, `npx vitest run`, commit.

**Env yang dibutuhkan** (sudah ada di `web/.env.local`; di produksi dipasang di Vercel): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_VIDEO` (bernilai `padma`). Seluruhnya server-only — tidak satu pun ber-prefix `NEXT_PUBLIC_`.

---

## Struktur Berkas

| Berkas | Tanggung jawab |
|---|---|
| `web/supabase/migrations/20260904120000_materi_video_r2.sql` | `url` → `objek`, kolom `mime` ber-`check`, hapus baris URL penyedia yang lama |
| `web/src/lib/materi/video.ts` | Fungsi & konstanta MURNI: batas, MIME, penamaan objek, validasi |
| `web/src/lib/materi/moov.ts` | Fungsi MURNI: deteksi posisi atom `moov` pada MP4 |
| `web/src/lib/r2.ts` | Klien R2 & penerbit presigned URL. Server-only |
| `web/src/app/admin/materi/unggah-video.ts` | Server action: terbitkan presigned PUT, catat baris |
| `web/src/app/admin/materi/pengunggah-video.tsx` | Client component: pilih berkas → periksa → unggah → progres |
| `web/src/app/api/materi/[id]/video/route.ts` | Menerbitkan presigned GET sesudah RLS mengizinkan |
| `web/src/app/passport/materi/[id]/pemutar-video.tsx` | Pemutar pasien; `src` dipasang lewat properti, bukan atribut |
| `web/tests/materi-video-lib.test.ts` | Tes Task 2 |
| `web/tests/materi-moov.test.ts` | Tes Task 3 |
| `web/tests/materi-video-r2.test.ts` | Tes Task 4 — melewatkan diri tanpa kredensial |
| `web/tests/materi-video-aksi.test.ts` | Tes Task 5 |
| `web/tests/materi-video-skema.test.ts` | Tes Task 1 |
| `web/tests/materi-video-route.test.ts` | Tes Task 7 |
| `web/tests/e2e/materi-video.e2e.ts` | Tes Task 8 — melewatkan diri tanpa kredensial |

---

### Task 1: Model data — `objek` + `mime`

**Files:**
- Create: `web/supabase/migrations/20260904120000_materi_video_r2.sql`
- Create: `web/tests/materi-video-skema.test.ts`
- Modify: `web/supabase/seed.sql` (baris `material_videos`)

**Interfaces:**
- Consumes: tabel `public.material_videos(material_id, url, created_at)` yang sudah ada.
- Produces: `public.material_videos(material_id uuid pk, objek text not null, mime text not null check (mime in ('video/mp4','video/webm')), created_at timestamptz)`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `web/tests/materi-video-skema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";

describe("skema material_videos sesudah pindah ke R2", () => {
  it("punya kolom objek & mime, dan TIDAK punya url lagi", async () => {
    const kolom = await querySql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='material_videos'`,
    );
    const nama = kolom.map((k) => k.column_name);
    expect(nama).toContain("objek");
    expect(nama).toContain("mime");
    // `url` adalah nama yang BERBOHONG sesudah isinya jadi kunci objek —
    // membiarkannya hidup mengundang kode baru menuliskan URL ke sana lagi.
    expect(nama).not.toContain("url");
  });

  it("mime hanya menerima dua tipe yang benar-benar didukung <video>", async () => {
    const cek = await querySql<{ ada: boolean }>(
      `select count(*) > 0 as ada from pg_constraint
        where conrelid = 'public.material_videos'::regclass
          and contype = 'c' and pg_get_constraintdef(oid) ilike '%video/mp4%'
          and pg_get_constraintdef(oid) ilike '%video/webm%'`,
    );
    expect(cek[0].ada).toBe(true);
  });

  it("grant tetap TINGKAT TABEL, sehingga kolom mime ikut terbaca", async () => {
    // Repo ini pernah patah tiga kali karena grant kolom: mencabutnya membuat
    // `select *` gagal 42501, bukan menyembunyikan kolom. Asersi ini menjaga
    // agar penambahan `mime` tidak diam-diam mengubah bentuk grant.
    const g = await querySql<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_name='material_videos' and grantee='authenticated'
        order by privilege_type`,
    );
    const hak = g.map((x) => x.privilege_type);
    expect(hak).toContain("SELECT");
    expect(hak).toContain("INSERT");
    expect(hak).toContain("UPDATE");
    // DELETE sengaja TIDAK diberikan: pelepasan video hanya lewat RPC
    // `lepas_video_materi`, supaya radius ledakannya satu baris.
    expect(hak).not.toContain("DELETE");
  });

  it("kedua policy lama masih ada dengan NAMA yang sama", async () => {
    // Policy bernama baru akan BERDAMPINGAN dengan yang lama (RLS meng-OR
    // policy permisif), sehingga celah lama tetap terbuka tanpa satu pun error.
    const p = await querySql<{ policyname: string }>(
      `select policyname from pg_policies
        where schemaname='public' and tablename='material_videos'`,
    );
    const nama = p.map((x) => x.policyname);
    expect(nama).toContain("video: staf");
    expect(nama).toContain("video: klien dgn sesi selesai");
  });

  it("tidak menyisakan baris URL penyedia dari sebelum migrasi", async () => {
    // Baris lama memuat URL Vimeo/Cloudflare Stream, bukan kunci objek R2.
    // Membiarkannya berarti `punyaIsi` menjawab "berisi" untuk materi yang
    // objeknya tidak pernah ada — pasien mendapat pemutar yang tidak akan
    // pernah jalan sementara panel admin menyatakan materi itu siap.
    const sisa = await querySql<{ n: number }>(
      `select count(*)::int as n from public.material_videos
        where objek like 'http%'`,
    );
    expect(sisa[0].n).toBe(0);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/materi-video-skema.test.ts`
Expected: FAIL — test pertama gagal karena `objek` belum ada dan `url` masih ada.

- [ ] **Step 3: Tulis migration**

Buat `web/supabase/migrations/20260904120000_materi_video_r2.sql`:

```sql
-- Video pindah dari URL penyedia ke objek di bucket R2 privat.
--
-- Kenapa barisnya DIHAPUS lebih dulu, bukan dibiarkan: isinya URL Vimeo /
-- Cloudflare Stream, dan sesudah rename ia akan terbaca sebagai "kunci objek"
-- yang tidak pernah ada di R2. Akibatnya `punyaIsi()` menjawab "berisi",
-- panel admin menyatakan materi siap terbit, dan pasien mendapat pemutar yang
-- tidak akan pernah jalan — kegagalan yang tidak memerahkan apa pun. Produksi
-- belum punya satu baris pun, jadi yang terhapus hanyalah baris demo lokal.
delete from public.material_videos;

alter table public.material_videos rename column url to objek;

-- `mime` disimpan karena tanpa transkode berkas datang apa adanya: peramban
-- perlu diberi tahu tipenya. `check` menjaga agar hanya dua tipe yang
-- benar-benar didukung elemen <video> bisa masuk.
--
-- Grant `material_videos` bersifat TINGKAT TABEL (diverifikasi lewat
-- role_table_grants), sehingga kolom ini mewarisi haknya sendiri. JANGAN
-- menambahkan grant kolom di sini: di repo ini grant kolom sudah tiga kali
-- membuat `select *` gagal 42501 alih-alih menyembunyikan kolom.
alter table public.material_videos
  add column mime text not null default 'video/mp4'
  check (mime in ('video/mp4', 'video/webm'));

comment on column public.material_videos.objek is
  'Kunci objek di bucket R2 privat, BUKAN URL. Bentuk: {material_id}/{acak}.{ext}';
```

- [ ] **Step 4: Perbarui seed**

Di `web/supabase/seed.sql`, cari `insert into material_videos` dan ganti seluruh
pernyataannya dengan komentar berikut (tanpa insert):

```sql
-- Materi video demo sengaja TIDAK diberi baris `material_videos`, sehingga ia
-- tampil "Belum ada isi" di panel admin dan terkunci di passport.
--
-- Alternatifnya menyemai objek sungguhan ke R2 pada setiap `db reset`, yang
-- berarti setiap mesin dev menulis ke bucket bersama — tidak sepadan demi satu
-- materi demo. Konsekuensinya diterima sadar (spec §13b A-6): reader video
-- hanya bisa dicoba sesudah admin mengunggah video sungguhan.
```

- [ ] **Step 5: Reset DB & jalankan test, pastikan HIJAU**

Run: `cd web && npx supabase db reset && npx vitest run tests/materi-video-skema.test.ts`
Expected: PASS, 5 test.

- [ ] **Step 6: Perbaiki kode yang masih menyebut kolom lama**

Run: `cd web && grep -rn "material_videos" src/ tests/ supabase/ | grep -n "url" || echo "tidak ada sisa"`

Setiap kecocokan harus diperiksa dan diperbaiki agar memakai `objek`. Yang sudah
diketahui aman (hanya memilih `material_id`): `src/lib/passport/data.ts`,
`src/app/admin/materi/aksi.ts` fungsi `punyaIsi`. Kode yang menulis
`{ material_id, url }` di `aksi.ts` DIBIARKAN sampai Task 6 — Task 6 yang
membongkarnya, dan menyentuhnya sekarang memutus suite tanpa penggantinya siap.

Bila `npx vitest run` merah karena insert `url` itu, ubah **hanya** nama
kolomnya menjadi `objek` sebagai penambal sementara, dan catat di laporan bahwa
Task 6 yang membuangnya.

- [ ] **Step 7: Seluruh suite tetap hijau**

Run: `cd web && npx tsc --noEmit && npx vitest run`

- [ ] **Step 8: Commit**

```bash
git add web/supabase/migrations/20260904120000_materi_video_r2.sql \
        web/tests/materi-video-skema.test.ts web/supabase/seed.sql web/src
git commit -m "feat(video): material_videos menyimpan kunci objek R2, bukan URL penyedia"
```

---

### Task 2: Konstanta & fungsi murni video

**Files:**
- Create: `web/src/lib/materi/video.ts`
- Create: `web/tests/materi-video-lib.test.ts`

**Interfaces:**
- Consumes: tipe `Periksa<T>` dari `@/lib/materi/rasterisasi` (`{ ok: true; nilai: T } | { ok: false; pesan: string }`).
- Produces: `MAKS_BYTE_VIDEO: number`, `MIME_VIDEO: readonly ["video/mp4","video/webm"]`, `type MimeVideo`, `ekstensiDariMime(mime: string): "mp4" | "webm" | null`, `namaObjekVideo(materialId: string, mime: MimeVideo, acak: string): string`, `periksaBerkasVideo(mime: string, byte: number): Periksa<MimeVideo>`, `objekVideoSah(materialId: string, objek: string, mime: MimeVideo): boolean`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `web/tests/materi-video-lib.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  MAKS_BYTE_VIDEO, MIME_VIDEO, ekstensiDariMime, namaObjekVideo,
  periksaBerkasVideo, objekVideoSah,
} from "@/lib/materi/video";

const ID = "11111111-1111-1111-1111-111111111111";
const ACAK = "22222222-2222-2222-2222-222222222222";

describe("batas & tipe video", () => {
  it("batasnya 200 MB", () => {
    expect(MAKS_BYTE_VIDEO).toBe(200 * 1024 * 1024);
  });

  it("hanya dua MIME yang didukung", () => {
    expect([...MIME_VIDEO]).toEqual(["video/mp4", "video/webm"]);
  });

  it("menolak MIME lain, termasuk yang mirip", () => {
    for (const m of ["video/quicktime", "video/x-matroska", "text/html", ""]) {
      const r = periksaBerkasVideo(m, 1000);
      expect(r.ok).toBe(false);
    }
  });

  it("menolak berkas melebihi batas, dan pesannya memberi JALAN KELUAR", () => {
    // Tanpa transkode, admin harus mengompres sendiri berapa pun batasnya.
    // Pesan yang hanya menyebut angka meninggalkannya buntu.
    const r = periksaBerkasVideo("video/mp4", MAKS_BYTE_VIDEO + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.pesan).toContain("200");
      expect(r.pesan).toContain("720p");
    }
  });

  it("menolak berkas kosong", () => {
    expect(periksaBerkasVideo("video/mp4", 0).ok).toBe(false);
  });

  it("menerima berkas wajar dan mengembalikan MIME-nya", () => {
    const r = periksaBerkasVideo("video/webm", 5_000_000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.nilai).toBe("video/webm");
  });

  it("menerima berkas PERSIS sebesar batas", () => {
    expect(periksaBerkasVideo("video/mp4", MAKS_BYTE_VIDEO).ok).toBe(true);
  });
});

describe("penamaan objek video", () => {
  it("berbentuk {materialId}/{acak}.{ext}", () => {
    expect(namaObjekVideo(ID, "video/mp4", ACAK)).toBe(`${ID}/${ACAK}.mp4`);
    expect(namaObjekVideo(ID, "video/webm", ACAK)).toBe(`${ID}/${ACAK}.webm`);
  });

  it("ekstensi diturunkan dari MIME, bukan dari nama berkas admin", () => {
    // Nama berkas asli sering memuat hal yang tidak perlu ikut tersebar —
    // judul draf, nama orang, nomor revisi.
    expect(ekstensiDariMime("video/mp4")).toBe("mp4");
    expect(ekstensiDariMime("video/webm")).toBe("webm");
    expect(ekstensiDariMime("video/quicktime")).toBeNull();
  });
});

describe("keabsahan objek yang dicatat browser", () => {
  it("menerima objek yang bentuknya benar untuk materi itu", () => {
    expect(objekVideoSah(ID, `${ID}/${ACAK}.mp4`, "video/mp4")).toBe(true);
  });

  it("MENOLAK objek milik materi lain", () => {
    // Inilah yang mencegah browser mencatat objek video materi lain sebagai
    // miliknya sendiri — pagar yang sama seperti pada halaman e-book.
    const lain = "99999999-9999-9999-9999-999999999999";
    expect(objekVideoSah(ID, `${lain}/${ACAK}.mp4`, "video/mp4")).toBe(false);
  });

  it("MENOLAK ekstensi yang tidak cocok dengan MIME-nya", () => {
    expect(objekVideoSah(ID, `${ID}/${ACAK}.webm`, "video/mp4")).toBe(false);
  });

  it("MENOLAK path bersarang dan traversal", () => {
    expect(objekVideoSah(ID, `${ID}/sub/${ACAK}.mp4`, "video/mp4")).toBe(false);
    expect(objekVideoSah(ID, `${ID}/../${ACAK}.mp4`, "video/mp4")).toBe(false);
  });

  it("MENOLAK bagian acak yang bukan UUID", () => {
    expect(objekVideoSah(ID, `${ID}/tebakan.mp4`, "video/mp4")).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/materi-video-lib.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/materi/video"`.

- [ ] **Step 3: Tulis implementasinya**

Buat `web/src/lib/materi/video.ts`:

```ts
/**
 * Konstanta & fungsi MURNI rantai video.
 *
 * Sengaja tanpa I/O dan tanpa `@aws-sdk`: berkas ini diimpor server action,
 * client component, DAN Vitest. Yang menyentuh jaringan tinggal di `@/lib/r2`.
 */
import type { Periksa } from "./rasterisasi";

/**
 * Batas 200 MB, dan angkanya bukan soal kapasitas penyimpanan.
 *
 * Design ini menolak transkode (spec §14), jadi berkas yang diunggah admin
 * adalah berkas yang ditonton pasien. Video dari ponsel modern gampang
 * melewati 1 GB, yang berarti admin TETAP harus mengompres berapa pun batas
 * yang dipilih. Tugas batas ini karena itu bukan menampung berkas mentah,
 * melainkan menolak cepat dengan instruksi yang jelas — dan 200 MB menampung
 * ~15 menit pada 720p, di atas kebutuhan materi edukasi klinik, sementara satu
 * kegagalan unggah berbiaya menit alih-alih sejam.
 */
export const MAKS_BYTE_VIDEO = 200 * 1024 * 1024;

export const MIME_VIDEO = ["video/mp4", "video/webm"] as const;
export type MimeVideo = (typeof MIME_VIDEO)[number];

const EKSTENSI: Record<MimeVideo, "mp4" | "webm"> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};

/** UUID v4 apa pun versinya — yang dijaga bentuknya, bukan versinya. */
const POLA_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ekstensiDariMime(mime: string): "mp4" | "webm" | null {
  return (MIME_VIDEO as readonly string[]).includes(mime)
    ? EKSTENSI[mime as MimeVideo]
    : null;
}

/**
 * Nama objeknya ACAK, bukan nama berkas yang diunggah admin. Nama asli sering
 * memuat hal yang tidak perlu ikut tersebar — judul draf, nama orang, nomor
 * revisi — dan nama acak juga menutup kemungkinan menebak objek lain di bucket
 * yang sama.
 */
export function namaObjekVideo(
  materialId: string,
  mime: MimeVideo,
  acak: string,
): string {
  return `${materialId}/${acak}.${EKSTENSI[mime]}`;
}

export function periksaBerkasVideo(
  mime: string,
  byte: number,
): Periksa<MimeVideo> {
  if (ekstensiDariMime(mime) === null) {
    return { ok: false, pesan: "Video harus MP4 atau WebM." };
  }
  if (!Number.isFinite(byte) || byte <= 0) {
    return { ok: false, pesan: "Berkas video kosong." };
  }
  if (byte > MAKS_BYTE_VIDEO) {
    const mb = Math.round(MAKS_BYTE_VIDEO / (1024 * 1024));
    const punya = Math.round(byte / (1024 * 1024));
    return {
      ok: false,
      pesan:
        `Video ${punya} MB melebihi batas ${mb} MB. ` +
        `Ekspor ulang di 720p lalu unggah lagi.`,
    };
  }
  return { ok: true, nilai: mime as MimeVideo };
}

/**
 * Objek yang dicatat browser harus berbentuk objek yang KITA terbitkan.
 *
 * Bagian acaknya dibuat server dan tidak bisa dihitung ulang di sini, jadi yang
 * diperiksa adalah BENTUKNYA: materi yang sama, satu segmen, UUID, dan
 * ekstensi yang cocok dengan MIME-nya. Tanpa pagar ini, browser bisa mencatat
 * objek video materi lain sebagai miliknya.
 */
export function objekVideoSah(
  materialId: string,
  objek: string,
  mime: MimeVideo,
): boolean {
  const awalan = `${materialId}/`;
  if (!objek.startsWith(awalan)) return false;
  const sisa = objek.slice(awalan.length);
  if (sisa.includes("/")) return false;
  const titik = sisa.lastIndexOf(".");
  if (titik <= 0) return false;
  const acak = sisa.slice(0, titik);
  const ext = sisa.slice(titik + 1);
  return POLA_UUID.test(acak) && ext === EKSTENSI[mime];
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/materi-video-lib.test.ts`
Expected: PASS, 14 test.

- [ ] **Step 5: Seluruh suite & typecheck**

Run: `cd web && npx tsc --noEmit && npx vitest run`

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/materi/video.ts web/tests/materi-video-lib.test.ts
git commit -m "feat(video): konstanta & fungsi murni batas, penamaan, dan keabsahan objek"
```

---

### Task 3: Deteksi `moov` (faststart)

**Files:**
- Create: `web/src/lib/materi/moov.ts`
- Create: `web/tests/materi-moov.test.ts`

**Interfaces:**
- Consumes: tidak ada.
- Produces: `moovDiDepan(kepala: Uint8Array): boolean | null`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `web/tests/materi-moov.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { moovDiDepan } from "@/lib/materi/moov";

/** Menyusun satu box MP4: ukuran 4 byte big-endian + tipe 4 byte ASCII + isi. */
function box(tipe: string, isiByte: number): Uint8Array {
  const b = new Uint8Array(8 + isiByte);
  new DataView(b.buffer).setUint32(0, 8 + isiByte, false);
  for (let i = 0; i < 4; i++) b[4 + i] = tipe.charCodeAt(i);
  return b;
}
const gabung = (...p: Uint8Array[]) => {
  const total = p.reduce((n, x) => n + x.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const x of p) { out.set(x, o); o += x.length; }
  return out;
};

describe("deteksi posisi atom moov", () => {
  it("true bila moov datang sebelum mdat (faststart)", () => {
    expect(moovDiDepan(gabung(box("ftyp", 16), box("moov", 64), box("mdat", 99))))
      .toBe(true);
  });

  it("false bila mdat lebih dulu — pemutar harus mengunduh seluruh berkas", () => {
    expect(moovDiDepan(gabung(box("ftyp", 16), box("mdat", 200), box("moov", 64))))
      .toBe(false);
  });

  it("null bila potongan kepala habis sebelum keduanya ditemukan", () => {
    // Kita hanya membaca beberapa ratus KB pertama; berkas dengan banyak box
    // kecil di depan bisa belum menampakkan keduanya. Jawaban jujurnya
    // "tidak tahu", BUKAN "tidak faststart" — memperingatkan admin atas
    // ketidaktahuan kita sendiri adalah cara cepat membuat peringatan diabaikan.
    expect(moovDiDepan(gabung(box("ftyp", 16), box("free", 32)))).toBeNull();
  });

  it("null untuk data yang jelas bukan MP4", () => {
    expect(moovDiDepan(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(moovDiDepan(new Uint8Array(0))).toBeNull();
  });

  it("menangani box berukuran 64-bit (size == 1)", () => {
    // mdat besar memakai largesize 64-bit; salah membacanya membuat penelusuran
    // melompat ke tempat acak dan menghasilkan jawaban yang mengarang.
    const mdat64 = new Uint8Array(16 + 32);
    const dv = new DataView(mdat64.buffer);
    dv.setUint32(0, 1, false);
    for (let i = 0; i < 4; i++) mdat64[4 + i] = "mdat".charCodeAt(i);
    dv.setUint32(8, 0, false);
    dv.setUint32(12, 16 + 32, false);
    expect(moovDiDepan(gabung(box("ftyp", 8), mdat64, box("moov", 8)))).toBe(false);
  });

  it("null bila ukuran box mustahil, alih-alih berputar selamanya", () => {
    const rusak = new Uint8Array(16);
    new DataView(rusak.buffer).setUint32(0, 0, false); // size 0 = sampai EOF
    for (let i = 0; i < 4; i++) rusak[4 + i] = "free".charCodeAt(i);
    expect(moovDiDepan(rusak)).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/materi-moov.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/materi/moov"`.

- [ ] **Step 3: Tulis implementasinya**

Buat `web/src/lib/materi/moov.ts`:

```ts
/**
 * Deteksi posisi atom `moov` pada MP4. MURNI: Uint8Array masuk, jawaban keluar.
 *
 * Kenapa ini ada: design menolak transkode, jadi ini SATU-SATUNYA kesempatan
 * menangkap video yang `moov`-nya di belakang. Berkas semacam itu memaksa
 * peramban mengunduh seluruhnya sebelum frame pertama muncul — dan gejalanya
 * bagi pasien bukan galat, melainkan pemutar yang menggantung tanpa sebab.
 *
 * Admin DIPERINGATKAN, bukan diblokir (spec §6): videonya tetap bisa ditonton,
 * hanya lambat mulai, dan memblokirnya berarti menolak materi yang sah.
 */

/** Jawaban `null` berarti "tidak tahu" — bukan "tidak faststart". */
export function moovDiDepan(kepala: Uint8Array): boolean | null {
  if (kepala.length < 8) return null;
  const dv = new DataView(kepala.buffer, kepala.byteOffset, kepala.byteLength);

  let p = 0;
  while (p + 8 <= kepala.length) {
    const ukuran32 = dv.getUint32(p, false);
    const tipe = String.fromCharCode(
      kepala[p + 4], kepala[p + 5], kepala[p + 6], kepala[p + 7],
    );

    if (tipe === "moov") return true;
    if (tipe === "mdat") return false;

    let lompat: number;
    if (ukuran32 === 1) {
      // Largesize 64-bit. Kita hanya membaca 32 bit rendahnya: box yang lebih
      // besar dari 4 GB tidak mungkin muat di batas 200 MB kita, dan membaca
      // 32 bit tingginya hanya menambah jalur yang tak pernah terpakai.
      if (p + 16 > kepala.length) return null;
      lompat = dv.getUint32(p + 12, false);
      if (lompat < 16) return null;
    } else if (ukuran32 === 0) {
      // "Sampai akhir berkas" — tidak ada box lain sesudahnya yang bisa kita
      // periksa, jadi jawabannya tidak diketahui.
      return null;
    } else if (ukuran32 < 8) {
      // Ukuran mustahil. Berhenti alih-alih melangkah mundur atau diam.
      return null;
    } else {
      lompat = ukuran32;
    }
    p += lompat;
  }
  return null;
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/materi-moov.test.ts`
Expected: PASS, 6 test.

- [ ] **Step 5: Buktikan lolos-mutasi**

Ubah sementara `if (tipe === "mdat") return false;` menjadi `return null;` lalu
jalankan ulang berkas tesnya. Test "false bila mdat lebih dulu" **harus MERAH**.
Kembalikan dan pastikan hijau lagi. Laporkan keluaran kedua keadaan.

- [ ] **Step 6: Seluruh suite & typecheck**

Run: `cd web && npx tsc --noEmit && npx vitest run`

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/materi/moov.ts web/tests/materi-moov.test.ts
git commit -m "feat(video): deteksi faststart moov, dengan 'tidak tahu' sebagai jawaban sah"
```

---

### Task 4: Klien R2 & penerbit presigned URL

**Files:**
- Create: `web/src/lib/r2.ts`
- Create: `web/tests/materi-video-r2.test.ts`
- Modify: `web/package.json` (tambah `@aws-sdk/s3-request-presigner`; `@aws-sdk/client-s3` sudah ada)

**Interfaces:**
- Consumes: `MimeVideo`, `MAKS_BYTE_VIDEO` dari `@/lib/materi/video`.
- Produces: `UMUR_TONTON_DETIK: number`, `bucketVideo(): string`, `urlUnggahVideo(objek: string, mime: MimeVideo, byte: number): Promise<string>`, `urlTontonVideo(objek: string): Promise<string>`, `hapusObjekVideo(objek: string): Promise<void>`.

- [ ] **Step 1: Pasang dependensi**

```bash
cd web && npm install @aws-sdk/s3-request-presigner
```

- [ ] **Step 2: Tulis test yang gagal**

Buat `web/tests/materi-video-r2.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import {
  urlUnggahVideo, urlTontonVideo, hapusObjekVideo, UMUR_TONTON_DETIK,
} from "@/lib/r2";
import { namaObjekVideo } from "@/lib/materi/video";

// Spec §11: video dipisahkan ke berkas yang MELEWATKAN DIRINYA bila kredensial
// R2 tidak ada, supaya suite tetap jalan di mesin tanpa akun Cloudflare.
const punyaKredensial =
  Boolean(process.env.R2_ACCOUNT_ID) &&
  Boolean(process.env.R2_ACCESS_KEY_ID) &&
  Boolean(process.env.R2_SECRET_ACCESS_KEY) &&
  Boolean(process.env.R2_BUCKET_VIDEO);

const jalankan = punyaKredensial ? describe : describe.skip;

const ID = randomUUID();
const OBJEK = namaObjekVideo(ID, "video/mp4", randomUUID());
const ISI = new Uint8Array(2048).fill(7);

jalankan("presigned URL R2", () => {
  afterAll(async () => {
    if (punyaKredensial) await hapusObjekVideo(OBJEK).catch(() => {});
  });

  it("PUT presigned menerima MIME & ukuran yang benar", async () => {
    const url = await urlUnggahVideo(OBJEK, "video/mp4", ISI.length);
    const r = await fetch(url, {
      method: "PUT", body: ISI, headers: { "content-type": "video/mp4" },
    });
    expect(r.status).toBe(200);
  });

  it("MENOLAK MIME yang berbeda dari yang ditandatangani", async () => {
    // Tanpa signableHeaders, R2 menerima ini dengan HTTP 200 — terbukti di
    // spike. MIME inilah yang masuk material_videos.mime lalu dipakai <video>.
    const url = await urlUnggahVideo(OBJEK, "video/mp4", ISI.length);
    const r = await fetch(url, {
      method: "PUT", body: ISI, headers: { "content-type": "text/html" },
    });
    expect(r.ok).toBe(false);
  });

  it("MENOLAK ukuran yang berbeda dari yang ditandatangani", async () => {
    const url = await urlUnggahVideo(OBJEK, "video/mp4", ISI.length);
    const r = await fetch(url, {
      method: "PUT", body: new Uint8Array(ISI.length + 1),
      headers: { "content-type": "video/mp4" },
    });
    expect(r.ok).toBe(false);
  });

  it("MENOLAK penulisan ke path lain dengan tanda tangan yang sama", async () => {
    const url = await urlUnggahVideo(OBJEK, "video/mp4", ISI.length);
    const curian = new URL(url);
    curian.pathname = curian.pathname.replace(/[^/]+$/, "curian.mp4");
    const r = await fetch(curian, {
      method: "PUT", body: ISI, headers: { "content-type": "video/mp4" },
    });
    expect(r.ok).toBe(false);
  });

  it("GET presigned mengembalikan byte yang sama dan menghormati Range", async () => {
    await fetch(await urlUnggahVideo(OBJEK, "video/mp4", ISI.length), {
      method: "PUT", body: ISI, headers: { "content-type": "video/mp4" },
    });
    const url = await urlTontonVideo(OBJEK);
    const penuh = await fetch(url);
    expect(penuh.status).toBe(200);
    expect((await penuh.arrayBuffer()).byteLength).toBe(ISI.length);

    // Seek video bergantung pada Range; tanpa 206 pemutar hanya bisa memutar
    // dari awal.
    const sebagian = await fetch(url, { headers: { range: "bytes=10-109" } });
    expect(sebagian.status).toBe(206);
    expect((await sebagian.arrayBuffer()).byteLength).toBe(100);
  });

  it("objek TIDAK bisa diambil tanpa tanda tangan", async () => {
    const url = new URL(await urlTontonVideo(OBJEK));
    const telanjang = `${url.origin}${url.pathname}`;
    const r = await fetch(telanjang);
    expect(r.ok).toBe(false);
  });

  it("umur URL tonton 2 jam, sesuai spec §7", () => {
    expect(UMUR_TONTON_DETIK).toBe(2 * 60 * 60);
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/materi-video-r2.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/r2"`.

- [ ] **Step 4: Tulis implementasinya**

Buat `web/src/lib/r2.ts`:

```ts
import "server-only";
import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { MimeVideo } from "./materi/video";

/**
 * Umur presigned URL tonton: 2 jam (spec §7).
 *
 * Kompromi dua arahnya perlu disebut terbuka. Terlalu pendek, URL kedaluwarsa
 * di tengah tontonan dan pemutar berhenti tanpa sebab yang jelas bagi pasien,
 * terutama bila ia mem-pause lama. Terlalu panjang, URL yang tersebar bisa
 * dipakai siapa pun selama sisa umurnya.
 */
export const UMUR_TONTON_DETIK = 2 * 60 * 60;

/** Umur URL unggah: cukup untuk satu unggahan 200 MB di koneksi lambat. */
const UMUR_UNGGAH_DETIK = 60 * 60;

function wajib(nama: string): string {
  const nilai = process.env[nama];
  if (!nilai) throw new Error(`Env ${nama} belum dipasang.`);
  return nilai;
}

export function bucketVideo(): string {
  return wajib("R2_BUCKET_VIDEO");
}

function klien(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${wajib("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: wajib("R2_ACCESS_KEY_ID"),
      secretAccessKey: wajib("R2_SECRET_ACCESS_KEY"),
    },
  });
}

/**
 * Presigned PUT yang MENGIKAT path, MIME, dan ukuran.
 *
 * `signableHeaders` bukan hiasan: tanpa `content-type` di dalamnya, tanda
 * tangan hanya mengikat `host`, dan R2 menerima unggahan ber-MIME apa pun
 * dengan HTTP 200 — terbukti empiris di spike (§13b A-1). MIME itulah yang
 * kelak masuk `material_videos.mime` dan dipakai elemen <video>.
 *
 * `ContentLength` memagari ukuran PERSIS, bukan maksimum: R2 menolak badan
 * yang lebih besar MAUPUN lebih kecil. Pemeriksaan "≤ 200 MB" karena itu harus
 * dilakukan pemanggil SEBELUM memanggil fungsi ini.
 */
export async function urlUnggahVideo(
  objek: string,
  mime: MimeVideo,
  byte: number,
): Promise<string> {
  return getSignedUrl(
    klien(),
    new PutObjectCommand({
      Bucket: bucketVideo(), Key: objek, ContentType: mime, ContentLength: byte,
    }),
    { expiresIn: UMUR_UNGGAH_DETIK, signableHeaders: new Set(["content-type"]) },
  );
}

export async function urlTontonVideo(objek: string): Promise<string> {
  return getSignedUrl(
    klien(),
    new GetObjectCommand({ Bucket: bucketVideo(), Key: objek }),
    { expiresIn: UMUR_TONTON_DETIK },
  );
}

export async function hapusObjekVideo(objek: string): Promise<void> {
  await klien().send(
    new DeleteObjectCommand({ Bucket: bucketVideo(), Key: objek }),
  );
}
```

- [ ] **Step 5: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/materi-video-r2.test.ts`
Expected: PASS, 7 test (atau seluruh blok `skipped` bila `.env.local` tidak
memuat kredensial R2 — keduanya sah, dan laporan harus menyebut yang mana).

- [ ] **Step 6: Buktikan berkasnya benar-benar melewatkan diri**

Run: `cd web && R2_BUCKET_VIDEO= npx vitest run tests/materi-video-r2.test.ts`
Expected: seluruh blok `skipped`, exit 0. Ini yang dituntut spec §11 — tanpanya
suite akan merah di mesin tanpa akun Cloudflare.

- [ ] **Step 7: Seluruh suite & typecheck**

Run: `cd web && npx tsc --noEmit && npx vitest run`

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/r2.ts web/tests/materi-video-r2.test.ts \
        web/package.json web/package-lock.json
git commit -m "feat(video): presigned URL R2 yang mengikat path, MIME, dan ukuran"
```

---

### Task 5: Server action unggah video

**Files:**
- Create: `web/src/app/admin/materi/unggah-video.ts`
- Create: `web/tests/materi-video-aksi.test.ts`

**Interfaces:**
- Consumes: `periksaBerkasVideo`, `namaObjekVideo`, `objekVideoSah`, `MimeVideo` (Task 2); `urlUnggahVideo`, `hapusObjekVideo` (Task 4); `requireRole` dari `@/lib/auth/require-role`; `createServerSupabase` dari `@/lib/supabase/server`.
- Produces: `terbitkanUrlUnggahVideo(materiId: string, mime: string, byte: number): Promise<{ ok: true; url: string; objek: string; mime: MimeVideo } | { ok: false; pesan: string }>`, `catatVideoMateri(materiId: string, objek: string, mime: MimeVideo): Promise<{ ok: true; objekLamaTersisa: boolean } | { ok: false; pesan: string }>`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `web/tests/materi-video-aksi.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SUMBER = readFileSync("src/app/admin/materi/unggah-video.ts", "utf8");

/** Memotong sumber menjadi badan satu fungsi, supaya asersi tidak bisa lolos
 *  hanya karena string yang dicari muncul di fungsi TETANGGA. */
function badan(nama: string): string {
  const mulai = SUMBER.indexOf(`export async function ${nama}`);
  if (mulai < 0) throw new Error(`fungsi ${nama} tidak ditemukan`);
  const berikut = SUMBER.indexOf("\nexport async function ", mulai + 1);
  return SUMBER.slice(mulai, berikut < 0 ? SUMBER.length : berikut);
}

describe("pagar server action video", () => {
  it("KEDUA action memanggil requireRole sendiri", () => {
    // Server action adalah endpoint mandiri; layout tidak menjaganya.
    for (const f of ["terbitkanUrlUnggahVideo", "catatVideoMateri"]) {
      expect(badan(f)).toContain('requireRole(["admin", "owner"])');
    }
  });

  it("penerbitan URL memeriksa batas SEBELUM menandatangani", () => {
    // ContentLength memagari ukuran PERSIS, bukan maksimum — kalau urutannya
    // dibalik, tanda tangan untuk 900 MB tetap terbit dan batas 200 MB hanya
    // jadi hiasan di browser.
    const b = badan("terbitkanUrlUnggahVideo");
    const iPeriksa = b.indexOf("periksaBerkasVideo");
    const iTanda = b.indexOf("urlUnggahVideo");
    expect(iPeriksa).toBeGreaterThan(-1);
    expect(iTanda).toBeGreaterThan(iPeriksa);
  });

  it("nama objek dibuat SERVER, bukan diterima dari argumen", () => {
    const b = badan("terbitkanUrlUnggahVideo");
    expect(b).toContain("randomUUID()");
    expect(b).toContain("namaObjekVideo(");
  });

  it("pencatatan menolak objek yang bentuknya tidak sah", () => {
    expect(badan("catatVideoMateri")).toContain("objekVideoSah(");
  });

  it("pencatatan memeriksa panjang hasil .select()", () => {
    // PostgREST menjawab 200 + [] untuk tulisan yang ditolak RLS; melaporkan
    // "berhasil" tanpa memeriksa panjangnya adalah kebohongan senyap.
    const b = badan("catatVideoMateri");
    expect(b).toContain(".select(");
    expect(b).toMatch(/\.length\s*===\s*0|\.length\s*<\s*1|!data\?\.length/);
  });

  it("membersihkan objek LAMA sesudah baris diperbarui, bukan sebelumnya", () => {
    // Mengganti video meninggalkan objek lama di R2 selamanya bila tidak
    // dibersihkan — dan free tier hanya 10 GB. Urutannya mengikat: baris
    // diperbarui DULU. Bila dibalik dan pembaruan baris gagal, objeknya sudah
    // lenyap sementara baris lama masih menunjuknya — pasien mendapat pemutar
    // yang menunjuk objek yang tidak ada.
    const b = badan("catatVideoMateri");
    const iUpsert = b.indexOf(".upsert(");
    const iHapus = b.indexOf("hapusObjekVideo(");
    expect(iUpsert).toBeGreaterThan(-1);
    expect(iHapus).toBeGreaterThan(iUpsert);
  });

  it("TIDAK memakai service role di mana pun", () => {
    // Presigned URL diterbitkan hanya sesudah RLS mengizinkan; service role
    // menembus segala pagar.
    expect(SUMBER).not.toContain("createAdminSupabase");
  });

  it("tidak pernah mencetak URL presigned", () => {
    // URL presigned adalah tautan unduhan. Membocorkannya ke log berarti
    // membocorkan videonya ke siapa pun yang bisa membaca log.
    expect(SUMBER).not.toMatch(/console\.(log|error|warn)\s*\([^)]*url/i);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/materi-video-aksi.test.ts`
Expected: FAIL — `ENOENT` karena `unggah-video.ts` belum ada.

- [ ] **Step 3: Tulis implementasinya**

Buat `web/src/app/admin/materi/unggah-video.ts`:

```ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { urlUnggahVideo, hapusObjekVideo } from "@/lib/r2";
import {
  periksaBerkasVideo, namaObjekVideo, objekVideoSah, type MimeVideo,
} from "@/lib/materi/video";

type Gagal = { ok: false; pesan: string };

/**
 * Menerbitkan presigned PUT untuk satu video.
 *
 * Path objeknya ditentukan DI SINI, bukan dikirim browser — browser yang
 * memilih path adalah browser yang bisa menimpa video materi lain. Batasnya
 * juga diperiksa DI SINI sebelum menandatangani: `ContentLength` memagari
 * ukuran PERSIS, jadi menandatangani lebih dulu berarti membiarkan angka
 * berapa pun lolos.
 */
export async function terbitkanUrlUnggahVideo(
  materiId: string,
  mime: string,
  byte: number,
): Promise<{ ok: true; url: string; objek: string; mime: MimeVideo } | Gagal> {
  await requireRole(["admin", "owner"]);

  const periksa = periksaBerkasVideo(mime, byte);
  if (!periksa.ok) return { ok: false, pesan: periksa.pesan };

  // Materi harus ada, dan pemeriksaannya lewat sesi pengguna supaya RLS staf
  // yang memutuskan — bukan service role.
  const supabase = await createServerSupabase();
  const { data: materi } = await supabase
    .from("materials").select("id, tipe").eq("id", materiId).maybeSingle();
  if (!materi) return { ok: false, pesan: "Materi tidak ditemukan." };
  if (materi.tipe !== "video") {
    return { ok: false, pesan: "Materi ini bukan bertipe video." };
  }

  const objek = namaObjekVideo(materiId, periksa.nilai, randomUUID());
  try {
    const url = await urlUnggahVideo(objek, periksa.nilai, byte);
    return { ok: true, url, objek, mime: periksa.nilai };
  } catch {
    // Pesannya sengaja tidak membawa detail galat: galat SDK bisa memuat
    // endpoint dan bagian kredensial.
    return { ok: false, pesan: "Gagal menyiapkan unggahan video. Coba lagi." };
  }
}

/**
 * Mencatat objek video SESUDAH unggahannya sukses.
 *
 * Dipanggil hanya di akhir: bila unggahan gagal, fungsi ini tidak pernah jalan
 * dan materinya tampak "belum ada isi" di panel — bukan setengah terisi, yang
 * jauh lebih sulit disadari.
 */
export async function catatVideoMateri(
  materiId: string,
  objek: string,
  mime: MimeVideo,
): Promise<{ ok: true; objekLamaTersisa: boolean } | Gagal> {
  await requireRole(["admin", "owner"]);

  // Objek yang dicatat harus berbentuk objek yang KITA terbitkan.
  if (!objekVideoSah(materiId, objek, mime)) {
    return { ok: false, pesan: "Nama objek video tidak sah." };
  }

  const supabase = await createServerSupabase();

  // Objek lama dibaca SEBELUM ditimpa; sesudah upsert, nilainya sudah hilang
  // dan objeknya akan yatim di R2 selamanya. Free tier hanya 10 GB.
  const { data: lama } = await supabase
    .from("material_videos").select("objek").eq("material_id", materiId).maybeSingle();

  const { data, error } = await supabase
    .from("material_videos")
    .upsert({ material_id: materiId, objek, mime }, { onConflict: "material_id" })
    .select("material_id");

  if (error) return { ok: false, pesan: "Gagal menyimpan video materi." };
  // PostgREST menjawab 200 + [] untuk tulisan yang ditolak RLS.
  if (!data || data.length === 0) {
    return { ok: false, pesan: "Tidak berwenang menyimpan video materi ini." };
  }

  // Penghapusan objek lama terjadi SESUDAH barisnya benar-benar berubah.
  // Urutan sebaliknya membuat kegagalan di sini meninggalkan baris yang
  // menunjuk objek yang sudah lenyap — pasien mendapat pemutar yang tidak
  // pernah jalan. Dengan urutan ini, mode gagal terburuknya hanyalah satu
  // objek yatim, dan itu dilaporkan, bukan disembunyikan.
  let objekLamaTersisa = false;
  if (lama?.objek && lama.objek !== objek) {
    try {
      await hapusObjekVideo(lama.objek);
    } catch {
      objekLamaTersisa = true;
    }
  }

  revalidatePath("/admin/materi");
  return { ok: true, objekLamaTersisa };
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/materi-video-aksi.test.ts`
Expected: PASS, 8 test.

- [ ] **Step 5: Buktikan asersi urutan lolos-mutasi**

Pindahkan sementara pemanggilan `periksaBerkasVideo` ke BAWAH pemanggilan
`urlUnggahVideo`, jalankan ulang berkas tesnya, dan pastikan test "penerbitan
URL memeriksa batas SEBELUM menandatangani" **MERAH**. Kembalikan urutannya.

- [ ] **Step 6: Seluruh suite & typecheck**

Run: `cd web && npx tsc --noEmit && npx vitest run`

- [ ] **Step 7: Commit**

```bash
git add web/src/app/admin/materi/unggah-video.ts web/tests/materi-video-aksi.test.ts
git commit -m "feat(video): server action penerbit presigned PUT + pencatat objek"
```

---

### Task 6: Panel admin — pengunggah menggantikan medan URL

**Files:**
- Create: `web/src/app/admin/materi/pengunggah-video.tsx`
- Modify: `web/src/app/admin/materi/form-materi.tsx` (fungsi `MedanIsi`)
- Modify: `web/src/app/admin/materi/aksi.ts` (cabang `tipe === "video"` pada pendaftaran & penyuntingan)
- Modify: `web/src/app/admin/materi/status.ts` (buang `PENYEDIA_VIDEO`, `POLA_URL_VIDEO`, `periksaUrlVideo`)
- Modify: `web/tests/admin-materi.test.ts` (asersi yang menguji validasi URL video)

**Interfaces:**
- Consumes: `terbitkanUrlUnggahVideo`, `catatVideoMateri` (Task 5); `periksaBerkasVideo`, `MAKS_BYTE_VIDEO` (Task 2); `moovDiDepan` (Task 3).
- Produces: komponen `<PengunggahVideo materiId={string} />`.

- [ ] **Step 1: Tulis komponen pengunggah**

Buat `web/src/app/admin/materi/pengunggah-video.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { terbitkanUrlUnggahVideo, catatVideoMateri } from "./unggah-video";
import { periksaBerkasVideo, MAKS_BYTE_VIDEO } from "@/lib/materi/video";
import { moovDiDepan } from "@/lib/materi/moov";

/** Cukup untuk menampung ftyp + moov pada berkas faststart yang wajar. */
const BYTE_KEPALA = 512 * 1024;

type Keadaan =
  | { fase: "diam" }
  | { fase: "unggah"; persen: number }
  | { fase: "sukses" }
  | { fase: "gagal"; pesan: string };

export function PengunggahVideo({ materiId }: { materiId: string }) {
  const [keadaan, setKeadaan] = useState<Keadaan>({ fase: "diam" });
  const [peringatan, setPeringatan] = useState<string | null>(null);
  // Berkas DIPERTAHANKAN sesudah gagal supaya mengulang cukup satu klik, bukan
  // memilih ulang berkas 200 MB dari awal.
  const berkasRef = useRef<File | null>(null);

  async function jalankan(berkas: File) {
    berkasRef.current = berkas;
    setPeringatan(null);

    const periksa = periksaBerkasVideo(berkas.type, berkas.size);
    if (!periksa.ok) {
      setKeadaan({ fase: "gagal", pesan: periksa.pesan });
      return;
    }

    // Peringatan faststart, BUKAN blokir (spec §6): videonya tetap sah, hanya
    // lambat mulai. `null` berarti tidak diketahui — dan memperingatkan atas
    // ketidaktahuan kita sendiri adalah cara cepat membuat peringatan diabaikan.
    if (periksa.nilai === "video/mp4") {
      const kepala = new Uint8Array(
        await berkas.slice(0, BYTE_KEPALA).arrayBuffer(),
      );
      if (moovDiDepan(kepala) === false) {
        setPeringatan(
          "Video ini bukan 'faststart': pasien harus menunggu seluruh berkas " +
            "terunduh sebelum gambar pertama muncul. Videonya tetap bisa " +
            "diunggah — ekspor ulang dengan opsi faststart bila ingin cepat mulai.",
        );
      }
    }

    setKeadaan({ fase: "unggah", persen: 0 });
    const terbit = await terbitkanUrlUnggahVideo(
      materiId, periksa.nilai, berkas.size,
    );
    if (!terbit.ok) {
      setKeadaan({ fase: "gagal", pesan: terbit.pesan });
      return;
    }

    // XMLHttpRequest, bukan fetch: hanya XHR yang memberi progres unggah, dan
    // pada berkas 200 MB bilah progres adalah beda antara "sedang jalan" dan
    // "aplikasinya menggantung".
    const sukses = await new Promise<boolean>((selesai) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", terbit.url);
      xhr.setRequestHeader("Content-Type", terbit.mime);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setKeadaan({
            fase: "unggah",
            persen: Math.round((e.loaded / e.total) * 100),
          });
        }
      };
      xhr.onload = () => selesai(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => selesai(false);
      xhr.send(berkas);
    });

    if (!sukses) {
      setKeadaan({
        fase: "gagal",
        pesan: "Unggahan terputus. Berkasnya masih terpilih — coba lagi.",
      });
      return;
    }

    const catat = await catatVideoMateri(materiId, terbit.objek, terbit.mime);
    if (!catat.ok) {
      setKeadaan({ fase: "gagal", pesan: catat.pesan });
      return;
    }
    setKeadaan({ fase: "sukses" });
    if (catat.objekLamaTersisa) {
      // Lunak, tetapi tidak boleh senyap: objek yatim memakan kuota 10 GB dan
      // hanya bisa dibersihkan seseorang yang tahu ia ada.
      setPeringatan(
        "Video baru tersimpan, tetapi berkas video lama gagal dihapus dari " +
          "penyimpanan. Beri tahu tim teknis agar tidak menumpuk.",
      );
    }
  }

  return (
    <div className="mt-3">
      <input
        type="file"
        accept="video/mp4,video/webm"
        disabled={keadaan.fase === "unggah"}
        onChange={(e) => {
          const b = e.target.files?.[0];
          if (b) void jalankan(b);
        }}
      />
      <p className="mt-1 text-[11.5px] text-ink-soft">
        MP4 atau WebM, maksimal {Math.round(MAKS_BYTE_VIDEO / (1024 * 1024))} MB.
      </p>

      {peringatan !== null && (
        <p className="mt-2 text-[12px] text-amber-700">{peringatan}</p>
      )}
      {keadaan.fase === "unggah" && (
        <p className="mt-2 text-[12px]">Mengunggah… {keadaan.persen}%</p>
      )}
      {keadaan.fase === "sukses" && (
        <p className="mt-2 text-[12px] text-leaf">Video tersimpan.</p>
      )}
      {keadaan.fase === "gagal" && (
        <p className="mt-2 text-[12px] text-red-700">
          {keadaan.pesan}{" "}
          {berkasRef.current !== null && (
            <button
              type="button"
              className="underline"
              onClick={() => {
                const b = berkasRef.current;
                if (b) void jalankan(b);
              }}
            >
              Coba lagi
            </button>
          )}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Ganti medan URL pada formulir**

Di `web/src/app/admin/materi/form-materi.tsx`, ganti seluruh cabang
`if (tipe === "video")` di dalam `MedanIsi` dengan:

```tsx
  if (tipe === "video") {
    // Video kini berupa BERKAS yang diunggah ke R2, bukan URL penyedia — jadi
    // ia mengikuti pola e-book: unggahan butuh `materiId` yang sudah ada di
    // basis data, sehingga pada formulir "materi baru" ia belum bisa muncul.
    if (materiId === undefined) {
      return (
        <p className="mt-3 text-[12px] text-ink-soft">
          Simpan materi ini dulu, lalu unggah videonya lewat “Kelola isi”.
        </p>
      );
    }
    return <PengunggahVideo materiId={materiId} />;
  }
```

Tambahkan importnya di bagian atas berkas:

```tsx
import { PengunggahVideo } from "./pengunggah-video";
```

- [ ] **Step 3: Bongkar jalur URL di `aksi.ts`**

Di `web/src/app/admin/materi/aksi.ts`:

1. Hapus impor `periksaUrlVideo`.
2. Pada pendaftaran materi, hapus blok yang membaca `video_url` beserta
   variabel `videoUrl`, dan hapus seluruh blok `if (tipe.nilai === "video") { ...insert material_videos... }`. Materi video kini lahir **tanpa isi**, persis
   seperti e-book — dan panel sudah menandai materi tanpa isi sebagai "Belum
   ada isi".
3. Pada penyuntingan, hapus cabang yang mem-`upsert` `material_videos` dari
   `video_url`. Syarat "materi tidak boleh aktif tanpa isi" DIPERTAHANKAN:
   ganti pemeriksaannya menjadi `await punyaIsi(id, "video")` sehingga kedua
   tipe materi melewati pemeriksaan yang bentuknya sama.

- [ ] **Step 4: Buang validator URL yang sudah mati**

Di `web/src/app/admin/materi/status.ts`, hapus `PENYEDIA_VIDEO`,
`POLA_URL_VIDEO`, dan `periksaUrlVideo`. Biarkan `Periksa<T>` dan validator
lainnya apa adanya.

Run: `cd web && grep -rn "periksaUrlVideo\|PENYEDIA_VIDEO\|video_url" src/ tests/`
Expected: tidak ada kecocokan tersisa selain di berkas tes yang Anda perbarui di
Step 5.

- [ ] **Step 5: Perbarui tes yang menguji validasi URL**

Di `web/tests/admin-materi.test.ts`, hapus atau ganti setiap test yang memanggil
`periksaUrlVideo` atau mengirim `video_url`. Ganti dengan satu test yang
menuntut materi video **baru lahir tanpa isi**:

```ts
  it("materi video baru lahir TANPA isi dan karena itu nonaktif", async () => {
    // Video kini diunggah terpisah ke R2 sesudah materinya ada, jadi tidak ada
    // lagi jalur "materi video langsung berisi" saat pendaftaran.
    const id = await buatMateriVideo();          // helper yang sudah ada di berkas ini
    const isi = await querySql<{ n: number }>(
      `select count(*)::int as n from public.material_videos where material_id = '${id}'`,
    );
    expect(isi[0].n).toBe(0);
  });
```

Bila helper `buatMateriVideo()` belum ada di berkas itu, tulis dengan pola yang
sama seperti helper materi e-book yang sudah ada di sana.

- [ ] **Step 6: Seluruh suite & typecheck**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: hijau. Bila ada tes lain yang merah karena `video_url`, perbaiki
tesnya agar mengikuti alur baru — jangan mengembalikan jalur URL.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/admin/materi web/src/lib web/tests/admin-materi.test.ts
git commit -m "feat(video): panel admin mengunggah berkas ke R2, medan URL penyedia dibongkar"
```

---

### Task 7: Pemutar pasien

**Files:**
- Create: `web/src/app/api/materi/[id]/video/route.ts`
- Create: `web/src/app/passport/materi/[id]/pemutar-video.tsx`
- Modify: `web/src/app/passport/materi/[id]/page.tsx` (cabang `m.tipe === "video"`)
- Create: `web/tests/materi-video-route.test.ts`

**Interfaces:**
- Consumes: `urlTontonVideo` (Task 4).
- Produces: `GET /api/materi/[id]/video` → `200 {"url": string}` | `403` | `404`; komponen `<PemutarVideo materiId={string} />`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `web/tests/materi-video-route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ROUTE = readFileSync("src/app/api/materi/[id]/video/route.ts", "utf8");
const PEMUTAR = readFileSync(
  "src/app/passport/materi/[id]/pemutar-video.tsx", "utf8",
);

describe("route penerbit URL tonton", () => {
  it("berjalan di runtime Node, bukan Edge", () => {
    expect(ROUTE).toContain('export const runtime = "nodejs"');
  });

  it("memeriksa hak lewat sesi pengguna, BUKAN service role", () => {
    // Presigned URL menembus segala pagar begitu terbit; RLS-lah hakimnya.
    expect(ROUTE).toContain("createServerSupabase");
    expect(ROUTE).not.toContain("createAdminSupabase");
  });

  it("menerbitkan URL SESUDAH query hak, bukan sebelumnya", () => {
    const iQuery = ROUTE.indexOf("material_videos");
    const iTerbit = ROUTE.indexOf("urlTontonVideo");
    expect(iQuery).toBeGreaterThan(-1);
    expect(iTerbit).toBeGreaterThan(iQuery);
  });

  it("tidak pernah mencetak URL ke log", () => {
    expect(ROUTE).not.toMatch(/console\.(log|error|warn)/);
  });

  it("melarang cache pada jawabannya", () => {
    // Jawaban ini memuat tautan unduhan milik SATU pasien; ter-cache berarti
    // tersaji ke pasien lain.
    expect(ROUTE).toMatch(/no-store/);
  });
});

describe("pemutar pasien", () => {
  it("elemen <video> dirender TANPA atribut src", () => {
    // URL dipasang lewat PROPERTI sesudah halaman hidup, sehingga ia tidak
    // pernah muncul di view-source maupun di panel Elements DevTools.
    expect(PEMUTAR).not.toMatch(/<video[^>]*\ssrc=/);
    expect(PEMUTAR).toMatch(/\.src\s*=/);
  });

  it("memasang pengerasan pemutar yang disebut spec §7", () => {
    expect(PEMUTAR).toContain('controlsList="nodownload"');
    expect(PEMUTAR).toContain("disablePictureInPicture");
    // Klik-kanan ditutup karena Firefox & Safari mengabaikan controlsList —
    // tanpa ini pertahanan justru bocor tepat di dua peramban itu.
    expect(PEMUTAR).toMatch(/onContextMenu/);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/materi-video-route.test.ts`
Expected: FAIL — `ENOENT` karena kedua berkas belum ada.

- [ ] **Step 3: Tulis route handler**

Buat `web/src/app/api/materi/[id]/video/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { urlTontonVideo } from "@/lib/r2";

// `@aws-sdk` butuh Node, bukan Edge.
export const runtime = "nodejs";

/**
 * Menerbitkan presigned GET untuk satu video — HANYA bila RLS mengizinkan.
 *
 * Urutannya mengikat: query ber-RLS memakai sesi pasien dijalankan LEBIH DULU,
 * dan presigned URL baru dibuat sesudah barisnya kembali. Membalik urutan ini
 * berarti menerbitkan tautan unduhan sebelum tahu siapa yang meminta.
 *
 * URL-nya tidak pernah dirender ke HTML: ia diambil komponen klien sesudah
 * halaman hidup, sehingga tidak muncul di view-source (Ctrl+U) — jalur termudah
 * yang tersisa bagi pasien awam.
 */
export async function GET(
  _permintaan: Request,
  konteks: { params: Promise<{ id: string }> },
) {
  const { id } = await konteks.params;

  const supabase = await createServerSupabase();
  const { data: sesi } = await supabase.auth.getUser();
  if (!sesi.user) {
    return NextResponse.json({ pesan: "Tidak masuk." }, { status: 403 });
  }

  const { data: baris } = await supabase
    .from("material_videos")
    .select("objek, mime")
    .eq("material_id", id)
    .maybeSingle();

  // RLS mengembalikan nol baris untuk pasien tanpa hak. Dibedakan dari 404
  // hanya di sisi kita; jawabannya sama-sama menolak.
  if (!baris) {
    return NextResponse.json({ pesan: "Tidak tersedia." }, { status: 403 });
  }

  try {
    const url = await urlTontonVideo(baris.objek);
    return NextResponse.json(
      { url, mime: baris.mime },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ pesan: "Gagal menyiapkan video." }, { status: 500 });
  }
}
```

- [ ] **Step 4: Tulis komponen pemutar**

Buat `web/src/app/passport/materi/[id]/pemutar-video.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Pemutar video pasien.
 *
 * Elemen <video> dirender TANPA atribut `src`. URL-nya diambil sesudah halaman
 * hidup lalu dipasang lewat PROPERTI `video.src` — dan karena properti tidak
 * menulis balik ke DOM, ia tidak muncul di view-source maupun di panel Elements
 * DevTools. Ia hanya hidup di memori JS dan di tab Network.
 *
 * Pengerasan di bawah jujur disebut deterrent, bukan proteksi: pasien yang bisa
 * menonton juga bisa merekam layar. Yang dihalangi adalah pasien awam.
 */
export function PemutarVideo({ materiId }: { materiId: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [gagal, setGagal] = useState(false);

  useEffect(() => {
    let batal = false;
    void (async () => {
      const r = await fetch(`/api/materi/${materiId}/video`);
      if (!r.ok) {
        if (!batal) setGagal(true);
        return;
      }
      const { url } = (await r.json()) as { url: string };
      if (!batal && ref.current) ref.current.src = url;
    })();
    return () => { batal = true; };
  }, [materiId]);

  if (gagal) {
    return (
      <p className="text-[13px] text-ink-soft">
        Video ini belum bisa diputar. Muat ulang halaman, atau hubungi tim PADMA.
      </p>
    );
  }

  return (
    <video
      ref={ref}
      controls
      playsInline
      controlsList="nodownload"
      disablePictureInPicture
      onContextMenu={(e) => e.preventDefault()}
      className="aspect-video w-full rounded-xl bg-black [-webkit-touch-callout:none]"
    />
  );
}
```

- [ ] **Step 5: Pasang pemutar di halaman passport**

Di `web/src/app/passport/materi/[id]/page.tsx`, di dalam cabang
`if (m.tipe === "video")`, ganti blok placeholder (kotak dengan tombol ▶ palsu
dan kalimat "belum ada akun penyedia video") dengan:

```tsx
            <PemutarVideo materiId={m.id} />
```

Tambahkan importnya:

```tsx
import { PemutarVideo } from "./pemutar-video";
```

Lapisan `<Watermark nama={klien.nama} padmaId={klien.padmaId} />` di sekitarnya
DIPERTAHANKAN apa adanya — identitas pasien tetap tertumpuk di atas pemutar.

- [ ] **Step 6: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/materi-video-route.test.ts`
Expected: PASS, 7 test.

- [ ] **Step 7: Seluruh suite & typecheck**

Run: `cd web && npx tsc --noEmit && npx vitest run`

- [ ] **Step 8: Commit**

```bash
git add web/src/app/api/materi web/src/app/passport/materi \
        web/tests/materi-video-route.test.ts
git commit -m "feat(video): reader pasien memutar dari R2 lewat presigned GET yang digating RLS"
```

---

### Task 8: E2E rantai video

**Files:**
- Create: `web/tests/e2e/materi-video.e2e.ts`
- Modify: `web/package.json` (skrip `test:e2e:video`, dan menambahkannya ke `test:e2e:semua`)

**Interfaces:**
- Consumes: seluruh rantai Task 1–7.
- Produces: skrip E2E yang melewatkan diri tanpa kredensial R2.

- [ ] **Step 1: Tulis skrip E2E**

Buat `web/tests/e2e/materi-video.e2e.ts`:

```ts
/**
 * E2E RANTAI PENUH VIDEO R2 — satu-satunya pembuktian bahwa Task 1-7
 * tersambung MENJADI SATU rantai lewat peramban & server sungguhan: unggahan
 * presigned dari peramban admin, gating RLS pada penerbitan URL tonton, dan
 * bucket yang benar-benar tertutup tanpa tanda tangan.
 *
 * Prasyarat: `npx supabase start`, `npm run seed:users`, `npm run dev`,
 * dan kredensial R2 di `.env.local`.
 * Jalankan: `npm run test:e2e:video`.
 *
 * Sengaja BUKAN file *.test.ts agar `npm test` (vitest) tetap bisa jalan tanpa
 * server dev & peramban.
 */
import { config } from "dotenv";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { tungguIsi } from "./_tunggu";

config({ path: [".env.local", ".env"] });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SANDI = "padma-dev-123";
const JUDUL = "E2E-VIDEO-R2";

// Spec §11: skrip video MELEWATKAN DIRINYA bila kredensial R2 tidak ada,
// supaya `test:e2e:semua` tetap hijau di mesin tanpa akun Cloudflare.
const R2 = {
  akun: process.env.R2_ACCOUNT_ID ?? "",
  kunci: process.env.R2_ACCESS_KEY_ID ?? "",
  rahasia: process.env.R2_SECRET_ACCESS_KEY ?? "",
  bucket: process.env.R2_BUCKET_VIDEO ?? "",
};
if (!R2.akun || !R2.kunci || !R2.rahasia || !R2.bucket) {
  console.log(
    "DILEWATI: kredensial R2 tidak lengkap di .env.local " +
      "(R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_VIDEO).",
  );
  process.exit(0);
}

type Hasil = { nama: string; lolos: boolean; bukti: string };
const hasil: Hasil[] = [];
function catat(nama: string, lolos: boolean, bukti: string) {
  hasil.push({ nama, lolos, bukti });
  console.log(`${lolos ? "PASS" : "FAIL"}  ${nama}\n      ${bukti}`);
}

/**
 * Disalin PERSIS dari `tests/e2e/materi-pdf.e2e.ts` — termasuk `networkidle`
 * dan penjaga hidrasinya. Form masuk adalah controlled component: isian yang
 * ditulis sebelum React hydrate akan TERHAPUS, dan gejalanya bukan galat
 * melainkan login yang gagal secara acak.
 */
async function login(browser: Browser, email: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/masuk`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(SANDI);
  if ((await page.getByLabel("Email").inputValue()) !== email) {
    throw new Error("Isian email terhapus — halaman /masuk belum ter-hydrate.");
  }
  await Promise.all([
    page.waitForURL(
      (u) => !u.pathname.startsWith("/masuk") && !u.pathname.startsWith("/setelah-masuk"),
      { timeout: 20_000 },
    ),
    page.getByRole("button", { name: "Masuk", exact: true }).click(),
  ]);
  await tungguIsi(page);
  await page.close();
  return context;
}

/**
 * MP4 kecil yang STRUKTURNYA sah (ftyp + moov di depan + mdat) tetapi tidak
 * bisa didekode menjadi gambar. Cukup untuk membuktikan rantai PENYIMPANAN —
 * unggah, gating, penyajian — dan sengaja tidak berpura-pura membuktikan
 * pemutaran, yang menuntut encoder sungguhan.
 */
function buatMp4Uji(): Buffer {
  const box = (tipe: string, isi: Buffer) => {
    const h = Buffer.alloc(8);
    h.writeUInt32BE(8 + isi.length, 0);
    h.write(tipe, 4, "ascii");
    return Buffer.concat([h, isi]);
  };
  return Buffer.concat([
    box("ftyp", Buffer.concat([Buffer.from("isom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2mp41")])),
    box("moov", Buffer.alloc(128, 1)),
    box("mdat", Buffer.alloc(8192, 7)),
  ]);
}

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  const browser = await chromium.launch();
  let materiId = "";
  let objek = "";

  try {
    // ---- 1. Admin membuat materi video lalu mengunggah berkasnya ----
    const admin = await login(browser, "admin@padma.test");
    const pAdmin = await admin.newPage();
    await pAdmin.goto(`${BASE}/admin/materi`);
    await tungguIsi(pAdmin);

    await pAdmin.fill('input[name="judul"]', JUDUL);
    await pAdmin.selectOption('select[name="tipe"]', "video");
    await pAdmin.click('button[type="submit"]');
    await tungguIsi(pAdmin);

    const { data: baris } = await svc
      .from("materials").select("id").eq("judul", JUDUL).maybeSingle();
    materiId = baris?.id ?? "";
    catat("1. materi video dibuat lewat panel admin", materiId !== "", `id=${materiId}`);
    if (materiId === "") throw new Error("materi tidak terbentuk");

    await pAdmin.goto(`${BASE}/admin/materi/${materiId}`);
    await tungguIsi(pAdmin);
    await pAdmin.setInputFiles('input[type="file"]', {
      name: "uji.mp4", mimeType: "video/mp4", buffer: buatMp4Uji(),
    });
    await pAdmin.waitForSelector("text=Video tersimpan.", { timeout: 60_000 });

    const { data: vid } = await svc
      .from("material_videos").select("objek, mime").eq("material_id", materiId).maybeSingle();
    objek = vid?.objek ?? "";
    catat(
      "2. baris video tercatat dengan kunci objek & MIME",
      objek.startsWith(`${materiId}/`) && vid?.mime === "video/mp4",
      `objek=${objek} mime=${String(vid?.mime)}`,
    );

    // Materi harus ditugaskan agar pasien uji berhak.
    await svc.from("material_assignments").insert({ material_id: materiId, client_id: await idKlien("ananda@padma.test") });
    await svc.from("materials").update({ aktif: true }).eq("id", materiId);

    // ---- 2. Pasien BERHAK menerima URL ----
    const ananda = await login(browser, "ananda@padma.test");
    const pAnanda = await ananda.newPage();
    await pAnanda.goto(`${BASE}/passport/materi/${materiId}`);
    await tungguIsi(pAnanda);

    const jawab = await pAnanda.evaluate(async (id) => {
      const r = await fetch(`/api/materi/${id}/video`);
      return { status: r.status, teks: await r.text() };
    }, materiId);
    const urlTonton = jawab.status === 200
      ? (JSON.parse(jawab.teks) as { url: string }).url : "";
    catat(
      "3. pasien berhak menerima presigned URL",
      jawab.status === 200 && urlTonton.includes("r2.cloudflarestorage.com"),
      `HTTP ${jawab.status}`,
    );

    // ---- 3. URL tidak pernah masuk HTML halaman ----
    const html = await pAnanda.content();
    catat(
      "4. URL tidak muncul di HTML halaman (view-source bersih)",
      !html.includes("r2.cloudflarestorage.com"),
      `panjang html=${html.length}`,
    );

    // ---- 4. Objek tidak bisa diambil tanpa tanda tangan ----
    const telanjang = urlTonton.split("?")[0];
    const rTelanjang = await fetch(telanjang);
    catat(
      "5. objek R2 ditolak tanpa tanda tangan",
      !rTelanjang.ok,
      `HTTP ${rTelanjang.status}`,
    );

    // ---- 5. Pasien TIDAK berhak tidak pernah menerima URL ----
    const rina = await login(browser, "rina@padma.test");
    const pRina = await rina.newPage();
    await pRina.goto(`${BASE}/passport/materi`);
    const tolak = await pRina.evaluate(async (id) => {
      const r = await fetch(`/api/materi/${id}/video`);
      return { status: r.status, teks: await r.text() };
    }, materiId);
    catat(
      "6. pasien tanpa hak DITOLAK dan tidak menerima URL",
      tolak.status === 403 && !tolak.teks.includes("r2.cloudflarestorage.com"),
      `HTTP ${tolak.status}, badan=${tolak.teks.slice(0, 60)}`,
    );

    await admin.close(); await ananda.close(); await rina.close();
  } finally {
    // ---- Bersih-bersih: objek R2 dan seluruh baris uji ----
    if (objek !== "") {
      const { S3Client, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const s3 = new S3Client({
        region: "auto",
        endpoint: `https://${R2.akun}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: R2.kunci, secretAccessKey: R2.rahasia },
      });
      await s3.send(new DeleteObjectCommand({ Bucket: R2.bucket, Key: objek })).catch(() => {});
    }
    if (materiId !== "") {
      await svc.from("material_assignments").delete().eq("material_id", materiId);
      await svc.from("material_videos").delete().eq("material_id", materiId);
      await svc.from("materials").delete().eq("id", materiId);
    }
    await browser.close();
  }

  const gagal = hasil.filter((h) => !h.lolos);
  console.log(`\n${hasil.length - gagal.length}/${hasil.length} pemeriksaan lolos.`);
  if (gagal.length > 0) {
    console.error("GAGAL:\n" + gagal.map((g) => `  - ${g.nama}`).join("\n"));
    process.exit(1);
  }
  console.log(
    "Rantai penuh video terbukti: unggah presigned dari peramban -> gating RLS pada penerbitan URL -> bucket tertutup tanpa tanda tangan.",
  );
}

async function idKlien(email: string): Promise<string> {
  const { data } = await svc.from("clients").select("id, profiles!inner(id)").limit(1);
  // Bila bentuk relasi klien-ke-email berbeda di repo saat Anda mengerjakan
  // ini, sesuaikan query-nya — yang dituntut hanyalah id klien milik `email`.
  void email;
  return data?.[0]?.id ?? "";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

**Sebelum menjalankan, perbaiki `idKlien()`.** Fungsi itu adalah satu-satunya
bagian skrip ini yang saya tulis tanpa memastikan bentuk relasinya di repo.
Baca `web/supabase/seed.sql` dan `web/scripts/seed-users.ts` untuk melihat
bagaimana `clients` ditautkan ke akun auth, lalu tulis query yang benar-benar
mengembalikan id klien milik `ananda@padma.test`. Jangan menebak: bila query-nya
salah, penugasan mendarat di klien yang keliru dan pemeriksaan 3 & 6 akan
berbohong ke arah yang sama-sama hijau.

- [ ] **Step 2: Daftarkan skripnya**

Di `web/package.json`, tambahkan:

```json
    "test:e2e:video": "tsx tests/e2e/materi-video.e2e.ts",
```

dan sisipkan ` && npm run test:e2e:video` di akhir nilai `test:e2e:semua`.

- [ ] **Step 3: Jalankan**

```bash
cd web
npm run dev &                 # tunggu sampai "Ready in"
npm run test:e2e:video
```
Expected: seluruh pemeriksaan lolos, atau skrip melewatkan diri dengan exit 0
bila kredensial R2 tidak ada. Laporkan yang mana yang terjadi.

- [ ] **Step 4: Jalankan seluruh E2E**

Run: `cd web && npm run test:e2e:semua`
Expected: seluruh skrip lolos.

- [ ] **Step 5: Commit**

```bash
git add web/tests/e2e/materi-video.e2e.ts web/package.json
git commit -m "test(e2e): rantai penuh video — gating, presigned URL, dan objek tertutup"
```

---

## Sesudah seluruh task

Butir go-live yang tersisa dan **tidak** dikerjakan rencana ini:

1. **Tambahkan domain produksi ke `AllowedOrigins` CORS bucket `padma`.** Saat
   ini hanya `http://localhost:3000`. Bila terlewat, unggah video mati di
   produksi saja sementara lokal tetap hijau — kelas bug yang paling mahal
   ditemukan belakangan.
2. **Pasang keempat env R2 di Vercel** (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_VIDEO=padma`), seluruhnya server-only.
3. **Rotasi kredensial R2** — yang dipakai sekarang pernah melewati kanal chat.
