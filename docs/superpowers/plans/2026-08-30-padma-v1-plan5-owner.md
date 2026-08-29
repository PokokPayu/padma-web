# PADMA v1 — Plan 5: Panel Owner (Rate Card, Rekap Honor, Margin)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pemilik PADMA bisa menetapkan tarif layanan, melihat rekap honor mitra per pekan yang dihitung dengan tarif yang berlaku **pada tanggal sesi**, menandai honor yang sudah dibayar, dan melihat margin — tanpa satu pun nominal bocor ke admin atau klien.

**Architecture:** Rute `/owner/*` dengan shell sendiri. Seluruh agregasi uang dihitung di **TypeScript**, bukan view SQL — view milik `postgres` berjalan dengan hak pemilik dan **melewati RLS** (terbukti: admin membaca 10 baris rate card lengkap lewat view biasa), dan `tests/money-firewall-struktural.test.ts` juga memindai VIEW sehingga kolom bernama `total_honor`/`total_harga` langsung memerahkan suite.

**Tech Stack:** Next.js 16 (App Router, TypeScript, Tailwind v4), Supabase (Postgres+RLS), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-padma-v1-design.md` (bagian 5 & 6 alur 4, keputusan #6)
**Plan sebelumnya (semuanya sudah dieksekusi):** `plan1-fondasi`, `plan2-landing-skrining`, `plan3a-admin-inti`, `plan3b-admin-pelengkap`, `plan4-passport`
**Rujukan desain:** `padma-prototype.html` — `<section id="scr-owner">`, fungsi `vRekap`, `rekapPekan`, `tandaiBayar`, `vRate`, `simpanRate`.

**Keadaan repo saat plan ditulis (terverifikasi):** 24 migration, 56 berkas test, 5 skrip E2E, 1109 test hijau, 22 halaman. Migration baru bercap waktu **manual** lebih besar dari `20260830140000`.

## Global Constraints

- Seluruh teks UI berbahasa **Indonesia**.
- **`await requireRole(["owner"])` wajib menjadi baris pertama SETIAP server action Plan 5** — bukan `["admin","owner"]`. Layout **tidak** menjaga server action: dibuktikan dengan mem-POST action panel admin dari rute lain sebagai admin, dan mutasinya berhasil. Panel owner yang bersandar pada `owner/layout.tsx` akan bisa dioperasikan admin.
- **Agregasi uang dihitung di TypeScript.** Dilarang membuat VIEW berkolom uang (melewati RLS **dan** memerahkan money-firewall struktural). Bila RPC tak terhindarkan, wajib `revoke execute ... from public, anon`.
- **Tabel baru lahir TANPA RLS** dan `authenticated` mendapat SELECT/INSERT/UPDATE secara default — terverifikasi. Setiap tabel Plan 5 wajib: `enable row level security` + `revoke all from anon, authenticated` + grant sempit + policy `user_role() = 'owner'`.
- **Dilarang mencabut hak tabel `authenticated` dari `service_rates`/`honor_marks`.** Owner login sebagai peran SQL yang sama; saran ini sudah dibantah dengan bukti dan bantahannya terpasang permanen di `tests/hak-hapus-berlebih.test.ts`. Verba DELETE **sudah** tercabut (owner pun 42501) — itu keadaan yang benar, bukan bug.
- **UPDATE yang tertahan RLS dijawab HTTP 200 + `[]`, bukan error.** Setiap action wajib `.select("id")` lalu memeriksa panjangnya sebelum melaporkan sukses.
- Berkas `"use server"` hanya mengekspor fungsi async; daftar putih & label di `status.ts`.
- **`src/app/owner/layout.tsx` harus memanggil `requireRole` tepat satu kali dengan argumen persis `["owner"]`** — `tests/access-matrix-layouts.test.ts` mem-parsing sumbernya. Sub-rute `/owner/*` mewarisi guard itu; `src/proxy.ts` sudah memuat `/owner` dengan pencocokan `startsWith`.
- **Teks "Panel Owner" harus tetap ada di `/owner`** — `tests/e2e/access-matrix.e2e.ts` meng-assert-nya.
- **Waktu:** dilarang `toISOString`/`setDate`/`getDay` untuk logika tanggal. `mondayOf` prototipe **terbukti salah** di zona barat (`2026-08-30` menghasilkan `2026-08-25`, yang bahkan bukan Senin). Pakai perhitungan berbasis string + `hariIniJakarta()`.
- Penamaan kolom baru menghindari regex money-firewall; `status_bayar` hanya di `client_packages` & `sessions`.
- Data uji berprefiks + dibersihkan `afterAll`, termasuk baris `jejak_status_bayar` (tabel tanpa FK).
- Akun demo: `owner@`/`admin@`/`ananda@padma.test`, password `padma-dev-123`.

## Keadaan Tabel Uang Hari Ini (diuji, bukan dibaca)

`service_rates` dan `honor_marks` **tidak punya satu pun constraint** selain PK dan FK. Terverifikasi lewat REST sebagai owner — semuanya masuk tanpa error:

| Yang lolos hari ini | Akibatnya |
|---|---|
| Dua tarif dengan `(service_id, berlaku_sejak)` sama | Pemilihan "berlaku_sejak terbesar" jadi **non-deterministik** (tidak ada `created_at` pemecah seri) |
| Tarif negatif, dan honor > harga (margin negatif) | Rekap menampilkan angka mustahil tanpa peringatan |
| `berlaku_sejak` retroaktif (`2020-01-01`) | Efeknya **sama persis** dengan mengubah baris lama — rekap pekan lama ikut berubah, melanggar spec |
| `honor_marks.week_start` bukan hari Senin | Tanda bayar yatim yang tidak pernah cocok dengan bucket rekap mana pun |
| `ditandai_oleh` & `dibayar_pada` dari payload | Owner bisa menandai honor **atas nama admin**, bertanggal 1999 |

Menandai dua kali melempar `23505` (bukan no-op); DELETE tanda ditolak `42501` — **tidak ada jalur "batalkan", jangan rancang tombolnya.**

---

### Task 1: Pengerasan tabel uang + pagar RLS menyeluruh

**Files:**
- Create: `web/supabase/migrations/20260830150000_pengerasan_tabel_uang.sql`, `web/tests/owner-pengerasan.test.ts`, `web/tests/struktur-rls.test.ts`

- [ ] **Step 1: Test dulu (MERAH)**

Buat `web/tests/owner-pengerasan.test.ts` yang membuktikan — tulis assertion lengkapnya:
- tarif kembar `(service_id, berlaku_sejak)` ditolak `23505`;
- tarif negatif ditolak `23514`; honor > harga ditolak `23514`;
- `berlaku_sejak` lebih awal dari tarif terakhir layanan itu ditolak `42501` (retroaktif = mengubah masa lalu);
- `berlaku_sejak` hari ini atau ke depan **diterima** (alur sah tidak rusak);
- `honor_marks.week_start` bukan Senin ditolak `23514`;
- owner tetap bisa membaca & menyisipkan tarif; admin & klien tetap `[]`; anon tetap `42501`;
- service role tetap bebas (seed & pembersihan test bergantung padanya).

Buat `web/tests/struktur-rls.test.ts` — pagar struktural baru:
```ts
import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";

// Tabel baru lahir TANPA RLS dan `authenticated` mendapat SELECT/INSERT/UPDATE
// secara default. Kelalaian itu lolos 1109 test karena tidak ada satu pun yang
// menjaganya. Pagar ini menutup kelas bug itu untuk selamanya.
describe("invarian struktural: tidak ada tabel tanpa RLS", () => {
  it("setiap tabel di schema public mengaktifkan row level security", async () => {
    const tanpaRls = await querySql<{ relname: string }>(`
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
       order by c.relname`);
    expect(tanpaRls.map((t) => t.relname)).toEqual([]);
  });

  // Tabel yang SENGAJA terkunci mati: RLS aktif tanpa policy sama sekali,
  // sehingga tidak ada peran API yang bisa menyentuhnya — hanya service role.
  // Ini keputusan desain, bukan kelalaian. Daftar ini harus tetap PENDEK;
  // menambahkan nama ke sini wajib disertai alasan.
  const SENGAJA_TERKUNCI = [
    // Token undangan disimpan sebagai SHA-256 dan tidak boleh terbaca peran
    // API mana pun, termasuk admin. Penerbitannya lewat server action
    // service-role yang mengembalikan token mentah sekali saja.
    "client_invites",
  ];

  it("tabel ber-RLS tanpa policy hanya yang sengaja terkunci", async () => {
    const tanpaPolicy = await querySql<{ relname: string }>(`
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = true
         and not exists (select 1 from pg_policies p
                          where p.schemaname = 'public' and p.tablename = c.relname)
       order by c.relname`);
    expect(tanpaPolicy.map((t) => t.relname)).toEqual(SENGAJA_TERKUNCI);
  });
});
```

**Sudah diperiksa terhadap DB nyata:** hari ini nol tabel tanpa RLS, dan satu-satunya tabel ber-RLS tanpa policy adalah `client_invites` — persis daftar di atas. Kedua test akan hijau begitu ditulis; nilainya adalah menjaga tabel Plan 5 (dan seterusnya) tidak lahir tanpa RLS, kelalaian yang hari ini lolos 1109 test karena tidak ada yang menjaganya.

- [ ] **Step 2: Migration**

```sql
-- ============================================================================
-- PENGERASAN TABEL UANG
-- ============================================================================
-- service_rates & honor_marks tidak punya satu pun constraint selain PK & FK.
-- Terverifikasi lewat REST sebagai owner: tarif kembar, tarif negatif, margin
-- negatif, berlaku_sejak retroaktif, dan week_start bukan-Senin SEMUANYA masuk.

-- (1) Tarif kembar membuat pemilihan "berlaku_sejak terbesar" non-deterministik
--     karena tidak ada created_at pemecah seri.
alter table public.service_rates
  add constraint service_rates_unik_per_tanggal unique (service_id, berlaku_sejak);

-- (2) Angka mustahil.
alter table public.service_rates
  add constraint service_rates_nilai_wajar
  check (harga_klien >= 0 and honor_mitra >= 0 and honor_mitra <= harga_klien);

-- (3) week_start wajib Senin. Tanpa ini, UNIQUE (partner_id, week_start) bisa
--     dilewati dengan tanggal lain dalam pekan yang sama, dan tanda bayarnya
--     menjadi yatim — tidak pernah cocok dengan bucket rekap mana pun.
--     extract(isodow) = 1 berarti Senin.
alter table public.honor_marks
  add constraint honor_marks_awal_pekan_senin
  check (extract(isodow from week_start) = 1);

-- (4) Tarif retroaktif. "Insert baris baru, jangan update" SAJA TIDAK CUKUP:
--     owner terbukti bisa menyisipkan berlaku_sejak='2020-01-01', yang efeknya
--     sama persis dengan mengubah baris lama — rekap pekan yang sudah dibayar
--     ikut berubah. Spec bagian 5 menuntut rekap lama tidak berubah.
create or replace function public.guard_tarif_maju()
returns trigger
language plpgsql
as $$
declare
  terakhir date;
begin
  -- Gerbang peran SQL wajib: tanpa ini seed & pembersihan test (service role) mati.
  if current_user not in ('anon', 'authenticated', 'authenticator') then
    return new;
  end if;

  select max(berlaku_sejak) into terakhir
    from public.service_rates
   where service_id = new.service_id
     and (tg_op = 'INSERT' or id <> new.id);

  if terakhir is not null and new.berlaku_sejak <= terakhir then
    raise exception 'tarif baru harus berlaku setelah % — rekap pekan lama tidak boleh berubah', terakhir
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_tarif_maju() from public, anon;

create trigger trg_guard_tarif_maju
  before insert or update on public.service_rates
  for each row execute function public.guard_tarif_maju();
```

**Periksa dulu:** apakah data seed melanggar salah satu constraint (mis. ada layanan dengan honor > harga)? Jalankan query pemeriksa **sebelum** memasang, dan bila ada pelanggar perbaiki datanya di migration — jangan melonggarkan constraint.

- [ ] **Step 3: Verifikasi & commit**

```bash
npx supabase db reset && npm run seed:users && npm test && npm run build
git add web && git commit -m "hardening(plan5): constraint tabel uang + pagar struktural RLS menyeluruh"
```

---

### Task 2: Util rekap — pekan Jakarta, tarif pada tanggal, agregasi

**Files:**
- Create: `web/src/lib/owner/pekan.ts`, `web/src/lib/owner/rekap.ts`, `web/tests/owner-pekan.test.ts`, `web/tests/owner-rekap.test.ts`

**Interfaces:**
- Produces:
  - `awalPekan(tgl: string): string` → Senin pekan itu, `YYYY-MM-DD`
  - `rentangPekan(senin: string): string` → "17 – 23 Agu 2026"
  - `tarifPadaTanggal(tarif: TarifRingkas[], serviceId: string, tgl: string): TarifRingkas | null`
  - `hitungRekap(input): RekapPekan[]`

- [ ] **Step 1: Test pekan (MERAH)**

Buat `web/tests/owner-pekan.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { awalPekan, rentangPekan } from "@/lib/owner/pekan";

// Proses berjalan TZ=UTC (vitest.config.ts). mondayOf prototipe memakai
// getDay()/setDate() dan TERBUKTI salah di America/Los_Angeles — 2026-08-30
// menghasilkan 2026-08-25 yang bahkan bukan Senin. Rumus di sini berbasis
// string murni sehingga tidak bergantung zona sama sekali.
describe("awalPekan", () => {
  it("Senin memetakan ke dirinya sendiri", () => {
    expect(awalPekan("2026-08-24")).toBe("2026-08-24"); // Senin
  });
  it("Minggu memetakan ke Senin sebelumnya", () => {
    expect(awalPekan("2026-08-30")).toBe("2026-08-24"); // Minggu -> Senin
  });
  it("Selasa memetakan ke Senin sebelumnya", () => {
    expect(awalPekan("2026-08-25")).toBe("2026-08-24");
  });
  it("melintasi pergantian bulan", () => {
    expect(awalPekan("2026-09-01")).toBe("2026-08-31"); // Selasa -> Senin
  });
  it("melintasi pergantian tahun", () => {
    expect(awalPekan("2027-01-01")).toBe("2026-12-28"); // Jumat -> Senin
  });
  it("hasilnya SELALU hari Senin", () => {
    for (const t of ["2026-01-01","2026-02-28","2026-03-01","2026-06-15","2026-12-31"]) {
      const senin = awalPekan(t);
      // isoDow dihitung ulang secara independen dari implementasi
      const d = new Date(`${senin}T12:00:00Z`);
      expect(d.getUTCDay()).toBe(1);
    }
  });
});

describe("rentangPekan", () => {
  it("menampilkan Senin sampai Minggu dengan bulan Indonesia", () => {
    expect(rentangPekan("2026-08-24")).toBe("24 – 30 Agu 2026");
  });
  it("menampilkan kedua bulan bila pekan melintasi bulan", () => {
    expect(rentangPekan("2026-08-31")).toBe("31 Agu – 6 Sep 2026");
  });
});
```

- [ ] **Step 2: Implementasi pekan**

Buat `web/src/lib/owner/pekan.ts`. Hitung hari-dalam-pekan dari string tanggal tanpa `Date` untuk logikanya — algoritma Sakamoto atau hari-Julian sederhana; `Date` hanya boleh dipakai untuk **memformat** dengan `timeZone: "Asia/Jakarta"`, tidak untuk aritmatika. Uji ulang bahwa hasilnya selalu Senin.

- [ ] **Step 3: Test rekap (MERAH)**

Buat `web/tests/owner-rekap.test.ts` yang membuktikan:
- tarif dipilih dari `berlaku_sejak` **terbesar yang ≤ tanggal sesi**;
- sesi yang lebih tua dari tarif paling awal → tarif `null`, dan sesinya **dilaporkan sebagai tak-bertarif**, bukan dihitung nol diam-diam;
- hanya sesi `status = "selesai"` yang masuk rekap;
- honor dijumlahkan **per mitra per pekan**; margin = Σharga − Σhonor **per pekan** (spec keputusan #6: margin adalah angka PADMA, bukan per mitra);
- sesi berpaket **dan** sesi lepas keduanya menghasilkan honor mitra (bidan bekerja pada keduanya);
- pekan tanpa sesi tidak muncul;
- kasus batas: sesi tepat pada `berlaku_sejak` memakai tarif baru.

- [ ] **Step 4: Implementasi rekap**

Buat `web/src/lib/owner/rekap.ts` — fungsi **murni**, tanpa I/O, menerima daftar sesi + daftar tarif + daftar tanda bayar, mengembalikan rekap per pekan berisi: `senin`, `rentang`, `jumlahSesi`, `perMitra[]` (nama, jumlah sesi, total honor, sudah dibayar?), `totalHonor`, `totalHarga`, `margin`, `sesiTakBertarif[]`.

- [ ] **Step 5: Verifikasi & commit**

```bash
npm test && git add web && git commit -m "feat(plan5): util pekan Jakarta & kalkulasi rekap honor berriwayat tarif"
```

---

### Task 3: Shell panel owner

**Files:**
- Create: `web/src/app/owner/_shell/nav-owner.tsx`, `web/src/lib/owner/data.ts`
- Modify: `web/src/app/owner/layout.tsx`, `web/src/app/owner/page.tsx`

- [ ] **Step 1: Layout**

Tiru `src/app/admin/layout.tsx` — pembungkus `min-h-screen bg-paper` + `mx-auto max-w-6xl px-4 pb-36 pt-6 sm:pb-10`, baris identitas "Masuk sebagai … · Owner", logout `<form method="post">`.

**JEBAKAN:** `requireRole` tetap **tepat satu kali** dengan argumen persis `["owner"]` (dikunci `access-matrix-layouts.test.ts`).

Ganti footer money-firewall admin dengan catatan kebalikannya: panel ini **satu-satunya** tempat nominal hidup.

- [ ] **Step 2: Navigasi + jalan pulang ke /admin**

`nav-owner.tsx` meniru `nav-admin.tsx` (dua nav: tab desktop `sm:flex`, bottom bar `sm:hidden`), tiga tujuan: `/owner` Beranda · `/owner/rekap` Rekap · `/owner/tarif` Tarif.

Tambahkan **tautan terpisah ke `/admin`** — owner adalah superset admin tetapi hari ini **tidak punya satu pun jalan klik** dari `/owner` ke `/admin` (terverifikasi: 0 tautan). Beri label jelas, mis. "Buka Panel Admin →".

- [ ] **Step 3: Beranda owner**

Ringkasan pekan berjalan: kartu jumlah sesi selesai, total honor yang harus dibayar Sabtu, dan margin (kartu gelap `stat.gold` seperti prototipe). **Teks "Panel Owner" wajib tetap ada** (dikunci E2E).

Normalkan `metadata` menjadi `{ title: "Panel Owner" }` agar konsisten dengan template `%s · PADMA` — halaman ini satu-satunya yang masih menulis judul penuh.

- [ ] **Step 4: Verifikasi & commit**

```bash
npm test && npm run build
git add web && git commit -m "feat(plan5): shell panel owner + jalan pulang ke panel admin"
```

---

### Task 4: Rate card

**Files:**
- Create: `web/src/app/owner/tarif/page.tsx`, `web/src/app/owner/tarif/aksi.ts`, `web/src/app/owner/tarif/form-tarif.tsx`, `web/tests/owner-tarif.test.ts`

- [ ] **Step 1: Server action**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { hariIniJakarta } from "@/lib/passport/waktu";

// requireRole(["owner"]) — BUKAN ["admin","owner"]. Layout TIDAK menjaga
// server action: dibuktikan dengan mem-POST action panel admin dari rute lain
// sebagai admin, dan mutasinya berhasil.
export async function tetapkanTarif(formData: FormData) {
  await requireRole(["owner"]);

  const serviceId = String(formData.get("layanan") ?? "");
  const harga = Number(formData.get("harga") ?? NaN);
  const honor = Number(formData.get("honor") ?? NaN);
  const mulai = String(formData.get("mulai") ?? "") || hariIniJakarta();

  if (!serviceId) return { ok: false as const, pesan: "Layanan wajib dipilih." };
  if (!Number.isInteger(harga) || harga < 0) return { ok: false as const, pesan: "Harga tidak sah." };
  if (!Number.isInteger(honor) || honor < 0) return { ok: false as const, pesan: "Honor tidak sah." };
  if (honor > harga) return { ok: false as const, pesan: "Honor mitra tidak boleh melebihi harga klien." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mulai)) return { ok: false as const, pesan: "Tanggal berlaku tidak sah." };

  // INSERT-only: tarif lama TIDAK PERNAH diubah, supaya rekap pekan yang sudah
  // dibayar tidak ikut bergeser. Trigger guard_tarif_maju menolak tanggal mundur.
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("service_rates").insert({
    service_id: serviceId, harga_klien: harga, honor_mitra: honor, berlaku_sejak: mulai,
  }).select("id");

  if (error) {
    if (error.code === "23505") return { ok: false as const, pesan: "Sudah ada tarif untuk layanan ini pada tanggal tersebut." };
    if (error.code === "42501") return { ok: false as const, pesan: "Tarif baru harus berlaku setelah tarif terakhir layanan ini." };
    if (error.code === "23514") return { ok: false as const, pesan: "Nilai tarif tidak wajar." };
    return { ok: false as const, pesan: "Gagal menyimpan tarif." };
  }
  if ((data ?? []).length === 0) return { ok: false as const, pesan: "Tarif tidak tersimpan." };

  revalidatePath("/owner/tarif");
  revalidatePath("/owner/rekap");
  revalidatePath("/owner");
  return { ok: true as const };
}
```

- [ ] **Step 2: Halaman**

Tabel per layanan: nama layanan · tarif **berlaku sekarang** (harga, honor, margin) · tanggal berlaku · tombol "Riwayat" yang membuka daftar tarif lama. Form "Tetapkan tarif baru" dengan medan tanggal berlaku (default hari ini). **Tidak ada tombol Hapus** — DELETE sudah dicabut dan itu keadaan yang benar.

Beri peringatan jelas di form: menetapkan tarif baru **tidak** mengubah rekap pekan yang sudah lewat.

- [ ] **Step 3: Test**

Membuktikan: tarif baru tersimpan sebagai baris baru (baris lama utuh); tanggal mundur ditolak dengan pesan ramah; tarif kembar ditolak; honor > harga ditolak; **admin memanggil action ini ditolak**; rekap pekan lama tidak berubah setelah tarif naik.

- [ ] **Step 4: Verifikasi & commit**

```bash
npm test && npm run build
git add web && git commit -m "feat(plan5): rate card berriwayat (insert-only, tarif lama tidak pernah berubah)"
```

---

### Task 5: Rekap honor mingguan & tanda bayar

**Files:**
- Create: `web/src/app/owner/rekap/page.tsx`, `web/src/app/owner/rekap/aksi.ts`, `web/src/app/owner/rekap/tabel-rekap.tsx`, `web/tests/owner-rekap-halaman.test.ts`

- [ ] **Step 1: Server action tanda bayar**

```ts
export async function tandaiHonorDibayar(partnerId: string, senin: string) {
  await requireRole(["owner"]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(senin)) return { ok: false as const, pesan: "Pekan tidak sah." };

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  // ditandai_oleh & dibayar_pada TIDAK PERNAH dari payload — terbukti bisa
  // dipalsukan (owner menandai atas nama admin, bertanggal 1999).
  // Menandai dua kali melempar 23505, bukan no-op; ignoreDuplicates membuatnya
  // idempoten tanpa error. DELETE tanda ditolak 42501 — tidak ada jalur batal.
  const { error } = await supabase.from("honor_marks").upsert(
    {
      partner_id: partnerId,
      week_start: senin,
      dibayar_pada: new Date().toISOString(),
      ditandai_oleh: user?.id ?? null,
    },
    { onConflict: "partner_id,week_start", ignoreDuplicates: true },
  );
  if (error) return { ok: false as const, pesan: "Gagal menandai pembayaran honor." };

  revalidatePath("/owner/rekap");
  revalidatePath("/owner");
  return { ok: true as const };
}
```

- [ ] **Step 2: Halaman rekap**

Mengikuti prototipe: kartu pekan (`.week-card`) berisi rentang tanggal + jumlah sesi, baris honor per mitra dengan tombol "Tandai dibayar" (berubah menjadi "✓ Dibayar" + tanggal bila sudah), dan garis margin PADMA di bawah. Pekan terbaru di atas.

**Tangani kasus nyata:** bila ada sesi diselesaikan **setelah** pekan itu ditandai dibayar, honornya bertambah sementara tandanya sudah ada. Tampilkan penanda jelas ("ada sesi baru sesudah ditandai dibayar") — jangan diam-diam menambah angka di bawah tanda "sudah dibayar".

Tampilkan juga `sesiTakBertarif` bila ada — sesi yang lebih tua dari tarif paling awal tidak boleh hilang diam-diam dari rekap.

- [ ] **Step 3: Test**

Membuktikan: rekap mengelompokkan per pekan Senin–Minggu; honor memakai tarif pada tanggal sesi (uji dengan menaikkan tarif lalu memastikan pekan lama **tidak** berubah); tanda bayar idempoten; `ditandai_oleh` terisi id owner; admin memanggil action ditolak; sesi tak-bertarif dilaporkan.

- [ ] **Step 4: Verifikasi & commit**

```bash
npm test && npm run build
git add web && git commit -m "feat(plan5): rekap honor mingguan + tanda bayar idempoten"
```

---

### Task 6: E2E & audit penutup PADMA v1

**Files:**
- Create: `web/tests/e2e/owner.e2e.ts`
- Modify: `web/package.json`, `web/README.md`

- [ ] **Step 1: E2E**

Skrip `tsx` + Playwright. Skenario:
1. Login owner → `/owner` menampilkan "Panel Owner" dan ringkasan pekan.
2. `/owner/tarif` menampilkan rate card dengan nominal; tetapkan tarif baru → tersimpan sebagai baris baru.
3. `/owner/rekap` menampilkan pekan dengan honor per mitra; tandai dibayar → berubah menjadi "✓ Dibayar"; menandai lagi tidak error.
4. **Owner bisa membuka `/admin` lewat tautan di nav** (jalan pulang).
5. Login **admin** → `/owner` ditolak; **dan** HTML seluruh rute `/admin/**` tidak memuat satu pun nominal dari rate card.
6. Bersihkan seluruh data uji (tarif & tanda bayar yang dibuat) lewat service role.

Tambahkan script `test:e2e:owner` dan rangkaikan ke `test:e2e:semua`.

- [ ] **Step 2: Verifikasi menyeluruh**

```bash
npx supabase db reset && npm run seed:users && npm test && npm run build
npm run dev &   # tunggu Ready
npm run test:e2e:semua
```
Semua hijau. Matikan dev server; `lsof -ti tcp:3000` kosong.

- [ ] **Step 3: README & commit**

Tambahkan rute owner ke tabel rute; perbarui bagian rute dengan seluruh 25+ halaman.

```bash
git add web && git commit -m "test(plan5): E2E panel owner + dokumentasi rute PADMA v1"
```

---

## Definition of Done — Plan 5 & PADMA v1

- [ ] Owner melihat rate card lengkap dengan nominal; admin & klien tetap mendapat `[]`; anon `42501`.
- [ ] Menetapkan tarif baru menyisipkan baris baru; tarif lama tidak pernah berubah; tanggal mundur ditolak.
- [ ] Rekap honor dikelompokkan per pekan Senin–Minggu menurut kalender Jakarta, dan memakai tarif yang berlaku **pada tanggal sesi** — menaikkan tarif tidak mengubah rekap pekan lama.
- [ ] Honor per mitra bisa ditandai dibayar; menandai dua kali tidak error; `ditandai_oleh` terisi id owner, bukan dari payload.
- [ ] Sesi yang lebih tua dari tarif paling awal dilaporkan, bukan dihitung nol diam-diam.
- [ ] Setiap server action Plan 5 memanggil `requireRole(["owner"])` di dalamnya; admin yang memanggilnya langsung ditolak.
- [ ] Tidak ada VIEW berkolom uang; agregasi dihitung di TypeScript.
- [ ] Tidak ada tabel `public` tanpa RLS (pagar struktural baru).
- [ ] Owner punya jalan klik dari `/owner` ke `/admin`.
- [ ] `npm test` hijau seluruhnya, **keenam** skrip E2E hijau, `npm run build` sukses.
- [ ] **PADMA v1 lengkap**: seluruh rute di spec bagian 4 terwujud, tidak ada halaman placeholder tersisa.
