# Backup Mandiri Database — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pg_dump` harian dari Supabase produksi, dibuktikan bisa dipulihkan, dienkripsi dengan kunci publik `age`, lalu disimpan ke bucket R2 `padma-backup` dengan retensi 30 hari.

**Architecture:** Satu workflow GitHub Actions menjalankan rantai `dump → pulihkan → verifikasi → enkripsi → unggah → retensi`. Logika yang bisa salah diam-diam — memilih objek untuk **dihapus** — ditarik keluar menjadi fungsi murni TypeScript yang diuji Vitest; shell hanya mengorkestrasi langkah-langkah yang gagalnya berisik.

**Tech Stack:** GitHub Actions, PostgreSQL 17 client (`pg_dump`/`pg_restore`/`psql`), `age`, `@aws-sdk/client-s3`, TypeScript strict, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-padma-backup-mandiri-design.md`

---

## Global Constraints

Berlaku untuk **semua** task.

- **Semua cap waktu berbentuk string UTC `YYYYMMDD-HHMMSSZ`, dibuat di luar TypeScript** (workflow memakai `date -u`). `toISOString`, `setDate`, dan `getDay` **DILARANG** — Vercel berjalan UTC, mesin dev WIB, Vitest berjalan `TZ=UTC`. `Date.UTC` dan `getUTC*` boleh, karena keduanya eksplisit UTC.
- **Arah gagal-aman retensi selalu MEMPERTAHANKAN.** Kunci yang tidak terbaca, cap waktu yang tidak masuk akal, jam yang kacau, daftar kosong — semuanya berarti *jangan hapus*. Menyimpan kelebihan objek itu murah; menghapus satu-satunya salinan sehat tidak bisa dibatalkan.
- **Unggah dulu, hapus kemudian.** Retensi hanya berjalan sesudah unggahan sukses, dan objek yang baru diunggah tidak boleh pernah ikut terhapus.
- **Rahasia tidak pernah dicetak.** Dilarang `echo` connection string atau kredensial R2, dan dilarang `set -x` pada langkah yang menyentuhnya.
- **Enkripsi terjadi SESUDAH verifikasi.** Urutan ini yang membuat CI tidak pernah perlu kunci privat (spec B6). Membaliknya menghapus seluruh properti keamanan desain ini.
- **Tidak ada tes otomatis yang menyentuh produksi.**
- Penamaan Indonesia mengikuti repo (`kunciObjekBackup`, `pilihObjekKedaluwarsa`).
- Setelah setiap task: `npx tsc --noEmit`, `npx vitest run`, commit.

**Prasyarat di luar kode** (dikerjakan pemilik, bukan implementer): sandi DB baru + `SUPABASE_DB_URL` session pooler, token R2 berlingkup `padma-backup`, pasangan kunci `age`. Task 1–3 tidak membutuhkannya; Task 4 hanya butuh saat dijalankan dengan sumber `produksi`.

---

## Struktur Berkas

| Berkas | Tanggung jawab |
|---|---|
| `web/src/lib/backup/nama-objek.ts` | Fungsi murni: cap waktu ↔ kunci objek, cap waktu → epoch |
| `web/src/lib/backup/retensi.ts` | Fungsi murni: daftar kunci + waktu → kunci mana yang kedaluwarsa |
| `web/src/lib/backup/unggah.ts` | Orkestrasi unggah+retensi terhadap antarmuka `KlienObjek` (bisa dipalsukan di tes) |
| `web/scripts/backup/unggah-r2.ts` | CLI: merangkai `KlienObjek` sungguhan dari `@aws-sdk/client-s3` |
| `web/tests/backup-nama-objek.test.ts` | Tes Task 1 |
| `web/tests/backup-retensi.test.ts` | Tes Task 2 |
| `web/tests/backup-unggah.test.ts` | Tes Task 3 dengan klien palsu |
| `.github/workflows/backup-db.yml` | Orkestrasi seluruh rantai |
| `docs/runbook-pemulihan.md` | Prosedur pemulihan |

---

### Task 1: Penamaan objek backup

**Files:**
- Create: `web/src/lib/backup/nama-objek.ts`
- Create: `web/tests/backup-nama-objek.test.ts`

**Interfaces:**
- Consumes: tidak ada.
- Produces: `PREFIKS_BACKUP: string`, `kunciObjekBackup(capWaktu: string): string`, `capWaktuDariKunci(kunci: string): string | null`, `epochDariCapWaktu(capWaktu: string): number | null`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `web/tests/backup-nama-objek.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PREFIKS_BACKUP, kunciObjekBackup, capWaktuDariKunci, epochDariCapWaktu,
} from "@/lib/backup/nama-objek";

describe("kunci objek backup", () => {
  it("menyusun kunci berjenjang tahun/bulan dari cap waktunya sendiri", () => {
    expect(kunciObjekBackup("20260904-200000Z"))
      .toBe("db/2026/09/padma-20260904-200000Z.dump.age");
    expect(PREFIKS_BACKUP).toBe("db");
  });

  it("menolak cap waktu yang bukan bentuk UTC yang disepakati", () => {
    // Bentuk lain akan membuat retensi gagal membacanya, dan objek yang tidak
    // terbaca TIDAK PERNAH dihapus — jadi salah bentuk = sampah abadi di R2.
    for (const buruk of ["2026-09-04T20:00:00Z", "20260904-200000", "", "padma"]) {
      expect(() => kunciObjekBackup(buruk)).toThrow();
    }
  });

  it("membaca kembali cap waktu dari kunci yang dibuatnya sendiri", () => {
    const cap = "20261231-235959Z";
    expect(capWaktuDariKunci(kunciObjekBackup(cap))).toBe(cap);
  });

  it("mengembalikan null untuk kunci asing, bukan menebak", () => {
    for (const asing of [
      "db/2026/09/catatan.txt",
      "db/2026/09/padma-20260904-200000Z.dump",
      "sesuatu/lain.dump.age",
      "",
    ]) {
      expect(capWaktuDariKunci(asing)).toBeNull();
    }
  });
});

describe("cap waktu ke epoch", () => {
  it("membaca sebagai UTC, bukan zona waktu mesin", () => {
    expect(epochDariCapWaktu("19700101-000000Z")).toBe(0);
    expect(epochDariCapWaktu("19700102-000000Z")).toBe(86_400_000);
  });

  it("menolak tanggal yang tidak pernah ada alih-alih menggulungnya", () => {
    // Date.UTC(2026, 1, 30) diam-diam menjadi 2 Maret. Cap waktu semacam itu
    // menandakan sesuatu yang rusak di hulu, dan menebak artinya lebih
    // berbahaya daripada menolaknya.
    expect(epochDariCapWaktu("20260230-000000Z")).toBeNull();
    expect(epochDariCapWaktu("20261301-000000Z")).toBeNull();
    expect(epochDariCapWaktu("20260904-250000Z")).toBeNull();
    expect(epochDariCapWaktu("20260904-206000Z")).toBeNull();
  });

  it("mengembalikan null untuk bentuk yang salah", () => {
    expect(epochDariCapWaktu("bukan cap waktu")).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/backup-nama-objek.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/backup/nama-objek"`.

- [ ] **Step 3: Tulis implementasinya**

Buat `web/src/lib/backup/nama-objek.ts`:

```ts
/**
 * Penamaan objek backup. MURNI: tanpa I/O dan tanpa membaca jam mesin.
 *
 * Cap waktu SELALU string UTC `YYYYMMDD-HHMMSSZ` dan dibuat DI LUAR modul ini
 * (workflow memakai `date -u`). Repo ini melarang `toISOString`/`setDate`/
 * `getDay` karena Vercel berjalan UTC sementara mesin dev WIB; di berkas ini
 * taruhannya konkret — salah tujuh jam berarti objek dihapus sehari lebih cepat
 * daripada yang dimaksud.
 */

export const PREFIKS_BACKUP = "db";

const POLA_CAP = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})Z$/;
const POLA_KUNCI = /(?:^|\/)padma-(\d{8}-\d{6}Z)\.dump\.age$/;

export function kunciObjekBackup(capWaktu: string): string {
  const cocok = POLA_CAP.exec(capWaktu);
  if (cocok === null || epochDariCapWaktu(capWaktu) === null) {
    throw new Error(`Cap waktu backup tidak sah: ${JSON.stringify(capWaktu)}`);
  }
  return `${PREFIKS_BACKUP}/${cocok[1]}/${cocok[2]}/padma-${capWaktu}.dump.age`;
}

export function capWaktuDariKunci(kunci: string): string | null {
  const cocok = POLA_KUNCI.exec(kunci);
  return cocok === null ? null : cocok[1];
}

export function epochDariCapWaktu(capWaktu: string): number | null {
  const c = POLA_CAP.exec(capWaktu);
  if (c === null) return null;
  const [tahun, bulan, tanggal, jam, menit, detik] =
    [c[1], c[2], c[3], c[4], c[5], c[6]].map(Number);

  const ms = Date.UTC(tahun, bulan - 1, tanggal, jam, menit, detik);
  if (!Number.isFinite(ms)) return null;

  // Date.UTC MENGGULUNG nilai di luar jangkauan: bulan 13 menjadi Januari tahun
  // berikutnya, 30 Februari menjadi 2 Maret. Perjalanan bolak-balik ini menolak
  // cap waktu semacam itu alih-alih diam-diam memindahkan umur objek.
  const d = new Date(ms);
  const sama =
    d.getUTCFullYear() === tahun && d.getUTCMonth() === bulan - 1 &&
    d.getUTCDate() === tanggal && d.getUTCHours() === jam &&
    d.getUTCMinutes() === menit && d.getUTCSeconds() === detik;
  return sama ? ms : null;
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/backup-nama-objek.test.ts`
Expected: PASS, 6 test.

- [ ] **Step 5: Seluruh suite tetap hijau & typecheck**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: typecheck bersih, seluruh suite lolos.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/backup/nama-objek.ts web/tests/backup-nama-objek.test.ts
git commit -m "feat(backup): penamaan objek backup + pembacaan cap waktu UTC"
```

---

### Task 2: Pemilihan objek kedaluwarsa

**Files:**
- Create: `web/src/lib/backup/retensi.ts`
- Create: `web/tests/backup-retensi.test.ts`

**Interfaces:**
- Consumes: `capWaktuDariKunci`, `epochDariCapWaktu` dari Task 1.
- Produces: `HARI_SIMPAN: number`, `pilihObjekKedaluwarsa(kunci: readonly string[], sekarangEpochMs: number, hariSimpan?: number): string[]`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `web/tests/backup-retensi.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { HARI_SIMPAN, pilihObjekKedaluwarsa } from "@/lib/backup/retensi";
import { kunciObjekBackup, epochDariCapWaktu } from "@/lib/backup/nama-objek";

const SEKARANG = epochDariCapWaktu("20260904-200000Z")!;
const HARI = 24 * 60 * 60 * 1000;

/** Membuat kunci untuk objek berumur `hari` (+ `detik`) sebelum SEKARANG. */
const kunciBerumur = (hari: number, detik = 0) => {
  const d = new Date(SEKARANG - hari * HARI - detik * 1000);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return kunciObjekBackup(
    `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`,
  );
};

describe("retensi", () => {
  it("menyimpan 30 hari", () => {
    expect(HARI_SIMPAN).toBe(30);
  });

  it("menghapus yang lebih tua dari batas dan menyimpan yang lebih muda", () => {
    const tua = kunciBerumur(31);
    const muda = kunciBerumur(29);
    expect(pilihObjekKedaluwarsa([tua, muda], SEKARANG)).toEqual([tua]);
  });

  it("MEMPERTAHANKAN yang berumur persis batas", () => {
    // Batasnya "lebih tua dari 30 hari", bukan "30 hari atau lebih". Objek yang
    // persis berumur 30 hari masih salinan sah dan tidak boleh ikut hilang.
    expect(pilihObjekKedaluwarsa([kunciBerumur(30)], SEKARANG)).toEqual([]);
    const lewatSedetik = kunciBerumur(30, 1);
    expect(pilihObjekKedaluwarsa([lewatSedetik], SEKARANG)).toEqual([lewatSedetik]);
  });

  it("TIDAK PERNAH menghapus kunci yang tidak bisa dibaca", () => {
    // Objek asing di bucket bukan milik kita untuk dihapus, dan kunci tak
    // terbaca bisa berarti bentuk penamaan berubah — bukan izin membersihkan.
    const asing = ["db/2026/01/catatan.txt", "sesuatu.dump.age", "db/", ""];
    expect(pilihObjekKedaluwarsa(asing, SEKARANG)).toEqual([]);
  });

  it("TIDAK PERNAH menghapus objek bercap waktu masa depan", () => {
    // Cap waktu di masa depan berarti jam runner atau jam pembuatnya kacau.
    // Menghapus berdasar jam yang kacau adalah cara kehilangan backup tersehat.
    expect(pilihObjekKedaluwarsa([kunciBerumur(-5)], SEKARANG)).toEqual([]);
  });

  it("mengembalikan daftar kosong bila jam sekarang tidak masuk akal", () => {
    expect(pilihObjekKedaluwarsa([kunciBerumur(999)], Number.NaN)).toEqual([]);
    expect(pilihObjekKedaluwarsa([kunciBerumur(999)], Number.POSITIVE_INFINITY))
      .toEqual([]);
  });

  it("mengembalikan daftar kosong bila hariSimpan tidak masuk akal", () => {
    // hariSimpan 0 atau negatif berarti "hapus semuanya" — hampir pasti salah
    // konfigurasi, bukan permintaan sungguhan.
    for (const h of [0, -1, Number.NaN]) {
      expect(pilihObjekKedaluwarsa([kunciBerumur(999)], SEKARANG, h)).toEqual([]);
    }
  });

  it("menghormati hariSimpan yang diberikan", () => {
    const k = kunciBerumur(10);
    expect(pilihObjekKedaluwarsa([k], SEKARANG, 7)).toEqual([k]);
    expect(pilihObjekKedaluwarsa([k], SEKARANG, 14)).toEqual([]);
  });

  it("daftar kosong menghasilkan daftar kosong", () => {
    expect(pilihObjekKedaluwarsa([], SEKARANG)).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/backup-retensi.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/backup/retensi"`.

- [ ] **Step 3: Tulis implementasinya**

Buat `web/src/lib/backup/retensi.ts`:

```ts
import { capWaktuDariKunci, epochDariCapWaktu } from "./nama-objek";

/** Spec B2. Naik-turunkan di sini, bukan tersebar di workflow. */
export const HARI_SIMPAN = 30;

const MS_PER_HARI = 24 * 60 * 60 * 1000;

/**
 * Memilih objek yang boleh dihapus.
 *
 * SELURUH ketidakpastian berujung MEMPERTAHANKAN. Kunci tak terbaca, cap waktu
 * mustahil, jam kacau, konfigurasi aneh — semuanya menghasilkan "jangan hapus".
 * Kelebihan objek di R2 berbiaya beberapa megabyte; menghapus salinan sehat
 * terakhir tidak bisa dibatalkan.
 */
export function pilihObjekKedaluwarsa(
  kunci: readonly string[],
  sekarangEpochMs: number,
  hariSimpan: number = HARI_SIMPAN,
): string[] {
  if (!Number.isFinite(sekarangEpochMs)) return [];
  if (!Number.isFinite(hariSimpan) || hariSimpan <= 0) return [];

  const batas = sekarangEpochMs - hariSimpan * MS_PER_HARI;

  return kunci.filter((k) => {
    const cap = capWaktuDariKunci(k);
    if (cap === null) return false;
    const ms = epochDariCapWaktu(cap);
    if (ms === null) return false;
    if (ms > sekarangEpochMs) return false;
    return ms < batas;
  });
}
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/backup-retensi.test.ts`
Expected: PASS, 9 test.

- [ ] **Step 5: Buktikan asersi batasnya lolos-mutasi**

Ubah sementara `return ms < batas;` menjadi `return ms <= batas;`, jalankan ulang
berkas tesnya, dan pastikan test "MEMPERTAHANKAN yang berumur persis batas"
menjadi **MERAH**. Kembalikan perubahannya, pastikan hijau lagi.

Wajib: tanpa langkah ini, asersi batas hanya kelihatan menjaga sesuatu.

- [ ] **Step 6: Seluruh suite tetap hijau & typecheck**

Run: `cd web && npx tsc --noEmit && npx vitest run`

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/backup/retensi.ts web/tests/backup-retensi.test.ts
git commit -m "feat(backup): pemilihan objek kedaluwarsa yang gagal-aman ke arah menyimpan"
```

---

### Task 3: Unggah + terapkan retensi

**Files:**
- Create: `web/src/lib/backup/unggah.ts`
- Create: `web/tests/backup-unggah.test.ts`
- Create: `web/scripts/backup/unggah-r2.ts`
- Modify: `web/package.json` (tambah `@aws-sdk/client-s3`)

**Interfaces:**
- Consumes: `kunciObjekBackup`, `PREFIKS_BACKUP` (Task 1); `pilihObjekKedaluwarsa` (Task 2).
- Produces: `interface KlienObjek { daftar(prefiks: string): Promise<string[]>; unggah(kunci: string, isi: Uint8Array): Promise<void>; hapus(kunci: string): Promise<void> }`, `type HasilUnggah = { kunciBaru: string; dihapus: string[] }`, `unggahDanTerapkanRetensi(klien: KlienObjek, opsi: { capWaktu: string; isi: Uint8Array; sekarangEpochMs: number; hariSimpan?: number }): Promise<HasilUnggah>`.

- [ ] **Step 1: Pasang dependensi**

```bash
cd web && npm install @aws-sdk/client-s3
```

- [ ] **Step 2: Tulis test yang gagal**

Buat `web/tests/backup-unggah.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { unggahDanTerapkanRetensi, type KlienObjek } from "@/lib/backup/unggah";
import { kunciObjekBackup, epochDariCapWaktu } from "@/lib/backup/nama-objek";

const SEKARANG = epochDariCapWaktu("20260904-200000Z")!;
const ISI = new Uint8Array([1, 2, 3]);
const CAP_BARU = "20260904-200000Z";

function klienPalsu(awal: string[] = []) {
  const isi = new Set(awal);
  const jejak: string[] = [];
  const klien: KlienObjek = {
    async daftar() { jejak.push("daftar"); return [...isi]; },
    async unggah(k) { jejak.push(`unggah:${k}`); isi.add(k); },
    async hapus(k) { jejak.push(`hapus:${k}`); isi.delete(k); },
  };
  return { klien, isi, jejak };
}

describe("unggah + retensi", () => {
  it("mengunggah lalu menghapus yang kedaluwarsa", async () => {
    const tua = kunciObjekBackup("20260101-200000Z");
    const { klien, isi } = klienPalsu([tua]);
    const hasil = await unggahDanTerapkanRetensi(klien, {
      capWaktu: CAP_BARU, isi: ISI, sekarangEpochMs: SEKARANG,
    });
    expect(hasil.kunciBaru).toBe("db/2026/09/padma-20260904-200000Z.dump.age");
    expect(hasil.dihapus).toEqual([tua]);
    expect(isi.has(tua)).toBe(false);
    expect(isi.has(hasil.kunciBaru)).toBe(true);
  });

  it("mengunggah SEBELUM menghapus apa pun", async () => {
    // Membaliknya berarti ada jendela waktu ketika salinan lama sudah hilang
    // sementara yang baru belum tentu ada.
    const tua = kunciObjekBackup("20260101-200000Z");
    const { klien, jejak } = klienPalsu([tua]);
    await unggahDanTerapkanRetensi(klien, {
      capWaktu: CAP_BARU, isi: ISI, sekarangEpochMs: SEKARANG,
    });
    const iUnggah = jejak.findIndex((j) => j.startsWith("unggah:"));
    const iHapus = jejak.findIndex((j) => j.startsWith("hapus:"));
    expect(iUnggah).toBeGreaterThanOrEqual(0);
    expect(iHapus).toBeGreaterThan(iUnggah);
  });

  it("tidak menghapus apa pun bila unggahan gagal", async () => {
    const tua = kunciObjekBackup("20260101-200000Z");
    const { klien, isi } = klienPalsu([tua]);
    klien.unggah = async () => { throw new Error("R2 menolak"); };
    await expect(unggahDanTerapkanRetensi(klien, {
      capWaktu: CAP_BARU, isi: ISI, sekarangEpochMs: SEKARANG,
    })).rejects.toThrow("R2 menolak");
    expect(isi.has(tua)).toBe(true);
  });

  it("TIDAK PERNAH menghapus objek yang baru saja diunggah", async () => {
    // Jam runner yang meleset setahun ke depan membuat objek baru tampak kuno.
    // Tanpa pagar ini, satu-satunya hasil kerja job itu terhapus olehnya sendiri.
    const { klien, isi } = klienPalsu();
    const jauhDiDepan = SEKARANG + 400 * 24 * 60 * 60 * 1000;
    const hasil = await unggahDanTerapkanRetensi(klien, {
      capWaktu: CAP_BARU, isi: ISI, sekarangEpochMs: jauhDiDepan,
    });
    expect(hasil.dihapus).toEqual([]);
    expect(isi.has(hasil.kunciBaru)).toBe(true);
  });

  it("mendaftar objek dengan prefiks backup", async () => {
    const { klien, jejak } = klienPalsu();
    await unggahDanTerapkanRetensi(klien, {
      capWaktu: CAP_BARU, isi: ISI, sekarangEpochMs: SEKARANG,
    });
    expect(jejak).toContain("daftar");
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan MERAH**

Run: `cd web && npx vitest run tests/backup-unggah.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/backup/unggah"`.

- [ ] **Step 4: Tulis modul unggah**

Buat `web/src/lib/backup/unggah.ts`:

```ts
import { kunciObjekBackup, PREFIKS_BACKUP } from "./nama-objek";
import { pilihObjekKedaluwarsa } from "./retensi";

/**
 * Antarmuka penyimpanan objek seminimal yang dibutuhkan rantai backup.
 *
 * Sengaja BUKAN tipe dari @aws-sdk: dengan begini seluruh urutan berbahaya
 * (unggah dulu, hapus kemudian, jangan hapus yang baru) diuji tanpa jaringan,
 * dan `scripts/backup/unggah-r2.ts` tinggal menyediakan tiga metode ini.
 */
export interface KlienObjek {
  daftar(prefiks: string): Promise<string[]>;
  unggah(kunci: string, isi: Uint8Array): Promise<void>;
  hapus(kunci: string): Promise<void>;
}

export type HasilUnggah = { kunciBaru: string; dihapus: string[] };

export async function unggahDanTerapkanRetensi(
  klien: KlienObjek,
  opsi: {
    capWaktu: string;
    isi: Uint8Array;
    sekarangEpochMs: number;
    hariSimpan?: number;
  },
): Promise<HasilUnggah> {
  const kunciBaru = kunciObjekBackup(opsi.capWaktu);

  // Unggah DULU. Bila langkah ini melempar, tidak satu pun objek lama tersentuh.
  await klien.unggah(kunciBaru, opsi.isi);

  const semua = await klien.daftar(`${PREFIKS_BACKUP}/`);
  const dihapus = pilihObjekKedaluwarsa(semua, opsi.sekarangEpochMs, opsi.hariSimpan)
    // Pagar terakhir: apa pun yang terjadi pada jam mesin, hasil kerja hari ini
    // tidak boleh menjadi korban pembersihannya sendiri.
    .filter((k) => k !== kunciBaru);

  for (const k of dihapus) await klien.hapus(k);

  return { kunciBaru, dihapus };
}
```

- [ ] **Step 5: Jalankan test, pastikan HIJAU**

Run: `cd web && npx vitest run tests/backup-unggah.test.ts`
Expected: PASS, 5 test.

- [ ] **Step 6: Tulis CLI-nya**

Buat `web/scripts/backup/unggah-r2.ts`:

```ts
/**
 * CLI backup: mengunggah satu berkas terenkripsi ke R2 lalu menerapkan retensi.
 *
 * Dipanggil workflow:
 *   npx tsx scripts/backup/unggah-r2.ts <berkas> <capWaktu>
 *
 * Seluruh keputusan hidup di src/lib/backup/*; berkas ini hanya merangkai
 * klien sungguhan dan menerjemahkan galat menjadi exit code.
 */
import { readFileSync } from "node:fs";
import {
  S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { unggahDanTerapkanRetensi, type KlienObjek } from "../../src/lib/backup/unggah";

function wajib(nama: string): string {
  const nilai = process.env[nama];
  if (nilai === undefined || nilai === "") {
    // Menyebut NAMA secret-nya, tidak pernah nilainya.
    console.error(`Secret ${nama} belum dipasang.`);
    process.exit(1);
  }
  return nilai;
}

const [berkas, capWaktu] = process.argv.slice(2);
if (berkas === undefined || capWaktu === undefined) {
  console.error("Pakai: unggah-r2.ts <berkas> <capWaktu YYYYMMDD-HHMMSSZ>");
  process.exit(1);
}

const BUCKET = wajib("R2_BUCKET_BACKUP");
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${wajib("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: wajib("R2_ACCESS_KEY_ID"),
    secretAccessKey: wajib("R2_SECRET_ACCESS_KEY"),
  },
});

const klien: KlienObjek = {
  async daftar(prefiks) {
    const kunci: string[] = [];
    let token: string | undefined;
    // Paginasi WAJIB: tanpa ContinuationToken, R2 berhenti di 1000 objek dan
    // retensi diam-diam melewatkan sisanya.
    do {
      const r = await s3.send(new ListObjectsV2Command({
        Bucket: BUCKET, Prefix: prefiks, ContinuationToken: token,
      }));
      for (const o of r.Contents ?? []) if (o.Key !== undefined) kunci.push(o.Key);
      token = r.IsTruncated === true ? r.NextContinuationToken : undefined;
    } while (token !== undefined);
    return kunci;
  },
  async unggah(kunci, isi) {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: kunci, Body: isi,
      ContentType: "application/octet-stream",
    }));
  },
  async hapus(kunci) {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: kunci }));
  },
};

const hasil = await unggahDanTerapkanRetensi(klien, {
  capWaktu,
  isi: readFileSync(berkas),
  sekarangEpochMs: Date.now(),
});

console.log(`Terunggah: ${hasil.kunciBaru}`);
console.log(`Dihapus  : ${hasil.dihapus.length} objek kedaluwarsa`);
for (const k of hasil.dihapus) console.log(`  - ${k}`);
```

- [ ] **Step 7: Typecheck & seluruh suite**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: bersih dan hijau.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/backup/unggah.ts web/tests/backup-unggah.test.ts \
        web/scripts/backup/unggah-r2.ts web/package.json web/package-lock.json
git commit -m "feat(backup): unggah ke R2 + terapkan retensi, dengan urutan yang diuji"
```

---

### Task 4: Workflow GitHub Actions

**Files:**
- Create: `.github/workflows/backup-db.yml`

**Interfaces:**
- Consumes: `web/scripts/backup/unggah-r2.ts` (Task 3).
- Produces: workflow `Backup database` dengan input `sumber` bernilai `contoh` atau `produksi`.

- [ ] **Step 1: Tulis workflow**

Buat `.github/workflows/backup-db.yml`:

```yaml
name: Backup database

on:
  workflow_dispatch:
    inputs:
      sumber:
        description: "contoh = Postgres bawaan runner (aman). produksi = Supabase sungguhan."
        type: choice
        options: [contoh, produksi]
        default: contoh

  # ===== JADWAL HARIAN — SENGAJA MASIH MATI =====
  # Dihidupkan sebagai LANGKAH TERAKHIR go-live (spec §11), sesudah ketiga
  # secret terpasang dan latihan dekripsi pertama selesai. Jadwal yang aktif
  # sebelum itu gagal setiap hari, dan alarm yang berbunyi tiap hari adalah
  # alarm yang berhenti dibaca.
  # schedule:
  #   - cron: "0 20 * * *"   # 20:00 UTC = 03:00 WIB

concurrency:
  group: backup-db
  cancel-in-progress: false

jobs:
  backup:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    services:
      pg:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: pengujian
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20
        ports:
          - 5432:5432

    env:
      URL_ADMIN: postgresql://postgres:pengujian@127.0.0.1:5432/postgres
      URL_VERIFIKASI: postgresql://postgres:pengujian@127.0.0.1:5432/verifikasi
      URL_CONTOH: postgresql://postgres:pengujian@127.0.0.1:5432/sumber_contoh

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
          cache-dependency-path: web/package-lock.json

      - name: Pasang klien PostgreSQL 17 dan age
        run: |
          set -euo pipefail
          sudo install -d /usr/share/postgresql-common/pgdg
          curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
            | sudo tee /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc > /dev/null
          echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
            | sudo tee /etc/apt/sources.list.d/pgdg.list > /dev/null
          sudo apt-get update -qq
          sudo apt-get install -y -qq postgresql-client-17 age
          pg_dump --version
          age --version

      - name: Siapkan sumber
        env:
          SUMBER: ${{ inputs.sumber }}
          URL_PRODUKSI: ${{ secrets.SUPABASE_DB_URL }}
        run: |
          set -euo pipefail
          if [ "${SUMBER:-produksi}" = "produksi" ]; then
            if [ -z "${URL_PRODUKSI:-}" ]; then
              echo "::error::Secret SUPABASE_DB_URL belum dipasang."; exit 1
            fi
            # Nilainya TIDAK pernah dicetak; hanya diteruskan lewat berkas env.
            echo "URL_SUMBER=$URL_PRODUKSI" >> "$GITHUB_ENV"
            echo "TABEL_WAJIB=auth.users,public.clients,public.sessions,public.materials,public.profiles" >> "$GITHUB_ENV"
          else
            psql "$URL_ADMIN" -v ON_ERROR_STOP=1 -c "create database sumber_contoh;"
            psql "$URL_CONTOH" -v ON_ERROR_STOP=1 <<'SQL'
          create schema if not exists auth;
          create table auth.users (id uuid primary key, email text not null);
          create table public.clients (id uuid primary key, nama text not null);
          insert into auth.users values
            ('11111111-1111-1111-1111-111111111111', 'contoh@padma.test');
          insert into public.clients values
            ('22222222-2222-2222-2222-222222222222', 'Pasien Contoh');
          SQL
            echo "URL_SUMBER=$URL_CONTOH" >> "$GITHUB_ENV"
            echo "TABEL_WAJIB=auth.users,public.clients" >> "$GITHUB_ENV"
          fi

      - name: Periksa versi klien vs server
        run: |
          set -euo pipefail
          server=$(psql "$URL_SUMBER" -Atc "show server_version_num")
          klien=$(pg_dump --version | grep -oE '[0-9]+' | head -1)
          server_mayor=$(( server / 10000 ))
          echo "server=$server_mayor klien=$klien"
          if [ "$klien" -lt "$server_mayor" ]; then
            echo "::error::pg_dump $klien lebih tua daripada server $server_mayor — dump akan ditolak."
            exit 1
          fi

      - name: Buat cap waktu
        id: cap
        run: echo "nilai=$(date -u +%Y%m%d-%H%M%SZ)" >> "$GITHUB_OUTPUT"

      - name: pg_dump
        run: |
          set -euo pipefail
          # Hanya public + auth. Skema terkelola Supabase (vault, pgsodium,
          # storage, realtime) sengaja DILUAR: sebagiannya tidak bisa dibaca
          # peran postgres, dan tak satu pun bisa dipulihkan ke Postgres polos —
          # memasukkannya membuat verifikasi merah karena hal yang bukan masalah.
          # Objek Storage memang di luar scope (spec B3).
          pg_dump "$URL_SUMBER" \
            --format=custom --no-owner --no-privileges \
            --schema=public --schema=auth \
            --file="padma-${{ steps.cap.outputs.nilai }}.dump"
          ls -lh padma-*.dump

      - name: Pulihkan sungguhan lalu verifikasi
        run: |
          set -euo pipefail
          psql "$URL_ADMIN" -v ON_ERROR_STOP=1 -c "create database verifikasi;"
          psql "$URL_VERIFIKASI" -v ON_ERROR_STOP=1 -c 'create extension if not exists pgcrypto;'

          # --exit-on-error TIDAK dipakai: dump lintas-lingkungan selalu memuat
          # GRANT ke peran yang tidak ada di Postgres polos. Yang menentukan
          # lulus-tidaknya adalah pemeriksaan di bawah, bukan diamnya pg_restore.
          pg_restore --no-owner --no-privileges \
            --dbname "$URL_VERIFIKASI" "padma-${{ steps.cap.outputs.nilai }}.dump" \
            2> restore.log || true
          echo "--- 20 baris pertama restore.log ---"
          head -20 restore.log || true

          total=0
          for t in ${TABEL_WAJIB//,/ }; do
            ada=$(psql "$URL_VERIFIKASI" -Atc "select to_regclass('$t') is not null;")
            if [ "$ada" != "t" ]; then
              echo "::error::Tabel wajib $t TIDAK ada di hasil restore — dump tidak lengkap."
              exit 1
            fi
            n=$(psql "$URL_VERIFIKASI" -Atc "select count(*) from $t;")
            echo "  $t: $n baris"
            total=$(( total + n ))
          done
          if [ "$total" -eq 0 ]; then
            echo "::error::Seluruh tabel wajib kosong — dump kemungkinan terpotong."
            exit 1
          fi
          echo "Verifikasi lolos: $total baris di seluruh tabel wajib."

      - name: Enkripsi
        env:
          AGE_PUBLIC_KEY: ${{ secrets.AGE_PUBLIC_KEY }}
        run: |
          set -euo pipefail
          if [ -z "${AGE_PUBLIC_KEY:-}" ]; then
            echo "::error::Secret AGE_PUBLIC_KEY belum dipasang."; exit 1
          fi
          age -r "$AGE_PUBLIC_KEY" \
            -o "padma-${{ steps.cap.outputs.nilai }}.dump.age" \
            "padma-${{ steps.cap.outputs.nilai }}.dump"
          # Runner memang sekali pakai, tetapi menghapus berkas polosnya menutup
          # kemungkinan ia ikut terangkut langkah lain (artifact, cache, log).
          rm -f "padma-${{ steps.cap.outputs.nilai }}.dump"
          ls -lh padma-*.dump.age

      - name: Unggah ke R2 + terapkan retensi
        working-directory: web
        env:
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET_BACKUP: ${{ secrets.R2_BUCKET_BACKUP }}
        run: |
          set -euo pipefail
          npm ci
          npx tsx scripts/backup/unggah-r2.ts \
            "../padma-${{ steps.cap.outputs.nilai }}.dump.age" \
            "${{ steps.cap.outputs.nilai }}"

      - name: Ringkasan
        if: always()
        run: |
          {
            echo "### Backup ${{ steps.cap.outputs.nilai }}"
            echo "- sumber: \`${{ inputs.sumber || 'terjadwal (produksi)' }}\`"
            echo "- status: ${{ job.status }}"
          } >> "$GITHUB_STEP_SUMMARY"
```

- [ ] **Step 2: Validasi YAML secara lokal**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/backup-db.yml')); print('YAML sah')"
```
Expected: `YAML sah`.

- [ ] **Step 3: Buktikan rantainya di mesin dev lebih dulu**

Runner GitHub tidak bisa menjangkau Postgres Docker di mesin dev (spec §9), jadi
pembuktian tahap pertama dijalankan tangan di sini terhadap stack lokal:

```bash
CAP=$(date -u +%Y%m%d-%H%M%SZ)
SRC="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
pg_dump "$SRC" --format=custom --no-owner --no-privileges \
  --schema=public --schema=auth --file="/tmp/padma-$CAP.dump"
psql "$SRC" -c "drop database if exists verifikasi_lokal;" -c "create database verifikasi_lokal;"
pg_restore --no-owner --no-privileges \
  --dbname "postgresql://postgres:postgres@127.0.0.1:54322/verifikasi_lokal" \
  "/tmp/padma-$CAP.dump" 2>/tmp/restore.log || true
psql "postgresql://postgres:postgres@127.0.0.1:54322/verifikasi_lokal" \
  -Atc "select to_regclass('public.clients') is not null;" \
  -Atc "select count(*) from auth.users;"
psql "$SRC" -c "drop database verifikasi_lokal;"
rm -f "/tmp/padma-$CAP.dump"
```

Expected: `t` lalu jumlah user > 0.
Bila `to_regclass` mengembalikan `f`, dump-nya tidak lengkap — **jangan** lanjut
ke Step 4 sebelum ini hijau, dan jangan "memperbaikinya" dengan melonggarkan
verifikasi.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/backup-db.yml
git commit -m "feat(backup): workflow dump-verifikasi-enkripsi-unggah, jadwal masih mati"
```

---

### Task 5: Runbook pemulihan

**Files:**
- Create: `docs/runbook-pemulihan.md`

**Interfaces:**
- Consumes: penamaan objek Task 1, workflow Task 4.
- Produces: tidak ada kode.

- [ ] **Step 1: Tulis runbook**

Buat `docs/runbook-pemulihan.md` dengan isi berikut:

````markdown
# Runbook — Memulihkan Database PADMA dari Backup

> **BACA LEBIH DULU: objek Supabase Storage TIDAK ikut ter-backup.**
> Sesudah pemulihan, setiap e-book akan tampil rusak karena `material_pages`
> menunjuk objek gambar yang tidak ada. Admin **wajib mengunggah ulang seluruh
> PDF materi**. Ini keputusan sadar (spec B3), bukan kegagalan pemulihan.

## Yang Anda butuhkan

- Kunci privat `age` dari password manager. **Tanpa ini tidak ada backup yang
  bisa dibuka** — tidak oleh GitHub, tidak oleh Cloudflare, tidak oleh siapa pun.
- Kredensial R2 yang bisa membaca bucket `padma-backup`.
- Klien PostgreSQL 17 (`psql`, `pg_restore`) dan `age`.

## 1. Pilih backup

Objek bernama `db/<tahun>/<bulan>/padma-YYYYMMDD-HHMMSSZ.dump.age`, cap waktunya
**UTC**. 03:00 WIB = 20:00 UTC hari sebelumnya — perhatikan ini saat memilih
"backup kemarin".

## 2. Unduh dan dekripsi

```bash
age -d -i kunci-privat.txt -o padma.dump padma-YYYYMMDD-HHMMSSZ.dump.age
```

Bila langkah ini gagal, hentikan dan cari kunci yang benar. Jangan menghapus
apa pun sampai satu backup terbukti bisa dibuka.

## 3. Pulihkan ke database KOSONG

Jangan pernah memulihkan ke database yang masih berisi data yang ingin
diselamatkan. Buat yang baru, pulihkan ke sana, periksa, baru alihkan.

```bash
pg_restore --no-owner --no-privileges --dbname "$URL_TUJUAN" padma.dump
```

Galat `role ... does not exist` wajar dan boleh diabaikan: dump sengaja dibuat
`--no-owner --no-privileges`, dan peran Supabase tidak ada di Postgres polos.

## 4. Periksa sebelum mengalihkan trafik

```sql
select count(*) from auth.users;
select count(*) from public.clients;
select count(*) from public.sessions;
select max(created_at) from public.sessions;
```

Baris terakhir memberi tahu sampai kapan data ini mutakhir — bandingkan dengan
kapan kerusakan terjadi.

## 5. Sesudah pulih

1. Unggah ulang seluruh PDF materi (lihat peringatan paling atas).
2. Pastikan satu pasien bisa login dan membuka passport-nya.
3. Jalankan backup manual (`workflow_dispatch`) supaya ada salinan baru dari
   keadaan yang sudah pulih.

## Latihan berkala (WAJIB, tiap kuartal)

Unduh satu backup dan jalankan langkah 2 sampai 4 di database sekali pakai.

Ini bukan formalitas: CI **sengaja** tidak bisa mendekripsi apa pun, jadi
kesalahan pada kunci publik yang terpasang tidak akan pernah membuat satu pun
job merah. Latihan ini satu-satunya cara menemukannya sebelum hari terburuk.
````

- [ ] **Step 2: Commit**

```bash
git add docs/runbook-pemulihan.md
git commit -m "docs(backup): runbook pemulihan, dibuka dengan peringatan Storage"
```

---

## Sesudah seluruh task

Prasyarat yang tersisa di tangan pemilik (spec §11): sandi DB baru, token R2
berlingkup `padma-backup`, pasangan kunci `age`. Lalu jalankan workflow dengan
sumber `contoh`, lalu `produksi`, lalu latihan dekripsi pertama — dan **baru**
hidupkan blok `schedule:`.
