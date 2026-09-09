# Harga Klien di Master Layanan — Rencana Implementasi

> **Untuk pekerja agentik:** SUB-SKILL WAJIB: pakai superpowers:subagent-driven-development atau
> superpowers:executing-plans. Langkahnya memakai checkbox (`- [ ]`).

**Tujuan:** Menampilkan harga klien per varian di halaman detail layanan admin, tanpa `honor_mitra`
pernah meninggalkan basis data.

**Arsitektur:** Sebuah view `security_invoker = off` menjadi batas kolomnya — policy
`variant_rates: hanya owner` tidak disentuh. Tarif yang berlaku dipilih di dalam view.

**Spec:** `docs/superpowers/specs/2026-09-09-padma-harga-di-master-layanan-design.md`

## Batasan Global

- **NOL UJI BARU.** Uji lama yang pecah diperbarui — dan di sini **diperketat**, tidak pernah
  dilemahkan (spec K5).
- **Jangan `npm test` penuh.** Supabase lokal dipakai bersama sesi lain. Berkas uji bertarget boleh.
- **Migrasi diterapkan lokal dengan `npx supabase migration up`, BUKAN `supabase db push`.**
  `db push` menyasar proyek remote.
- `npx tsc --noEmit` dan `npm run lint` wajib bersih di akhir setiap tugas.
- Jalankan perintah dari `/Users/arvinfairuz/Documents/padma/web`.
- Komentar, pengenal, dan **pesan commit berbahasa Indonesia**.
- Yang tetap terlarang: `honor_mitra`, margin, `honor_marks`, `service_rates`.

---

### Task 1: View `varian_harga_staf` + lapisan data

**Files:**
- Create: `supabase/migrations/20260914120000_harga_klien_untuk_staf.sql`
- Modify: `src/lib/admin/katalog-admin.ts`

**Interfaces:**
- Produces: view `public.varian_harga_staf`; medan baru `hargaKlien: number | null` dan
  `hargaCoret: number | null` pada `VarianKelola`.

- [ ] **Step 1: Migrasi**

```sql
-- Harga KLIEN untuk staf admin, tanpa honor mitra ikut keluar.
--
-- Policy `variant_rates: hanya owner` SENGAJA TIDAK DISENTUH. Yang melebar
-- bukan hak baca atas tabelnya, melainkan sebuah view yang tidak pernah
-- menyebut `honor_mitra` — pola yang sama dengan `partner_publik`, yang
-- migrasinya menulis alasannya: "view inilah batas kolomnya". Honor mitra
-- tidak disembunyikan di UI; ia tidak pernah meninggalkan basis data lewat
-- jalur yang dilalui sisi admin.
--
-- `where user_role() in ('admin','owner')` membuat view ini KOSONG bagi klien,
-- sehingga `grant ... to authenticated` tidak diam-diam membuka harga ke
-- Passport. Gagalnya menutup, bukan membuka.
--
-- `distinct on` memilih tarif yang berlaku HARI INI di dalam SQL. Memilihnya
-- di TypeScript menuntut `tarifPadaTanggal()` yang hidup di `lib/owner/` —
-- mengimpornya ke sisi admin membalik pemisahan fisik yang justru sedang
-- dijaga — atau menulis pemilih kedua yang bisa berselisih dengan yang pertama.
--
-- Batas harinya kalender ASIA/JAKARTA, bukan `current_date`: server berjalan
-- UTC, dan antara 17:00-24:00 UTC tanggalnya sudah besok. Tarif yang berlaku
-- "mulai besok" tidak boleh muncul tujuh jam lebih awal.
create view public.varian_harga_staf with (security_invoker = off) as
  select distinct on (vr.variant_id)
         vr.variant_id,
         vr.harga_klien,
         vr.harga_coret,
         vr.berlaku_sejak
    from public.variant_rates vr
   where vr.berlaku_sejak <= (now() at time zone 'Asia/Jakarta')::date
     and public.user_role() in ('admin', 'owner')
   order by vr.variant_id, vr.berlaku_sejak desc;

grant select on public.varian_harga_staf to authenticated;

comment on view public.varian_harga_staf is
  'Harga KLIEN per varian untuk staf admin. Kolom honor_mitra sengaja tidak '
  'ada di sini — view ini batas kolomnya, bukan UI. Kosong bagi peran klien.';
```

- [ ] **Step 2: Terapkan migrasi ke basis data lokal**

```bash
cd web && npx supabase migration up
```

Bila gagal karena basis data lokal tertinggal, laporkan — **jangan** `db reset` (data sesi lain
ikut hilang) dan **jangan** `db push`.

- [ ] **Step 3: Lapisan data**

Di `src/lib/admin/katalog-admin.ts`:

- tambahkan ke `VarianKelola`:

```ts
  /**
   * Harga klien yang berlaku hari ini, dari view `varian_harga_staf`.
   * `null` berarti varian itu belum punya tarif berlaku — bukan galat, dan
   * bukan "gratis".
   */
  hargaKlien: number | null;
  hargaCoret: number | null;
```

- tarik view-nya di dalam `Promise.all` yang sudah ada:

```ts
    // `varian_harga_staf`, BUKAN `variant_rates`. Nama tabelnya sengaja tidak
    // pernah disebut modul admin — pagar di tests/admin-layanan.test.ts memang
    // memeriksa itu, dan pagar itu tetap benar sesudah pekerjaan ini.
    supabase
      .from("varian_harga_staf")
      .select("variant_id, harga_klien, harga_coret")
      .returns<{ variant_id: string; harga_klien: number; harga_coret: number | null }[]>(),
```

- petakan ke `Map<string, {harga: number; coret: number | null}>` dan isikan saat merakit
  `VarianKelola`; varian tanpa baris di peta mendapat `null`.

**Baca `error`-nya.** Query yang ditolak memulangkan `data: null`, dan `data ?? []` mengubahnya
menjadi seluruh kolom harga kosong — tidak bisa dibedakan dari "tarifnya memang belum diisi". Ini
kelas kegagalan yang sudah dua kali dibayar repo ini hari ini. Ikuti pola
`ambilDaftarPermintaan`: destrukturisasi `error` dan lempar.

- [ ] **Step 4: Verifikasi**

```bash
cd web && npx tsc --noEmit && npm run lint
npx vitest run tests/admin-layanan.test.ts
```

Harapan: **`admin-layanan.test.ts` HIJAU tanpa disunting.** Pagar money firewall-nya memeriksa
bahwa sumber modul tidak memuat string `variant_rates`/`honor_mitra` — dan nama view sengaja
`varian_harga_staf`, jadi pagar itu tetap berlaku dan tetap berarti. Halaman daftar juga tidak
merender harga, sehingga `nominalDalam(markup)` tetap kosong. Bila berkas ini merah, berhenti dan
laporkan: kemungkinan besar sesuatu menyebut tabelnya langsung.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260914120000_harga_klien_untuk_staf.sql src/lib/admin/katalog-admin.ts
git commit -m "feat(layanan): view harga klien untuk staf, tanpa honor mitra

Policy variant_rates tidak disentuh; view yang jadi batas kolomnya, pola
yang sama dengan partner_publik. Tarif berlaku dipilih di SQL memakai
kalender Asia/Jakarta."
```

---

### Task 2: Kolom Harga di detail layanan + pagar yang diperketat

**Files:**
- Modify: `src/app/admin/layanan/[id]/page.tsx`
- Modify: `src/app/admin/layanan/page.tsx`
- Modify: `tests/admin-layanan-detail.test.tsx`

- [ ] **Step 1: Kolom Harga**

Di `src/app/admin/layanan/[id]/page.tsx`, pada tabel varian (sekitar baris 120-145): tambahkan
`<Th>Harga</Th>` sesudah `<Th>Varian</Th>`, dan sel yang sesuai di tiap baris:

```tsx
                    <Td className="font-mono text-[12.5px]">
                      {v.hargaKlien === null ? "—" : formatRupiah(v.hargaKlien)}
                    </Td>
```

Impor `formatRupiah` dari `@/lib/rupiah-publik`. Em dash untuk varian tanpa tarif berlaku — "Rp 0"
akan terbaca sebagai gratis.

`hargaCoret` **tidak** ditampilkan pada pekerjaan ini; ia ikut ditarik supaya lapisan datanya siap,
tetapi menampilkan harga coret adalah keputusan tampilan tersendiri.

- [ ] **Step 2: Hapus kalimat di Bantuan**

Di `src/app/admin/layanan/page.tsx` (sekitar baris 81-82), hapus kalimat:

> "Tidak ada satu pun angka harga di sini — tarif adalah wilayah Owner."

**Tanpa pengganti** — keputusan pemilik repo (spec K4). Sisa blok Bantuan (nonaktif ≠ hapus, varian
aktif terakhir) **tetap**, dan kalimat berikutnya harus tetap mengalir secara gramatikal sesudah
kalimat pertama dihapus. Jangan menambahkan keterangan apa pun tentang harga di layar mana pun.

- [ ] **Step 3: Perketat pagar di `tests/admin-layanan-detail.test.tsx`**

Dua assertion (`nominalDalam(...)).toEqual([])` di sekitar baris 155 dan 347) sekarang pasti merah.

**DILARANG** menggantinya dengan sesuatu yang mengizinkan nominal apa pun — itu menukar pagar
dengan ketiadaan pagar. Gantinya, jaga hal yang sebenarnya penting:

1. nilai `honor_mitra` dari fixture **tidak** muncul di markup; dan
2. nilai `harga_klien` dari fixture **muncul**.

Butir 2 wajib: tanpanya, view yang salah tulis dan memulangkan nol baris akan lolos sebagai "tidak
ada nominal bocor" — kegagalan senyap berbentuk kolom harga kosong.

Baca fixture berkas itu untuk menemukan nilai `harga_klien`/`honor_mitra` yang dipakai; bila belum
ada, ambil dari baris `variant_rates` yang disisipkan setup-nya. Tulis komentar di atas assertion
yang menyebutkan kenapa bentuk pagarnya berubah.

- [ ] **Step 4: Verifikasi**

```bash
cd web && npx tsc --noEmit && npm run lint
npx vitest run tests/admin-layanan-detail.test.tsx tests/admin-layanan.test.ts
```

Harapan: keduanya hijau.

- [ ] **Step 5: Commit**

```bash
git add "src/app/admin/layanan/[id]/page.tsx" src/app/admin/layanan/page.tsx tests/admin-layanan-detail.test.tsx
git commit -m "feat(layanan): kolom harga klien di detail layanan

Pagar money firewall halaman ini diubah bentuknya, bukan dilemahkan: dari
'nol nominal' menjadi 'honor mitra tidak muncul DAN harga klien muncul' —
yang kedua menangkap view yang memulangkan nol baris."
```

---

## Verifikasi Manual (pemilik repo)

1. Buka `/admin/layanan/<id>` sebagai **admin**: kolom Harga terisi untuk varian bertarif, `—` untuk
   yang belum.
2. Varian yang tarifnya baru berlaku **besok** belum tampil harganya hari ini.
3. Buka halaman yang sama sebagai **owner**: sama saja.
4. **Yang paling penting** — pastikan **tidak ada** angka honor mitra di layar itu. Bandingkan
   dengan `/owner/tarif` untuk varian yang sama: angka honor hanya boleh ada di sana.
5. Sebagai **klien** (Passport), tidak ada harga baru yang bocor — view-nya kosong untuk peran
   klien. Tidak ada uji yang menjaga ini.

## Tindak Lanjut

1. Klausa `user_role()` di dalam view tidak punya penjaga uji (spec, lubang 1).
2. `harga_coret` ditarik tetapi belum ditampilkan.
3. Tidak ada keterangan di layar yang membedakan harga klien dari honor mitra (spec K4, risiko
   diterima sadar).
