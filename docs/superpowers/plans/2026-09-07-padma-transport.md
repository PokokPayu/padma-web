# Transport, Alamat & Jarak — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat tarif transport mitra bisa dihitung — alamat klien, domisili mitra, jarak, jenjang berjenjang, dan subsidi PADMA — sehingga tagihan sesi akhirnya lengkap.

**Architecture:** Alamat di-geocode SEKALI saat disimpan (Nominatim, gratis) dan koordinatnya disimpan; jarak dihitung LOKAL dengan haversine sebagai fungsi murni. Jenjang muncul sebagai SARAN yang admin boleh timpa dengan alasan tercatat. Sesi menyimpan JENJANG, bukan rupiah — rupiahnya diturunkan dari `transport_rates` menurut tanggal sesi, sehingga money firewall dan doktrin tarif historis terjaga sekaligus.

**Tech Stack:** Next.js App Router (server actions), Supabase/PostgREST, Postgres 15, vitest, `pg` untuk uji struktural, Nominatim (OpenStreetMap) untuk geocoding.

**Spec:** `docs/superpowers/specs/2026-09-07-padma-transport-design.md`

## Global Constraints

Berlaku untuk SETIAP tugas. Melanggarnya memerahkan suite yang sudah ada (99 berkas, 1698 uji).

- **Bahasa Indonesia** untuk nama, komentar, dan pesan. Komentar menjelaskan ALASAN, bukan mekanisme.
- **Money firewall:** panel `/admin` tidak boleh memuat satu nominal pun. Tidak satu kolom nominal pun boleh masuk `sessions`, `booking_requests`, `clients`, atau `partners` — `tests/money-firewall-struktural.test.ts` memindai nama kolom di SELURUH skema dan akan menangkapnya.
- **Cap waktu migrasi ditulis MANUAL** dan lebih besar dari berkas terakhir. Migrasi terakhir saat plan ini ditulis: `20260906160000_varian_wajib.sql`.
- **Supabase memberi hak PENUH kepada `anon`/`authenticated` atas tabel baru** lewat default privileges. Cabut dulu (`revoke all ... from anon, authenticated`), baru beri hak yang tepat.
- **Gerbang peran pada trigger** selalu `current_user not in ('anon','authenticated','authenticator')` → lewatkan. Trigger BUKAN `security definer`.
- **Hak fungsi baru dinyatakan eksplisit:** `revoke all on function ... from public, anon, authenticated;`
- **`requireRole` DI DALAM setiap server action**, bukan sekali di puncak modul. Berkas `"use server"` hanya mengekspor fungsi async; validator murni di `status.ts`.
- **INSERT/UPDATE tertahan RLS dijawab PostgREST 200 + `[]`** — periksa panjang `.select("id")` sebelum melaporkan berhasil.
- **Tidak ada penghapusan** di produk ini; pensiun = `aktif = false`.
- **Batas jenjang (spec T11):** `0–5` termasuk 5,0 km; `>5–10` mulai 5,01. Tepat 5,0 km GRATIS.
- **Subsidi TIDAK disimpan** (spec T9): ia `honor_mitra − tarif_klien`, dihitung saat dibaca.
- TDD wajib. Asersi uji lama tidak boleh dilonggarkan.
- Uji: `npx vitest run tests/<berkas>` fokus; `npm test` seluruh suite sekali sebelum commit.
  **Jangan menggabung `db:recover` dengan `npm test` dalam satu perintah** — gabungan itu melewati
  batas 120 detik alat Bash dan dipindah ke latar oleh alat itu sendiri. Jalankan TERPISAH dengan
  `timeout` eksplisit (suite penuh ~120 detik pada mesin sehat).
- Basis data lokal dipakai bersama; bila `npm test` merah, ULANGI SEKALI sebelum menyebutnya temuan.

---

### Task 1: Jarak & jenjang sebagai fungsi murni

**Files:**
- Create: `web/src/lib/transport/jarak.ts`
- Create: `web/tests/transport-jarak.test.ts`

**Interfaces:**
- Produces:
  - `type Koordinat = { lat: number; lon: number }`
  - `type JenjangTransport = "0_5" | "5_10" | "10_15" | "15_20" | "di_atas_20"`
  - `haversineKm(a: Koordinat, b: Koordinat): number`
  - `jenjangDariJarak(km: number): JenjangTransport`

Tidak menyentuh basis data maupun jaringan. Seluruh tugas berikutnya memakai kedua fungsi ini.

- [ ] **Step 1: Tulis uji yang gagal**

```ts
// web/tests/transport-jarak.test.ts
import { describe, it, expect } from "vitest";
import { haversineKm, jenjangDariJarak } from "@/lib/transport/jarak";

/**
 * Aritmetika jarak diuji sebagai FUNGSI MURNI, tanpa basis data dan tanpa
 * jaringan — di sinilah kesalahan hitung paling mungkin bersembunyi, dan di
 * sini pula ia paling murah ditemukan.
 */
describe("haversineKm", () => {
  it("titik yang sama berjarak nol", () => {
    const t = { lat: -6.9175, lon: 107.6191 };
    expect(haversineKm(t, t)).toBe(0);
  });

  it("jarak yang diketahui: Bandung — Jakarta ≈ 116 km", () => {
    const bandung = { lat: -6.9175, lon: 107.6191 };
    const jakarta = { lat: -6.2088, lon: 106.8456 };
    expect(haversineKm(bandung, jakarta)).toBeGreaterThan(114);
    expect(haversineKm(bandung, jakarta)).toBeLessThan(118);
  });

  it("simetris — urutan argumen tidak mengubah hasil", () => {
    const a = { lat: -6.9, lon: 107.6 };
    const b = { lat: -6.2, lon: 106.8 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });

  it("jarak sangat kecil tetap positif, bukan dibulatkan ke nol", () => {
    const a = { lat: -6.917500, lon: 107.619100 };
    const b = { lat: -6.917600, lon: 107.619100 };
    expect(haversineKm(a, b)).toBeGreaterThan(0);
    expect(haversineKm(a, b)).toBeLessThan(0.05);
  });
});

describe("jenjangDariJarak — batas ditetapkan EKSPLISIT (spec T11)", () => {
  it("tepat 5,0 km masih GRATIS", () => {
    expect(jenjangDariJarak(5)).toBe("0_5");
  });

  it("5,01 km sudah naik jenjang", () => {
    expect(jenjangDariJarak(5.01)).toBe("5_10");
  });

  it("tepat 20,0 km masih jenjang tertinggi bertarif", () => {
    expect(jenjangDariJarak(20)).toBe("15_20");
  });

  it("20,01 km jatuh ke tarif khusus", () => {
    expect(jenjangDariJarak(20.01)).toBe("di_atas_20");
  });

  it("nol km gratis", () => {
    expect(jenjangDariJarak(0)).toBe("0_5");
  });

  it("jarak negatif ditolak — itu bukan jarak", () => {
    expect(() => jenjangDariJarak(-1)).toThrow();
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/transport-jarak.test.ts`
Expected: FAIL — `Cannot find module '@/lib/transport/jarak'`

- [ ] **Step 3: Tulis implementasinya**

```ts
// web/src/lib/transport/jarak.ts

export type Koordinat = { lat: number; lon: number };

export type JenjangTransport = "0_5" | "5_10" | "10_15" | "15_20" | "di_atas_20";

/** Jari-jari rata-rata Bumi dalam kilometer (IUGG mean radius). */
const JARI_JARI_BUMI_KM = 6371.0088;

function keRadian(derajat: number): number {
  return (derajat * Math.PI) / 180;
}

/**
 * Jarak GARIS LURUS antara dua titik di permukaan Bumi.
 *
 * Sengaja BUKAN jarak jalan. Jarak tempuh nyata biasanya 20–40% lebih jauh,
 * tetapi angka pengalinya tebakan — dan tebakan yang ditanam di sini akan
 * terbaca sebagai fakta oleh pembaca berikutnya. Yang dilakukan sistem ini
 * adalah menampilkan angka ini APA ADANYA kepada admin, lalu membiarkan orang
 * yang tahu bahwa 4,2 km ke seberang sungai berarti 9 km memutar untuk
 * memutuskan (spec T5).
 */
export function haversineKm(a: Koordinat, b: Koordinat): number {
  const dLat = keRadian(b.lat - a.lat);
  const dLon = keRadian(b.lon - a.lon);
  const lat1 = keRadian(a.lat);
  const lat2 = keRadian(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * JARI_JARI_BUMI_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Jarak → jenjang tarif.
 *
 * Batasnya ditulis PERSIS seperti materi klien: "0–5 km" lalu ">5–10 km".
 * Karena itu 5,0 km masih gratis dan 5,01 km sudah naik — perbandingannya
 * `<=`, bukan `<`. Menyerahkan batas ini pada pembulatan berarti dua klien
 * berjarak sama ditagih berbeda tergantung pembulatan hari itu.
 */
export function jenjangDariJarak(km: number): JenjangTransport {
  if (!Number.isFinite(km) || km < 0) {
    throw new Error(`Jarak tidak sah: ${km}`);
  }
  if (km <= 5) return "0_5";
  if (km <= 10) return "5_10";
  if (km <= 15) return "10_15";
  if (km <= 20) return "15_20";
  return "di_atas_20";
}
```

- [ ] **Step 4: Jalankan uji, pastikan HIJAU**

Run: `npx vitest run tests/transport-jarak.test.ts`
Expected: PASS, 10 uji

- [ ] **Step 5: Jalankan suite penuh & commit**

```bash
npm test
git add web/src/lib/transport/jarak.ts web/tests/transport-jarak.test.ts
git commit -m "feat(transport): jarak haversine & pemetaan jenjang sebagai fungsi murni"
```

---

### Task 2: Alamat & koordinat pada empat tabel

**Files:**
- Create: `web/supabase/migrations/20260907100000_alamat_dan_koordinat.sql`
- Create: `web/tests/transport-alamat-struktur.test.ts`

**Interfaces:**
- Produces: enum `jenjang_transport` (`0_5`,`5_10`,`10_15`,`15_20`,`di_atas_20`) dan `sumber_jenjang` (`otomatis`,`admin`); kolom alamat + koordinat pada `clients`, `partners`, `booking_requests`, `sessions`; kolom `jenjang`, `jenjang_sumber`, `jenjang_alasan` pada `sessions`; CHECK `sessions_alasan_penimpaan`.

Nilai enum WAJIB sama persis dengan tipe `JenjangTransport` di Task 1 — keduanya adalah satu daftar yang kebetulan hidup di dua bahasa.

- [ ] **Step 1: Tulis uji yang gagal**

```ts
// web/tests/transport-alamat-struktur.test.ts
import { describe, it, expect } from "vitest";
import { querySql, dalamTransaksiRollback } from "./helpers/db";

describe("enum jenjang transport", () => {
  it("berisi lima jenjang, urut dari terdekat", async () => {
    const baris = await querySql<{ label: string }>(
      `select e.enumlabel as label from pg_enum e
         join pg_type t on t.oid = e.enumtypid
        where t.typname = 'jenjang_transport' order by e.enumsortorder`,
    );
    expect(baris.map((b) => b.label)).toEqual(["0_5", "5_10", "10_15", "15_20", "di_atas_20"]);
  });

  it("sumber_jenjang membedakan saran sistem dari penimpaan admin", async () => {
    const baris = await querySql<{ label: string }>(
      `select e.enumlabel as label from pg_enum e
         join pg_type t on t.oid = e.enumtypid
        where t.typname = 'sumber_jenjang' order by e.enumsortorder`,
    );
    expect(baris.map((b) => b.label)).toEqual(["otomatis", "admin"]);
  });
});

describe("kolom alamat & koordinat", () => {
  it.each(["clients", "partners", "booking_requests", "sessions"])(
    "%s punya alamat beserta koordinat yang BOLEH kosong",
    async (tabel) => {
      const kolom = await querySql<{ column_name: string; is_nullable: string }>(
        `select column_name, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = $1
            and column_name like 'alamat%' or (table_name = $1 and column_name in ('lat','lon'))
          order by column_name`,
        [tabel],
      );
      const nama = kolom.map((k) => k.column_name);
      expect(nama.some((n) => n.startsWith("alamat"))).toBe(true);
      // Koordinat WAJIB nullable: geocoding yang gagal tidak boleh menggagalkan
      // penyimpanan alamat (spec T6).
      const koordinat = kolom.filter((k) => /lat$|lon$/.test(k.column_name));
      expect(koordinat.length).toBe(2);
      for (const k of koordinat) expect(k.is_nullable).toBe("YES");
    },
  );
});

describe("penimpaan jenjang menuntut alasan", () => {
  it("menolak jenjang_sumber = 'admin' tanpa alasan", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [k] = (await jalankan(`select id from public.clients limit 1`)) as Array<{ id: string }>;
      const [m] = (await jalankan(`select id from public.partners limit 1`)) as Array<{ id: string }>;
      const [v] = (await jalankan(
        `select service_id, id as variant_id from public.service_variants limit 1`,
      )) as Array<{ service_id: string; variant_id: string }>;

      await expect(
        jalankan(
          `insert into public.sessions
             (client_id, service_id, variant_id, partner_id, tanggal, jenjang, jenjang_sumber)
           values ($1,$2,$3,$4, current_date, '5_10', 'admin')`,
          [k.id, v.service_id, v.variant_id, m.id],
        ),
      ).rejects.toThrow(/sessions_alasan_penimpaan/);
    });
  });

  it("menerima penimpaan yang beralasan", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [k] = (await jalankan(`select id from public.clients limit 1`)) as Array<{ id: string }>;
      const [m] = (await jalankan(`select id from public.partners limit 1`)) as Array<{ id: string }>;
      const [v] = (await jalankan(
        `select service_id, id as variant_id from public.service_variants limit 1`,
      )) as Array<{ service_id: string; variant_id: string }>;

      const hasil = await jalankan(
        `insert into public.sessions
           (client_id, service_id, variant_id, partner_id, tanggal, jenjang, jenjang_sumber, jenjang_alasan)
         values ($1,$2,$3,$4, current_date, '5_10', 'admin', 'Alamat di seberang sungai, memutar lewat jembatan.')
         returning id`,
        [k.id, v.service_id, v.variant_id, m.id],
      );
      expect(hasil).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/transport-alamat-struktur.test.ts`
Expected: FAIL — tipe `jenjang_transport` tidak ada

- [ ] **Step 3: Tulis migrasi**

```sql
-- web/supabase/migrations/20260907100000_alamat_dan_koordinat.sql
-- ============================================================================
-- ALAMAT & KOORDINAT — bahan baku tarif transport
-- ============================================================================
-- Skema hari ini tidak punya satu pun bahan untuk menghitung transport: klien
-- tidak punya alamat rumah, mitra tidak punya domisili, dan jarak tidak ada di
-- mana pun. Akibatnya tagihan sesi tidak pernah lengkap.
--
-- Cap waktu ditulis MANUAL dan lebih besar dari berkas terakhir
-- (20260906160000): `supabase migration new` memakai jam dinding dan pernah
-- menyelipkan migration ke tengah riwayat sehingga `db reset` gagal.

create type jenjang_transport as enum ('0_5','5_10','10_15','15_20','di_atas_20');
create type sumber_jenjang    as enum ('otomatis','admin');

-- Alamat DEFAULT klien: mengisi formulir otomatis, bukan sumber kebenaran
-- sesi. Sesi menyimpan alamatnya sendiri (di bawah) supaya klien yang pindah
-- rumah tidak menulis ulang arti seluruh riwayatnya.
alter table public.clients
  add column alamat     text not null default '',
  add column alamat_lat double precision null,
  add column alamat_lon double precision null;

-- Domisili mitra: titik pangkal perhitungan jarak. Mitra tidak berpindah-
-- pindah, jadi satu alamat sudah cukup.
alter table public.partners
  add column alamat text not null default '',
  add column lat    double precision null,
  add column lon    double precision null;

alter table public.booking_requests
  add column alamat     text not null default '',
  add column alamat_lat double precision null,
  add column alamat_lon double precision null;

alter table public.sessions
  add column alamat         text not null default '',
  add column alamat_lat     double precision null,
  add column alamat_lon     double precision null,
  add column jenjang        jenjang_transport null,
  add column jenjang_sumber sumber_jenjang null,
  add column jenjang_alasan text not null default '';

-- KOORDINAT SENGAJA NULLABLE. Geocoding yang gagal — jaringan, batas laju,
-- atau gang yang memang tidak dikenal OpenStreetMap — TIDAK BOLEH
-- menggagalkan penyimpanan alamat. Alamat adalah data operasional yang mitra
-- butuhkan untuk datang ke tempat yang benar; menolak menyimpannya karena OSM
-- tidak mengenalinya menukar masalah kecil dengan masalah besar. Koordinat
-- kosong berarti satu hal saja: jenjangnya tidak disarankan, dan admin
-- memilih sendiri.
--
-- `jenjang` juga nullable: ia baru terisi saat mitra ditentukan, dan sesi yang
-- belum bermitra memang belum punya jenjang.

-- Penimpaan tanpa alasan adalah penimpaan yang tidak bisa dipelajari. Riwayat
-- alasan inilah yang kelak menjawab pertanyaan yang sekarang tidak bisa
-- dijawab siapa pun: seberapa sering geocoding meleset, dan di wilayah mana.
alter table public.sessions
  add constraint sessions_alasan_penimpaan
  check (jenjang_sumber is distinct from 'admin' or length(btrim(jenjang_alasan)) > 0);

comment on column public.sessions.jenjang is
  'Jenjang jarak mitra→alamat sesi. Data OPERASIONAL, bukan nominal: admin '
  'melihatnya untuk memilih mitra terdekat, dan rupiahnya diturunkan dari '
  'transport_rates menurut TANGGAL SESI. Menyimpan rupiah di sini akan '
  'menabrak money firewall sekaligus membekukan tarif yang seharusnya historis.';
```

- [ ] **Step 4: Reset & jalankan uji, pastikan HIJAU**

Run: `npm run db:recover` (timeout 600000), lalu `npx vitest run tests/transport-alamat-struktur.test.ts`
Expected: PASS

- [ ] **Step 5: Jalankan suite penuh**

Run: `npm test`
Expected: PASS. Uji money firewall struktural akan ikut memeriksa kolom baru — dan harus HIJAU tanpa
perubahan, karena tidak satu pun kolom di atas bernuansa nominal. Bila ia merah, berarti sebuah kolom
salah nama, bukan bahwa ujinya perlu dilonggarkan.

- [ ] **Step 6: Commit**

```bash
git add web/supabase/migrations/20260907100000_alamat_dan_koordinat.sql web/tests/transport-alamat-struktur.test.ts
git commit -m "feat(transport): alamat & koordinat pada klien, mitra, permintaan, dan sesi"
```

---

### Task 3: `transport_rates` beserta seluruh pagar uang

**Files:**
- Create: `web/supabase/migrations/20260907110000_tarif_transport.sql`
- Create: `web/tests/transport-tarif-pengerasan.test.ts`
- Modify: `web/supabase/seed.sql`
- Modify: `web/tests/grant-anon.test.ts`, `web/tests/hak-hapus-berlebih.test.ts`, `web/tests/money-firewall-struktural.test.ts`

**Interfaces:**
- Produces: tabel `public.transport_rates (id, jenjang, tarif_klien, honor_mitra, berlaku_sejak)`; fungsi `guard_tarif_transport_maju()` dan `kunci_riwayat_tarif_transport()`.

**Sebelum menulis:** baca `web/supabase/migrations/20260906120000_tarif_per_varian.sql`. Pagar yang
Anda pasang di sini adalah pagar yang SAMA, dan menuliskannya berbeda berarti dua doktrin uang di
satu proyek.

- [ ] **Step 1: Tulis uji yang gagal**

```ts
// web/tests/transport-tarif-pengerasan.test.ts
import { describe, it, expect } from "vitest";
import { querySql, dalamTransaksiRollback } from "./helpers/db";

async function sebagaiAuthenticated<T>(
  jalankan: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>,
  fn: () => Promise<T>,
): Promise<T> {
  await jalankan("set local role authenticated");
  try {
    return await fn();
  } finally {
    await jalankan("reset role");
  }
}

describe("transport_rates — pagar uang", () => {
  it("honor BOLEH melebihi tarif klien — itulah subsidi PADMA", async () => {
    // Berbeda dari variant_rates, yang justru MENOLAK honor > harga. Pada
    // 0–5 km klien membayar Rp0 sementara mitra menerima Rp10.000; selisihnya
    // subsidi, bukan kekeliruan.
    await dalamTransaksiRollback(async (jalankan) => {
      const hasil = await jalankan(
        `insert into public.transport_rates (jenjang, tarif_klien, honor_mitra, berlaku_sejak)
         values ('0_5', 0, 10000, '2099-01-01') returning id`,
      );
      expect(hasil).toHaveLength(1);
    });
  });

  it("menolak nominal negatif", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      await expect(
        jalankan(
          `insert into public.transport_rates (jenjang, tarif_klien, honor_mitra, berlaku_sejak)
           values ('5_10', -1, 10000, '2099-01-01')`,
        ),
      ).rejects.toThrow(/transport_rates_nilai_wajar/);
    });
  });

  it("menolak tarif kembar pada jenjang & tanggal yang sama", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      await jalankan(
        `insert into public.transport_rates (jenjang, tarif_klien, honor_mitra, berlaku_sejak)
         values ('5_10', 10000, 10000, '2099-01-01')`,
      );
      await expect(
        jalankan(
          `insert into public.transport_rates (jenjang, tarif_klien, honor_mitra, berlaku_sejak)
           values ('5_10', 20000, 10000, '2099-01-01')`,
        ),
      ).rejects.toThrow(/transport_rates_unik_per_tanggal/);
    });
  });

  it("tarif retroaktif ditolak untuk peran API, dilewatkan untuk postgres", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const lolos = await jalankan(
        `insert into public.transport_rates (jenjang, tarif_klien, honor_mitra, berlaku_sejak)
         values ('10_15', 20000, 12000, '1999-01-01') returning id`,
      );
      expect(lolos).toHaveLength(1);

      await sebagaiAuthenticated(jalankan, async () => {
        await expect(
          jalankan(
            `insert into public.transport_rates (jenjang, tarif_klien, honor_mitra, berlaku_sejak)
             values ('10_15', 20000, 12000, '1998-01-01')`,
          ),
        ).rejects.toThrow(/harus berlaku sesudah/);
      });
    });
  });

  it("UPDATE ditolak seluruhnya untuk peran API", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      await sebagaiAuthenticated(jalankan, async () => {
        await expect(
          jalankan(`update public.transport_rates set tarif_klien = 1`),
        ).rejects.toThrow(/append-only/);
      });
    });
  });

  it("anon tidak memegang hak tabel maupun hak kolom", async () => {
    const tabel = await querySql<{ priv: string }>(
      `select p.priv from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as p(priv)
        where has_table_privilege('anon', 'public.transport_rates'::regclass, p.priv)`,
    );
    expect(tabel).toEqual([]);

    const kolom = await querySql<{ kolom: string }>(
      `select c.column_name as kolom from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = 'transport_rates'
          and has_column_privilege('anon', 'public.transport_rates'::regclass, c.column_name, 'SELECT')`,
    );
    expect(kolom).toEqual([]);
  });

  it("authenticated tidak memegang DELETE", async () => {
    const [row] = await querySql<{ boleh: boolean }>(
      `select has_table_privilege('authenticated', 'public.transport_rates'::regclass, 'DELETE') as boleh`,
    );
    expect(row.boleh).toBe(false);
  });

  it("di_atas_20 tidak pernah punya baris tarif — tarifnya per kasus", async () => {
    const baris = await querySql<{ n: string }>(
      `select count(*)::text as n from public.transport_rates where jenjang = 'di_atas_20'`,
    );
    expect(baris[0].n).toBe("0");
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/transport-tarif-pengerasan.test.ts`
Expected: FAIL — `relation "public.transport_rates" does not exist`

- [ ] **Step 3: Tulis migrasi**

```sql
-- web/supabase/migrations/20260907110000_tarif_transport.sql
-- ============================================================================
-- TARIF TRANSPORT — rate card kedua, pagar yang sama dengan yang pertama
-- ============================================================================
-- Pagar di bawah bukan karangan baru: ia salinan pagar `variant_rates`
-- (20260906120000), yang sendiri lahir dari temuan red team dengan bukti
-- tertulis di 20260830150000_pengerasan_tabel_uang.sql. Menuliskannya berbeda
-- berarti dua doktrin uang di satu proyek, dan yang kedua pasti yang lebih
-- lemah.

create table public.transport_rates (
  id            uuid primary key default gen_random_uuid(),
  jenjang       jenjang_transport not null,
  tarif_klien   int not null,
  honor_mitra   int not null,
  berlaku_sejak date not null default current_date,

  constraint transport_rates_unik_per_tanggal unique (jenjang, berlaku_sejak),

  -- SENGAJA TIDAK menuntut `honor_mitra <= tarif_klien`, berbeda dari
  -- variant_rates. Justru sebaliknya yang normal di sini: pada 0–5 km klien
  -- membayar Rp0 sementara mitra menerima Rp10.000. Selisih itu SUBSIDI PADMA,
  -- dan ia tidak disimpan sebagai kolom ketiga — ia dihitung saat dibaca,
  -- supaya tidak ada angka yang bisa berselisih diam-diam dengan dua lainnya.
  constraint transport_rates_nilai_wajar check (tarif_klien >= 0 and honor_mitra >= 0)
);
create index transport_rates_lookup_idx on public.transport_rates(jenjang, berlaku_sejak desc);

create or replace function public.guard_tarif_transport_maju()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  terakhir date;
begin
  if current_user not in ('anon', 'authenticated', 'authenticator') then
    return new;
  end if;

  select max(berlaku_sejak) into terakhir
    from public.transport_rates
   where jenjang = new.jenjang
     and (tg_op = 'INSERT' or id <> new.id);

  if terakhir is not null and new.berlaku_sejak <= terakhir then
    raise exception
      'tarif transport baru harus berlaku sesudah % — rekap pekan lama tidak boleh berubah', terakhir
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_tarif_transport_maju() is
  'Menolak transport_rates ber-berlaku_sejak <= tarif terakhir jenjang yang sama, '
  'dari peran API — owner sekalipun. Tarif retroaktif menggeser rekap pekan yang '
  'honornya SUDAH dibayarkan. Service role dilewatkan: seed & fixture test '
  'menyemai tanggal lampau.';

revoke all on function public.guard_tarif_transport_maju() from public, anon, authenticated;

create trigger trg_guard_tarif_transport_maju
  before insert or update on public.transport_rates
  for each row execute function public.guard_tarif_transport_maju();

create or replace function public.kunci_riwayat_tarif_transport()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    raise exception
      'rate card transport bersifat append-only: tetapkan tarif baru sebagai BARIS BARU, jangan menimpa yang lama'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.kunci_riwayat_tarif_transport() is
  'Menolak SETIAP UPDATE transport_rates dari peran API. Verba UPDATE sengaja '
  'TIDAK dicabut dari authenticated (owner login sebagai peran itu); yang '
  'dimatikan kemampuannya, bukan haknya.';

revoke all on function public.kunci_riwayat_tarif_transport() from public, anon, authenticated;

create trigger trg_kunci_riwayat_tarif_transport
  before update on public.transport_rates
  for each row execute function public.kunci_riwayat_tarif_transport();

alter table public.transport_rates enable row level security;

create policy "transport_rates: hanya owner" on public.transport_rates
  for all to authenticated
  using (user_role() = 'owner') with check (user_role() = 'owner');

revoke all on public.transport_rates from anon;
grant select, insert, update on public.transport_rates to authenticated;
revoke delete on public.transport_rates from authenticated;

comment on table public.transport_rates is
  'RIWAYAT tarif transport per JENJANG. APPEND-ONLY untuk peran API. '
  'Jenjang di_atas_20 sengaja TIDAK pernah punya baris di sini: tarifnya '
  'ditetapkan owner per kasus di transport_khusus, karena "konfirmasi admin" '
  'di materi klien bukan tarif melainkan ketiadaan tarif.';
```

- [ ] **Step 4: Semai tarif awal di `seed.sql`**

Tepat sesudah blok `variant_rates` yang sudah ada, dan idempoten mengikuti pola blok-blok di
sekitarnya:

```sql
-- Tarif transport soft launch, dari materi klien. `di_atas_20` sengaja tidak
-- ada: tarifnya ditetapkan owner per kasus.
--
-- Perhatikan 0–5 km: klien Rp0, mitra Rp10.000. Itu BUKAN salah ketik — ia
-- subsidi PADMA, dan angka ketiganya sengaja tidak disimpan (ia selisih).
insert into transport_rates (jenjang, tarif_klien, honor_mitra) values
  ('0_5',       0, 10000),
  ('5_10',  10000, 10000),
  ('10_15', 20000, 15000),
  ('15_20', 30000, 20000)
  on conflict (jenjang, berlaku_sejak) do nothing;
```

> **Catatan untuk pelaksana:** honor mitra untuk jenjang selain `0_5` BELUM pernah disebut klien
> (spec §2 "Yang tidak dijamin"). Angka di atas adalah semaian PENGEMBANGAN. Tulis itu di komentar
> seed, dan jangan menyalinnya ke produksi tanpa konfirmasi klien.

- [ ] **Step 5: Daftarkan tabel baru di uji hak yang sudah ada**

- `tests/grant-anon.test.ts`: tambahkan `"transport_rates"` ke `TABEL_TERTUTUP_ANON`.
- `tests/hak-hapus-berlebih.test.ts`: tambahkan `transport_rates` ke peta hak tabel uang.
- `tests/money-firewall-struktural.test.ts`: tambahkan `"transport_rates"` ke `TABEL_UANG`. JANGAN
  menyentuh `POLA_NOMINAL`.

- [ ] **Step 6: Reset, jalankan uji, lalu suite penuh**

Run: `npm run db:recover` (timeout 600000), lalu `npx vitest run tests/transport-tarif-pengerasan.test.ts`, lalu `npm test`
Expected: PASS seluruhnya

- [ ] **Step 7: Commit**

```bash
git add web/supabase/migrations/20260907110000_tarif_transport.sql web/supabase/seed.sql web/tests/transport-tarif-pengerasan.test.ts web/tests/grant-anon.test.ts web/tests/hak-hapus-berlebih.test.ts web/tests/money-firewall-struktural.test.ts
git commit -m "feat(transport): rate card transport berjenjang beserta pagar uangnya"
```

---

### Task 4: `transport_khusus` — tarif >20 km yang ditetapkan owner

**Files:**
- Create: `web/supabase/migrations/20260907120000_transport_khusus.sql`
- Create: `web/tests/transport-khusus.test.ts`
- Modify: `web/tests/grant-anon.test.ts`, `web/tests/hak-hapus-berlebih.test.ts`, `web/tests/money-firewall-struktural.test.ts`

**Interfaces:**
- Produces: tabel `public.transport_khusus (session_id, tarif_klien, honor_mitra, ditetapkan_oleh, ditetapkan_pada)`; fungsi `jaga_transport_khusus()`.

- [ ] **Step 1: Tulis uji yang gagal**

```ts
// web/tests/transport-khusus.test.ts
import { describe, it, expect } from "vitest";
import { querySql, dalamTransaksiRollback } from "./helpers/db";

describe("transport_khusus", () => {
  it("identitas penetap DIREBUT dari payload untuk peran API", async () => {
    // Nominal transport >20 km ditetapkan owner per kasus. Siapa yang
    // menetapkannya adalah BUKTI; bukti yang bisa dikarang bukan bukti —
    // pelajaran yang sudah dibayar sekali di honor_marks.
    await dalamTransaksiRollback(async (jalankan) => {
      const [s] = (await jalankan(`select id from public.sessions limit 1`)) as Array<{ id: string }>;
      const [admin] = (await jalankan(
        `select id from auth.users limit 1`,
      )) as Array<{ id: string }>;

      await jalankan("set local role authenticated");
      try {
        await expect(
          jalankan(
            `insert into public.transport_khusus (session_id, tarif_klien, honor_mitra, ditetapkan_oleh)
             values ($1, 50000, 40000, $2)`,
            [s.id, admin.id],
          ),
        ).rejects.toThrow();
      } finally {
        await jalankan("reset role");
      }
    });
  });

  it("menolak nominal negatif", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [s] = (await jalankan(`select id from public.sessions limit 1`)) as Array<{ id: string }>;
      await expect(
        jalankan(
          `insert into public.transport_khusus (session_id, tarif_klien, honor_mitra)
           values ($1, -1, 40000)`,
          [s.id],
        ),
      ).rejects.toThrow(/transport_khusus_nilai_wajar/);
    });
  });

  it("satu sesi hanya boleh punya satu tarif khusus", async () => {
    await dalamTransaksiRollback(async (jalankan) => {
      const [s] = (await jalankan(`select id from public.sessions limit 1`)) as Array<{ id: string }>;
      await jalankan(
        `insert into public.transport_khusus (session_id, tarif_klien, honor_mitra)
         values ($1, 50000, 40000)`,
        [s.id],
      );
      await expect(
        jalankan(
          `insert into public.transport_khusus (session_id, tarif_klien, honor_mitra)
           values ($1, 60000, 45000)`,
          [s.id],
        ),
      ).rejects.toThrow();
    });
  });

  it("anon tidak memegang hak apa pun", async () => {
    const tabel = await querySql<{ priv: string }>(
      `select p.priv from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as p(priv)
        where has_table_privilege('anon', 'public.transport_khusus'::regclass, p.priv)`,
    );
    expect(tabel).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/transport-khusus.test.ts`
Expected: FAIL — relasi tidak ada

- [ ] **Step 3: Tulis migrasi**

```sql
-- web/supabase/migrations/20260907120000_transport_khusus.sql
-- ============================================================================
-- TRANSPORT KHUSUS — nominal >20 km yang ditetapkan OWNER per kasus
-- ============================================================================
-- Materi klien menulis ">20 km: konfirmasi admin". Itu bukan tarif, itu
-- KETIADAAN tarif. Menyerahkan nominalnya kepada admin akan menabrak money
-- firewall — panel /admin tidak boleh memuat satu nominal pun — sementara
-- menolak pengajuannya menutup pintu bagi klien yang justru mau membayar
-- lebih. Owner satu-satunya peran yang boleh menyentuh angka, jadi ia yang
-- memutuskan, per sesi.

create table public.transport_khusus (
  session_id      uuid primary key references public.sessions(id) on delete cascade,
  tarif_klien     int not null,
  honor_mitra     int not null,
  ditetapkan_oleh uuid references auth.users(id),
  ditetapkan_pada timestamptz not null default now(),

  constraint transport_khusus_nilai_wajar check (tarif_klien >= 0 and honor_mitra >= 0)
);

-- `session_id` sebagai primary key: satu sesi, satu tarif khusus. Tidak ada
-- riwayat di sini dan itu disengaja — nominalnya ditetapkan sekali sebelum
-- tagihan terbit, dan mengubahnya sesudah klien membayar adalah persoalan
-- yang berbeda (koreksi bertsempel), bukan pembaruan baris.

create or replace function public.jaga_transport_khusus()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated', 'authenticator') then
    return new;
  end if;

  -- Siapa yang menetapkan nominal adalah BUKTI. Pelajaran yang sudah dibayar
  -- sekali di honor_marks: identitas yang datang dari payload bisa dipalsukan,
  -- dan pemalsuannya permanen karena DELETE dicabut.
  new.ditetapkan_oleh := auth.uid();
  new.ditetapkan_pada := now();
  return new;
end;
$$;

comment on function public.jaga_transport_khusus() is
  'BEFORE INSERT transport_khusus untuk peran API: merebut ditetapkan_oleh & '
  'ditetapkan_pada dari payload. Service role dilewatkan untuk jalur seed & '
  'pemindahan data.';

revoke all on function public.jaga_transport_khusus() from public, anon, authenticated;

create trigger trg_jaga_transport_khusus
  before insert on public.transport_khusus
  for each row execute function public.jaga_transport_khusus();

alter table public.transport_khusus enable row level security;

create policy "transport_khusus: hanya owner" on public.transport_khusus
  for all to authenticated
  using (user_role() = 'owner') with check (user_role() = 'owner');

revoke all on public.transport_khusus from anon;
grant select, insert, update on public.transport_khusus to authenticated;
revoke delete on public.transport_khusus from authenticated;
```

- [ ] **Step 4: Daftarkan di uji hak, reset, jalankan uji, suite penuh**

Tambahkan `"transport_khusus"` ke `TABEL_TERTUTUP_ANON` (`grant-anon.test.ts`), ke peta hak
(`hak-hapus-berlebih.test.ts`), dan ke `TABEL_UANG` (`money-firewall-struktural.test.ts`).

Run: `npm run db:recover`, lalu `npx vitest run tests/transport-khusus.test.ts`, lalu `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/supabase/migrations/20260907120000_transport_khusus.sql web/tests/transport-khusus.test.ts web/tests/grant-anon.test.ts web/tests/hak-hapus-berlebih.test.ts web/tests/money-firewall-struktural.test.ts
git commit -m "feat(transport): tarif khusus >20 km yang ditetapkan owner per sesi"
```

---

### Task 5: Geocoding — cache, batas laju, dan kegagalan yang tercatat

**Files:**
- Create: `web/supabase/migrations/20260907130000_geocode_cache.sql`
- Create: `web/src/lib/transport/alamat.ts`
- Create: `web/src/lib/transport/geocode.ts`
- Create: `web/tests/transport-alamat-normal.test.ts`
- Create: `web/tests/transport-geocode.test.ts`
- Modify: `web/tests/grant-anon.test.ts`

**Interfaces:**
- Consumes: `Koordinat` dari Task 1.
- Produces:
  - `normalkanAlamat(teks: string): string` (murni, di `alamat.ts`)
  - `geocodeAlamat(alamat: string): Promise<Koordinat | null>` (server-only, di `geocode.ts`)

`geocode.ts` WAJIB dibuka `import "server-only"` — pola yang sudah dipakai `src/lib/r2.ts`. Itulah
yang menegakkan "tidak pernah dari browser" di tingkat build, bukan sekadar di tingkat niat.

- [ ] **Step 1: Uji normalisasi alamat (murni) — tulis dulu**

```ts
// web/tests/transport-alamat-normal.test.ts
import { describe, it, expect } from "vitest";
import { normalkanAlamat } from "@/lib/transport/alamat";

/**
 * Normalisasi adalah KUNCI CACHE. Dua ketikan yang secara wajar sama harus
 * menghasilkan kunci yang sama, kalau tidak Nominatim ditanya berkali-kali
 * untuk alamat yang itu-itu juga — pelanggaran batas laju yang lahir dari
 * niat baik.
 */
describe("normalkanAlamat", () => {
  it("mengabaikan beda huruf besar-kecil", () => {
    expect(normalkanAlamat("Jl. Merdeka No. 10")).toBe(normalkanAlamat("jl. merdeka no. 10"));
  });

  it("meratakan spasi berlebih", () => {
    expect(normalkanAlamat("Jl.  Merdeka   No. 10")).toBe(normalkanAlamat("Jl. Merdeka No. 10"));
  });

  it("membuang spasi di ujung", () => {
    expect(normalkanAlamat("  Jl. Merdeka No. 10  ")).toBe(normalkanAlamat("Jl. Merdeka No. 10"));
  });

  it("alamat yang benar-benar berbeda tetap berbeda", () => {
    expect(normalkanAlamat("Jl. Merdeka No. 10")).not.toBe(normalkanAlamat("Jl. Merdeka No. 11"));
  });

  it("alamat kosong memulangkan string kosong", () => {
    expect(normalkanAlamat("   ")).toBe("");
  });
});
```

- [ ] **Step 2: Jalankan, MERAH, lalu tulis `alamat.ts`**

```ts
// web/src/lib/transport/alamat.ts

/**
 * Bentuk kanonik sebuah alamat, dipakai sebagai KUNCI CACHE geocoding.
 *
 * Sengaja konservatif: hanya huruf kecil dan perataan spasi. Normalisasi yang
 * lebih agresif — membuang "Jl.", menyeragamkan "No." — menggabungkan alamat
 * yang MIRIP menjadi satu kunci, dan dua rumah berbeda yang berbagi koordinat
 * adalah salah tagih yang tidak akan pernah terlihat.
 */
export function normalkanAlamat(teks: string): string {
  return teks.trim().toLowerCase().replace(/\s+/g, " ");
}
```

Run: `npx vitest run tests/transport-alamat-normal.test.ts` → PASS

- [ ] **Step 3: Migrasi cache**

```sql
-- web/supabase/migrations/20260907130000_geocode_cache.sql
-- ============================================================================
-- CACHE GEOCODING — termasuk mencatat KEGAGALAN
-- ============================================================================
-- Nominatim gratis dengan syarat wajar: maksimal 1 permintaan per detik dan
-- User-Agent yang mengidentifikasi aplikasi. PADMA menyimpan alamat beberapa
-- kali sehari, jauh di bawah batas itu — SELAMA alamat yang sama tidak
-- ditanyakan berulang.
--
-- Baris ber-lat/lon NULL adalah KEGAGALAN YANG TERCATAT, dan itu disengaja.
-- Tanpa mencatat kegagalan, alamat yang tidak dikenali OSM akan ditanyakan
-- ulang setiap kali formulirnya dibuka — pelanggaran batas laju yang lahir
-- justru dari niat baik.

create table public.geocode_cache (
  alamat_normal text primary key,
  lat           double precision null,
  lon           double precision null,
  sumber        text not null default 'nominatim',
  dicoba_pada   timestamptz not null default now()
);

alter table public.geocode_cache enable row level security;

create policy "geocode_cache: staf" on public.geocode_cache
  for all to authenticated
  using (user_role() in ('admin','owner')) with check (user_role() in ('admin','owner'));

revoke all on public.geocode_cache from anon;
grant select, insert, update on public.geocode_cache to authenticated;
revoke delete on public.geocode_cache from authenticated;

comment on table public.geocode_cache is
  'Hasil geocoding per alamat kanonik. Baris ber-lat/lon NULL berarti alamat '
  'itu SUDAH pernah dicoba dan gagal — mencatatnya mencegah Nominatim '
  'ditanyakan ulang setiap kali formulirnya dibuka.';
```

Tambahkan `"geocode_cache"` ke `TABEL_TERTUTUP_ANON` di `tests/grant-anon.test.ts`.

- [ ] **Step 4: Uji perilaku geocode — tulis dulu**

```ts
// web/tests/transport-geocode.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { geocodeAlamat } from "@/lib/transport/geocode";
import { normalkanAlamat } from "@/lib/transport/alamat";

const svc = createAdminSupabase();
const ALAMAT = "PAD-UJI Jl. Geocode No. 1";
const ALAMAT_GAGAL = "PAD-UJI Alamat Yang Tidak Ada Di Peta Mana Pun";

async function bersihkan() {
  await svc.from("geocode_cache").delete().in("alamat_normal", [
    normalkanAlamat(ALAMAT),
    normalkanAlamat(ALAMAT_GAGAL),
  ]);
}

beforeEach(bersihkan);

describe("geocodeAlamat", () => {
  it("menyimpan hasil ke cache, dan tidak menanya dua kali", async () => {
    const palsu = vi.fn(async () =>
      new Response(JSON.stringify([{ lat: "-6.9175", lon: "107.6191" }]), { status: 200 }),
    );
    vi.stubGlobal("fetch", palsu);

    const pertama = await geocodeAlamat(ALAMAT);
    const kedua = await geocodeAlamat(ALAMAT);

    expect(pertama).toEqual({ lat: -6.9175, lon: 107.6191 });
    expect(kedua).toEqual(pertama);
    // Panggilan kedua dijawab cache — kalau tidak, batas laju Nominatim
    // dilanggar oleh pemakaian normal.
    expect(palsu).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("mengirim User-Agent yang mengidentifikasi PADMA", async () => {
    const palsu = vi.fn(async () =>
      new Response(JSON.stringify([{ lat: "-6.9", lon: "107.6" }]), { status: 200 }),
    );
    vi.stubGlobal("fetch", palsu);

    await geocodeAlamat(ALAMAT);

    const opsi = palsu.mock.calls[0][1] as RequestInit;
    const ua = new Headers(opsi.headers).get("User-Agent") ?? "";
    expect(ua).toMatch(/PADMA/i);

    vi.unstubAllGlobals();
  });

  it("kegagalan DICATAT, sehingga tidak ditanyakan ulang", async () => {
    const palsu = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", palsu);

    expect(await geocodeAlamat(ALAMAT_GAGAL)).toBeNull();
    expect(await geocodeAlamat(ALAMAT_GAGAL)).toBeNull();
    expect(palsu).toHaveBeenCalledTimes(1);

    const { data } = await svc
      .from("geocode_cache")
      .select("lat, lon")
      .eq("alamat_normal", normalkanAlamat(ALAMAT_GAGAL))
      .maybeSingle();
    expect(data).not.toBeNull();
    expect(data!.lat).toBeNull();

    vi.unstubAllGlobals();
  });

  it("galat jaringan memulangkan null, bukan melempar", async () => {
    // Pemanggilnya adalah jalur SIMPAN ALAMAT. Melempar di sini berarti klien
    // gagal menyimpan alamatnya karena OSM sedang bermasalah (spec T6).
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("jaringan mati"); }));
    expect(await geocodeAlamat(ALAMAT)).toBeNull();
    vi.unstubAllGlobals();
  });

  it("alamat kosong tidak pernah memanggil jaringan", async () => {
    const palsu = vi.fn();
    vi.stubGlobal("fetch", palsu);
    expect(await geocodeAlamat("   ")).toBeNull();
    expect(palsu).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 5: Jalankan, MERAH, lalu tulis `geocode.ts`**

```ts
// web/src/lib/transport/geocode.ts
import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { normalkanAlamat } from "./alamat";
import type { Koordinat } from "./jarak";

/**
 * Alamat → koordinat, lewat Nominatim (OpenStreetMap), dengan cache.
 *
 * `import "server-only"` bukan hiasan: dari browser panggilan ini tak
 * terkendali, dan ia mengungkap pemakaian kita kepada pihak ketiga tanpa
 * perlu. Direktif itu membuat impor dari komponen klien GAGAL DI BUILD, bukan
 * gagal diam-diam di produksi.
 *
 * Fungsi ini TIDAK PERNAH melempar. Pemanggilnya adalah jalur simpan alamat,
 * dan alamat adalah data operasional yang mitra butuhkan untuk datang ke
 * tempat yang benar; menolak menyimpannya karena OSM sedang bermasalah
 * menukar masalah kecil dengan masalah besar (spec T6). Kegagalan apa pun
 * berakhir sebagai `null`, yang artinya satu hal saja: jenjangnya tidak
 * disarankan, dan admin memilih sendiri.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

/** Kebijakan Nominatim: maksimal 1 permintaan per detik. */
const JEDA_MINIMAL_MS = 1100;
let terakhirDipanggil = 0;

function userAgent(): string {
  // Kebijakan Nominatim menuntut User-Agent yang mengidentifikasi aplikasi
  // BESERTA cara menghubungi pemiliknya. Tanpa itu permintaan kita berhak
  // ditolak, dan penolakannya akan terlihat seperti "alamat tidak ditemukan".
  return process.env.NOMINATIM_USER_AGENT ?? "PADMA-Wellness/1.0 (admin@padma.test)";
}

async function tungguGiliran(): Promise<void> {
  const sejak = Date.now() - terakhirDipanggil;
  if (sejak < JEDA_MINIMAL_MS) {
    await new Promise((r) => setTimeout(r, JEDA_MINIMAL_MS - sejak));
  }
  terakhirDipanggil = Date.now();
}

export async function geocodeAlamat(alamat: string): Promise<Koordinat | null> {
  const kunci = normalkanAlamat(alamat);
  if (kunci === "") return null;

  const supabase = createAdminSupabase();

  const { data: tersimpan } = await supabase
    .from("geocode_cache")
    .select("lat, lon")
    .eq("alamat_normal", kunci)
    .maybeSingle();

  // Baris yang ADA sudah menjawab, termasuk bila jawabannya "gagal" (lat NULL).
  if (tersimpan) {
    return tersimpan.lat === null || tersimpan.lon === null
      ? null
      : { lat: tersimpan.lat as number, lon: tersimpan.lon as number };
  }

  let hasil: Koordinat | null = null;
  try {
    await tungguGiliran();
    const url = `${NOMINATIM}?q=${encodeURIComponent(alamat)}&format=jsonv2&limit=1&countrycodes=id`;
    const jawaban = await fetch(url, { headers: { "User-Agent": userAgent() } });
    if (jawaban.ok) {
      const isi = (await jawaban.json()) as Array<{ lat: string; lon: string }>;
      if (isi.length > 0) {
        const lat = Number(isi[0].lat);
        const lon = Number(isi[0].lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) hasil = { lat, lon };
      }
    }
  } catch {
    // Sengaja ditelan. Lihat komentar puncak berkas: kegagalan geocoding tidak
    // pernah menggagalkan penyimpanan alamat.
    hasil = null;
  }

  // Kegagalan pun disimpan — itulah yang mencegah alamat tak dikenal
  // ditanyakan ulang setiap kali formulirnya dibuka.
  await supabase.from("geocode_cache").upsert({
    alamat_normal: kunci,
    lat: hasil?.lat ?? null,
    lon: hasil?.lon ?? null,
    dicoba_pada: new Date().toISOString(),
  });

  return hasil;
}
```

- [ ] **Step 6: Jalankan uji, suite penuh, commit**

```bash
npx vitest run tests/transport-geocode.test.ts tests/transport-alamat-normal.test.ts
npm test
git add web/supabase/migrations/20260907130000_geocode_cache.sql web/src/lib/transport web/tests/transport-geocode.test.ts web/tests/transport-alamat-normal.test.ts web/tests/grant-anon.test.ts
git commit -m "feat(transport): geocoding Nominatim dengan cache dan kegagalan yang tercatat"
```

---

### Task 6: Alamat masuk ke jalur tulis

**Files:**
- Modify: `web/src/app/admin/klien/aksi.ts`, `web/src/app/admin/klien/form-klien.tsx`, `web/src/app/admin/klien/status.ts`
- Modify: `web/src/app/admin/mitra/aksi.ts`, `web/src/app/admin/mitra/form-mitra.tsx`, `web/src/app/admin/mitra/status.ts`
- Modify: `web/src/lib/passport/aksi.ts` (`ajukanJadwal`), `web/src/app/passport/ajukan/form.tsx`, `web/src/app/passport/ajukan/page.tsx`
- Modify: `web/src/app/admin/sesi/aksi.ts` (`konfirmasiPermintaan` menyalin alamat permintaan ke sesi)
- Modify: `web/tests/admin-klien.test.ts`, `web/tests/admin-mitra.test.ts`, `web/tests/passport-pembatas-jadwal.test.ts`, `web/tests/admin-sesi-konfirmasi.test.ts`

**Interfaces:**
- Consumes: `geocodeAlamat()` dari Task 5.
- Produces: alamat + koordinat terisi pada `clients`, `partners`, `booking_requests`, dan tersalin ke `sessions` saat permintaan dikonfirmasi.

- [ ] **Step 1: Tulis uji yang gagal**

```ts
// tambahkan di web/tests/passport-pembatas-jadwal.test.ts
it("menyimpan alamat sesi beserta koordinatnya", async () => {
  const hasil = await ajukanJadwal(
    formOf({ layanan: layananId, varian: varianId, tanggal: besok, waktu: "pagi",
             alamat: "Jl. Uji Transport No. 7" }),
  );
  expect(hasil.ok).toBe(true);

  const { data } = await svc.from("booking_requests")
    .select("alamat, alamat_lat, alamat_lon")
    .eq("client_id", klienId).order("created_at", { ascending: false }).limit(1).single();
  expect(data!.alamat).toBe("Jl. Uji Transport No. 7");
});

it("alamat TETAP tersimpan meski geocoding gagal", async () => {
  // Katup pengaman spec T6. Tanpa uji ini ia hanya niat.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("jaringan mati"); }));

  const hasil = await ajukanJadwal(
    formOf({ layanan: layananId, varian: varianId, tanggal: besok, waktu: "pagi",
             alamat: "Jl. Gang Sempit Tanpa Nama" }),
  );
  expect(hasil.ok).toBe(true);

  const { data } = await svc.from("booking_requests")
    .select("alamat, alamat_lat")
    .eq("client_id", klienId).order("created_at", { ascending: false }).limit(1).single();
  expect(data!.alamat).toBe("Jl. Gang Sempit Tanpa Nama");
  expect(data!.alamat_lat).toBeNull();

  vi.unstubAllGlobals();
});
```

Tulis uji setara untuk `simpanMitra`/`perbaruiMitra` (domisili + koordinat) dan
`buatKlien`/`perbaruiKlien` (alamat default + koordinat), serta satu uji bahwa
`konfirmasiPermintaan` MENYALIN alamat dan koordinat dari baris permintaan ke sesi — bukan
mengambilnya ulang dari profil klien, karena klien boleh memesan untuk alamat lain.

- [ ] **Step 2: Jalankan uji, pastikan MERAH**

Run: `npx vitest run tests/passport-pembatas-jadwal.test.ts`
Expected: FAIL — kolom `alamat` tidak terisi

- [ ] **Step 3: Ubah jalur tulis**

Pola yang sama di keempat tempat. Bentuk lengkapnya, memakai `simpanMitra` sebagai contoh:

```ts
// web/src/app/admin/mitra/aksi.ts — di dalam simpanMitra, sesudah validasi nama
const alamat = String(formData.get("alamat") ?? "").trim();

// Geocoding TIDAK PERNAH menggagalkan penyimpanan (spec T6). `geocodeAlamat`
// sudah menelan setiap galatnya dan memulangkan null; yang tersisa di sini
// hanyalah menyimpan apa adanya, termasuk ketika koordinatnya tidak ada.
const koordinat = await geocodeAlamat(alamat);

const { data, error } = await supabase
  .from("partners")
  .insert({
    nama,
    no_hp: noHp,
    alamat,
    lat: koordinat?.lat ?? null,
    lon: koordinat?.lon ?? null,
  })
  .select("id");
```

Untuk `clients` nama kolomnya `alamat_lat`/`alamat_lon`; untuk `booking_requests` sama. Alamat
KOSONG dibolehkan di profil klien dan mitra — ia terisi menyusul; alamat WAJIB hanya pada pengajuan
jadwal, divalidasi di `status.ts` sebagai fungsi murni:

```ts
// web/src/lib/passport/status.ts (atau status.ts modul terkait)
export function periksaAlamat(mentah: string): { ok: true; nilai: string } | { ok: false; pesan: string } {
  const teks = mentah.trim();
  // Mitra harus bisa sampai ke sana. Alamat sependek "rumah" bukan alamat.
  if (teks.length < 10) {
    return { ok: false, pesan: "Alamat terlalu pendek — tuliskan alamat yang bisa dituju mitra." };
  }
  return { ok: true, nilai: teks };
}
```

`konfirmasiPermintaan` di `admin/sesi/aksi.ts` menyalin `alamat`, `alamat_lat`, `alamat_lon` dari
baris permintaan ke sesi yang diterbitkan — mengikuti pola `variant_id` yang sudah ada di sana, yang
juga diambil DARI BARIS, bukan dari payload.

- [ ] **Step 4: Jalankan uji, pastikan HIJAU; lalu suite penuh**

Run: `npx vitest run tests/passport-pembatas-jadwal.test.ts tests/admin-mitra.test.ts tests/admin-klien.test.ts tests/admin-sesi-konfirmasi.test.ts`, lalu `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/app/admin/klien web/src/app/admin/mitra web/src/lib/passport/aksi.ts web/src/app/passport/ajukan web/src/app/admin/sesi/aksi.ts web/tests
git commit -m "feat(transport): alamat & koordinat terisi di jalur tulis klien, mitra, dan pengajuan"
```

---

### Task 7: Saran jenjang & penimpaan admin

**Files:**
- Create: `web/src/lib/transport/saran.ts`
- Create: `web/tests/transport-saran.test.ts`
- Modify: `web/src/app/admin/sesi/aksi.ts`, `web/src/app/admin/sesi/form-sesi.tsx`, `web/src/app/admin/sesi/status.ts`
- Modify: `web/tests/admin-sesi-catatan.test.ts`

**Interfaces:**
- Consumes: `haversineKm`, `jenjangDariJarak` (Task 1).
- Produces: `saranJenjang(mitra: Koordinat | null, sesi: Koordinat | null): { jarakKm: number; jenjang: JenjangTransport } | null` — `null` bila salah satu koordinat kosong.

- [ ] **Step 1: Tulis uji yang gagal**

```ts
// web/tests/transport-saran.test.ts
import { describe, it, expect } from "vitest";
import { saranJenjang } from "@/lib/transport/saran";

describe("saranJenjang", () => {
  it("memulangkan jarak dan jenjang bila kedua koordinat ada", () => {
    const hasil = saranJenjang({ lat: -6.9175, lon: 107.6191 }, { lat: -6.9175, lon: 107.6191 });
    expect(hasil).toEqual({ jarakKm: 0, jenjang: "0_5" });
  });

  it("memulangkan null bila koordinat mitra kosong", () => {
    expect(saranJenjang(null, { lat: -6.9, lon: 107.6 })).toBeNull();
  });

  it("memulangkan null bila koordinat sesi kosong", () => {
    expect(saranJenjang({ lat: -6.9, lon: 107.6 }, null)).toBeNull();
  });
});
```

- [ ] **Step 2: MERAH, lalu tulis `saran.ts`**

```ts
// web/src/lib/transport/saran.ts
import { haversineKm, jenjangDariJarak, type Koordinat, type JenjangTransport } from "./jarak";

/**
 * SARAN jenjang untuk admin — bukan keputusan.
 *
 * Memulangkan `null` bila salah satu koordinat kosong, dan itu bukan galat:
 * geocoding yang gagal berarti sistem tidak punya pendapat, dan admin memilih
 * sendiri tanpa satu pun pesan merah (spec T4, T6).
 *
 * `jarakKm` ikut dipulangkan supaya layar bisa menampilkannya APA ADANYA.
 * Itu bagian dari desainnya: jarak garis lurus yang terlihat memberi admin
 * bahan untuk menilai kapan angkanya menyesatkan — 4,2 km ke seberang sungai
 * berarti 9 km memutar — dan penilaian itu memang miliknya, bukan milik kita.
 */
export function saranJenjang(
  mitra: Koordinat | null,
  sesi: Koordinat | null,
): { jarakKm: number; jenjang: JenjangTransport } | null {
  if (!mitra || !sesi) return null;
  const jarakKm = haversineKm(mitra, sesi);
  return { jarakKm, jenjang: jenjangDariJarak(jarakKm) };
}
```

- [ ] **Step 3: Uji penimpaan di server action — tulis dulu**

```ts
// tambahkan di web/tests/admin-sesi-catatan.test.ts
it("menyimpan jenjang beserta sumbernya saat admin menimpa saran", async () => {
  const r = await tetapkanJenjang(
    formOf({ sesi: sesiId, jenjang: "10_15", alasan: "Alamat di seberang sungai, memutar." }),
  );
  expect(r.ok).toBe(true);

  const { data } = await svc.from("sessions")
    .select("jenjang, jenjang_sumber, jenjang_alasan").eq("id", sesiId).single();
  expect(data!.jenjang).toBe("10_15");
  expect(data!.jenjang_sumber).toBe("admin");
  expect(data!.jenjang_alasan).toMatch(/sungai/);
});

it("menolak penimpaan tanpa alasan, dengan KALIMAT", async () => {
  const r = await tetapkanJenjang(formOf({ sesi: sesiId, jenjang: "10_15", alasan: "  " }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.pesan).toMatch(/alasan/i);
});

it("tidak memuat satu nominal pun di sumber modulnya", async () => {
  // Money firewall: admin menetapkan JENJANG, tidak pernah rupiah.
  const sumber = await baca("src/app/admin/sesi/form-sesi.tsx");
  expect(sumber).not.toContain("transport_rates");
  expect(sumber).not.toContain("tarif_klien");
});
```

- [ ] **Step 4: MERAH, lalu tulis `tetapkanJenjang`**

Di `admin/sesi/aksi.ts`, mengikuti keenam aturan berkas itu: `requireRole(["admin","owner"])` di
dalam action; alasan divalidasi di `status.ts` sebagai fungsi murni; `jenjang_sumber` ditulis mati
sebagai `'admin'` — keadaan tujuan tidak pernah datang dari FormData; panjang `.select("id")`
diperiksa. CHECK basis data dari Task 2 tetap lapisan terakhir.

- [ ] **Step 5: Layar**

`form-sesi.tsx` menampilkan tiga hal berdampingan saat mitra dipilih: jarak garis lurus, jenjang yang
disarankan, dan pemilih jenjang. Bila `saranJenjang()` memulangkan `null`, saran tidak muncul dan
pemilih tetap ada — tanpa pesan galat.

**Nol nominal di layar ini.** Admin melihat "5–10 km", tidak pernah "Rp10.000".

- [ ] **Step 6: Suite penuh & commit**

```bash
npm test
git add web/src/lib/transport/saran.ts web/src/app/admin/sesi web/tests
git commit -m "feat(transport): saran jenjang dari jarak, penimpaan admin beralasan"
```

---

### Task 8: Owner — rate card transport & tarif khusus

**Files:**
- Create: `web/src/app/owner/transport/page.tsx`, `aksi.ts`, `status.ts`, `form-tarif-transport.tsx`
- Modify: `web/src/lib/owner/data.ts` (`ambilTarifTransport`, `ambilSesiMenungguTarif`)
- Modify: `web/src/app/owner/_shell/` (satu tujuan navigasi baru)
- Modify: `web/src/lib/admin/antrean.ts` (hitungan sesi menunggu tarif khusus)
- Create: `web/tests/owner-transport.test.ts`
- Modify: `web/tests/owner-kerangka.test.ts`, `web/tests/inventaris-rute.test.ts`

**Interfaces:**
- Consumes: `transport_rates`, `transport_khusus` (Task 3, 4).
- Produces:
  - `tetapkanTarifTransport(formData): Promise<{ok:true}|{ok:false;pesan:string}>`
  - `tetapkanTarifKhusus(formData): Promise<{ok:true}|{ok:false;pesan:string}>`
  - `type BarisTarifTransport = { jenjang: JenjangTransport; tarifKlien: number; honorMitra: number; subsidi: number; berlakuSejak: string }` — `subsidi` adalah field TERHITUNG (`honorMitra − tarifKlien`), bukan kolom (spec T9)
  - `ambilTarifTransport(): Promise<BarisTarifTransport[]>`
  - `type SesiMenungguTarif = { id: string; namaKlien: string; tanggal: string }` — tanpa satu pun nominal, karena daftar ini juga dibaca antrean admin
  - `ambilSesiMenungguTarif(): Promise<SesiMenungguTarif[]>`

- [ ] **Step 1: Tulis uji yang gagal**

```ts
// web/tests/owner-transport.test.ts — inti yang harus ada
it("tarif transport baru lahir sebagai BARIS BARU, bukan menimpa", async () => {
  const sebelum = await tarifJenjang("5_10");
  await tetapkanTarifTransport(formOf({ jenjang: "5_10", tarif: "15000", honor: "12000", mulai: besok }));
  const sesudah = await tarifJenjang("5_10");
  expect(sesudah.length).toBe(sebelum.length + 1);
});

it("menolak tarif bertanggal mundur, dengan KALIMAT", async () => {
  const r = await tetapkanTarifTransport(
    formOf({ jenjang: "5_10", tarif: "15000", honor: "12000", mulai: "2020-01-01" }),
  );
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.pesan).toMatch(/sesudah/i);
});

it("subsidi dihitung sebagai selisih, bukan dibaca dari kolom", async () => {
  const baris = (await ambilTarifTransport()).find((b) => b.jenjang === "0_5")!;
  expect(baris.subsidi).toBe(baris.honorMitra - baris.tarifKlien);
  expect(baris.subsidi).toBe(10000);
});

it("sesi di_atas_20 tanpa tarif khusus muncul di daftar menunggu", async () => {
  const menunggu = await ambilSesiMenungguTarif();
  expect(menunggu.map((s) => s.id)).toContain(sesiJauhId);
});

it("admin TIDAK bisa membaca transport_rates", async () => {
  const a = await signInAs("admin@padma.test");
  const { data } = await a.from("transport_rates").select("tarif_klien");
  expect(data ?? []).toHaveLength(0);
});
```

- [ ] **Step 2: MERAH → implementasi**

`tetapkanTarifTransport` mengikuti `tetapkanTarif` varian PERSIS: INSERT-only, tanggal tidak boleh
mundur diperiksa di action supaya jawabannya kalimat, panjang `.select("id")` diperiksa, sesi
pengguna bukan service role. `tetapkanTarifKhusus` sama, plus `session_id` diverifikasi ada dan
sesinya benar-benar berjenjang `di_atas_20`.

`ambilTarifTransport()` memulangkan `subsidi` sebagai **field terhitung**, bukan kolom (spec T9).

- [ ] **Step 3: Antrean**

`hitungAntrean()` di `lib/admin/antrean.ts` bertambah satu angka: sesi berjenjang `di_atas_20` yang
belum punya baris `transport_khusus`. Saringannya WAJIB identik dengan `ambilSesiMenungguTarif()` —
komentar puncak berkas itu menjelaskan kenapa: badge yang menghitung sesuatu yang tidak pernah muncul
di daftarnya tidak bisa dibersihkan, dan alarm yang tidak bisa dipadamkan berhenti dipercaya.

**Angkanya, bukan nominalnya.** Antrean admin menampilkan CACAH sesi, bukan rupiah.

- [ ] **Step 4: Suite penuh & commit**

```bash
npm test
git add web/src/app/owner web/src/lib/owner/data.ts web/src/lib/admin/antrean.ts web/tests
git commit -m "feat(owner): rate card transport, tarif khusus >20 km, dan antreannya"
```

---

### Task 9: Tagihan & rekap memuat transport

**Files:**
- Modify: `web/src/lib/owner/rekap.ts`, `web/src/lib/owner/data.ts`
- Modify: `web/src/lib/passport/turunan.ts`, `web/src/lib/admin/tagihan.ts`
- Modify: `web/tests/owner-rekap.test.ts`, `web/tests/owner-rekap-halaman.test.ts`, `web/tests/admin-bayar.test.ts`

**Interfaces:**
- Consumes: `transport_rates`, `transport_khusus`, `sessions.jenjang`.
- Produces: `SesiRekap` bertambah `jenjang: JenjangTransport | null`; `tarifTransportPadaTanggal(tarif, jenjang, tanggal)` — SATU definisi, sejajar `tarifPadaTanggal()` yang sudah ada.

- [ ] **Step 1: Tulis uji yang gagal**

```ts
// web/tests/owner-rekap.test.ts — inti
it("honor mitra memuat komponen transport menurut TANGGAL SESI", () => {
  const rekap = hitungRekap({ sesi: [sesiA], tarif: [tarifVarian], tarifTransport, tanda: [] });
  expect(rekap.perMitra[0].honor).toBe(HONOR_VARIAN + HONOR_TRANSPORT);
});

it("menaikkan tarif transport TIDAK menggeser rekap pekan lalu", () => {
  const rekap = hitungRekap({
    sesi: [sesiPekanLalu], tarif: [tarifVarian],
    tarifTransport: [transportLama, transportBaru], tanda: [],
  });
  expect(rekap.perMitra[0].honor).toBe(HONOR_VARIAN + HONOR_TRANSPORT_LAMA);
});

it("subsidi 0–5 km muncul sebagai selisih, bukan kolom", () => {
  const rekap = hitungRekap({ sesi: [sesiDekat], tarif: [tarifVarian], tarifTransport, tanda: [] });
  // Klien membayar Rp0, mitra menerima Rp10.000 → margin berkurang 10.000.
  expect(rekap.margin).toBe(HARGA_VARIAN - HONOR_VARIAN - 10000);
});

it("sesi di_atas_20 tanpa tarif khusus TIDAK dihitung sebagai transport nol", () => {
  // Nol yang salah lebih berbahaya daripada nol yang jujur: ia terlihat benar.
  const rekap = hitungRekap({ sesi: [sesiJauh], tarif: [tarifVarian], tarifTransport, tanda: [] });
  expect(rekap.perMitra[0].adaTarifTertunda).toBe(true);
});
```

- [ ] **Step 2: MERAH → implementasi**

`tarifTransportPadaTanggal()` ditulis SEKALI dan dipakai bersama rate card maupun rekap — aturan
"berlaku_sejak terbesar yang ≤ tanggal" tidak boleh punya dua definisi. Alasannya tertulis di
`lib/owner/data.ts` dan berlaku sama di sini: dua definisi berpisah diam-diam, dan perpisahannya
berbentuk layar yang menampilkan satu angka sementara honor dibayarkan dengan angka lain.

Agregasinya tetap **fungsi murni di TypeScript**, bukan view SQL.

Tagihan klien (`passport/turunan.ts`) dan tagihan admin (`admin/tagihan.ts`) menambahkan baris
transport. **Label keduanya tetap identik** — uji parity yang sudah ada di `admin-bayar.test.ts`
menjaganya, dan menambah baris di satu sisi saja akan memerahkannya. Itu memang gunanya.

- [ ] **Step 3: Suite penuh & commit**

```bash
npm test
git add web/src/lib/owner web/src/lib/passport/turunan.ts web/src/lib/admin/tagihan.ts web/tests
git commit -m "feat(transport): honor & tagihan memuat transport menurut tanggal sesi"
```

---

### Task 10: Atribusi OSM & verifikasi menyeluruh

**Files:**
- Modify: layar yang menampilkan hasil geocoding (`admin/sesi/form-sesi.tsx`, `admin/klien`, `admin/mitra`)
- Create: `web/tests/transport-atribusi.test.ts`

- [ ] **Step 1: Uji atribusi**

```ts
// web/tests/transport-atribusi.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Data OpenStreetMap menuntut ATRIBUSI. Ini kewajiban lisensi, bukan pilihan
 * desain — dan satu-satunya yang di seluruh rencana ini bukan soal teknis.
 */
describe("atribusi OpenStreetMap", () => {
  it.each([
    "src/app/admin/sesi/form-sesi.tsx",
    "src/app/admin/klien/form-klien.tsx",
    "src/app/admin/mitra/form-mitra.tsx",
  ])("%s memuat atribusi OSM", (berkas) => {
    const sumber = readFileSync(berkas, "utf8");
    expect(sumber).toMatch(/OpenStreetMap/);
  });
});
```

- [ ] **Step 2: MERAH → tambahkan atribusi, lalu HIJAU**

Teks: "© OpenStreetMap contributors", ditempatkan dekat medan alamat atau tampilan jarak.

- [ ] **Step 3: Verifikasi menyeluruh**

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Lalu, dengan dev server hidup dan basis data yang tidak dipakai proses lain:

```bash
npm run test:e2e:semua
```

- [ ] **Step 4: Commit**

```bash
git add web/src/app/admin web/tests/transport-atribusi.test.ts
git commit -m "feat(transport): atribusi OpenStreetMap pada layar yang menampilkan hasil geocoding"
```

---

## Verifikasi penutup

- [ ] `npm test` hijau seluruhnya
- [ ] `npm run test:e2e:semua` hijau (jalankan SENDIRIAN — dua run yang bertumpang tindih saling menghapus fixture)
- [ ] `npx tsc --noEmit` bersih, `npm run lint` bersih, `npm run build` berhasil
- [ ] Panel `/admin` dibuka sebagai admin: jenjang terlihat, **nol nominal transport**
- [ ] Panel `/owner`: rate card transport terisi, subsidi 0–5 km tampil sebagai selisih Rp10.000
- [ ] Sesi berjenjang `di_atas_20` muncul di antrean dan tagihannya tertahan sampai owner mengisi
- [ ] Alamat dengan geocoding gagal tetap tersimpan, dan jenjangnya bisa ditetapkan admin
