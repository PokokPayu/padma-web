# Tab Permintaan, Panel Detail, dan Pin Alamat — Rencana Implementasi

> **Untuk pekerja agentik:** SUB-SKILL WAJIB: pakai superpowers:subagent-driven-development
> (disarankan) atau superpowers:executing-plans untuk mengerjakan rencana ini tugas demi tugas.
> Langkahnya memakai checkbox (`- [ ]`) untuk penandaan.

**Tujuan:** Memecah `/admin/sesi` menjadi dua tab — Permintaan (bawaan) dan Sesi — dengan detail
permintaan di panel geser, tempat admin bisa menambal koordinat alamat yang gagal digeocode.

**Arsitektur:** Satu rute, dua daftar, dipilih parameter `tab`. Daftar permintaan memakai primitif
panel yang sudah ada (`BilahDaftar`, `Paginasi`, `Tabel`) dengan lapisan data barunya sendiri.
Detail memakai `PanelGeser` yang sudah ada — isinya dirender di server, hanya tombol yang klien.
Tidak ada migrasi basis data.

**Tech Stack:** Next.js 16 (App Router, server component + server action), Supabase JS di sesi
pengguna, Tailwind, Vitest, Leaflet lewat `PemilihLokasi` yang sudah ada.

**Spec:** `docs/superpowers/specs/2026-09-09-padma-tab-permintaan-design.md`

## Batasan Global

- **NOL UJI BARU.** Keputusan pemilik repo 9 September 2026, demi kecepatan. Yang dikerjakan
  hanyalah menjaga uji yang sudah ada tetap hijau. Setiap tugas diakhiri **verifikasi manual oleh
  pemilik repo**, bukan uji otomatis.
- **Jangan jalankan `npm test` penuh.** Basis data Supabase lokal dipakai bersama sesi lain, dan
  suite penuh menyentuhnya. Jalankan hanya berkas uji murni yang disebut tiap tugas, plus
  `npx tsc --noEmit`.
- **Jangan `supabase db push`.** Pekerjaan ini tidak punya migrasi.
- Seluruh nama berbahasa Indonesia, mengikuti repo.
- Bacaan data memakai `createServerSupabase()` (sesi pengguna), **bukan** service role: di bawah
  service role `user_role()` memulangkan `'klien'` dan tidak satu pun policy ikut diperiksa.
- Setiap UPDATE lewat PostgREST diperiksa **jumlah barisnya**, bukan hanya `error` — update yang
  tertahan RLS dijawab `200 + []`.
- Nol rupiah di layar admin (money firewall) — jenjang ditampilkan sebagai jarak, bukan tarif.
- `tolakPermintaan` tetap **tidak terjangkau dari layar** (spec C1 J8). Jangan menambahkan tombol
  Tolak saat membongkar `BlokPermintaan`; `tests/pembatalan-klien.test.ts` menjaganya.

---

## Struktur Berkas

| Berkas | Tanggung jawab | Aksi |
|---|---|---|
| `src/app/_shell/panel/daftar.ts` | Parameter daftar sebagai fungsi murni | Modifikasi — parameter "lengket" + `lihat` |
| `src/app/_shell/panel/bilah-daftar.tsx` | Bilah cari/saring | Modifikasi — membawa lengket di form GET |
| `src/lib/admin/permintaan.ts` | Lapisan data daftar permintaan | **Baru** |
| `src/lib/jadwal/urutan-mitra.ts` | Urutan & label jarak mitra | Modifikasi — label menyebut sebab |
| `src/app/admin/sesi/aksi-koordinat.ts` | Server action pin alamat permintaan | **Baru** |
| `src/app/admin/sesi/panel-permintaan.tsx` | Isi panel detail (penyaji, server) | **Baru** |
| `src/app/admin/sesi/aksi-permintaan.tsx` | Tombol + pemilih bidan (klien) | **Baru**, dari `antrean-permintaan.tsx` |
| `src/app/admin/sesi/antrean-permintaan.tsx` | Blok antrean lama | **Hapus** di Tugas 6 |
| `src/app/admin/sesi/page.tsx` | Halaman dua tab | Modifikasi besar |
| `src/app/admin/page.tsx` | Beranda | Modifikasi — 4 tautan diberi `?tab=sesi` |
| `tests/urutan-mitra.test.ts` | Uji lama | Diperbarui agar hijau |

---

### Task 1: Parameter "lengket" pada primitif daftar

Parameter yang harus **ikut terbawa di setiap tautan** yang dibangun daftar — pada pekerjaan ini
hanya `tab`. Tanpa ini, memaginasi atau mencari dari tab Sesi kehilangan `tab=sesi` dan melempar
admin kembali ke tab bawaan (Permintaan).

**Files:**
- Modify: `src/app/_shell/panel/daftar.ts`
- Modify: `src/app/_shell/panel/bilah-daftar.tsx`

**Interfaces:**
- Produces: `ParamDaftar.lengket?: Readonly<Record<string, string>>`;
  `uraikanParamDaftar(sp, saringSah, lengketSah?)`; `bangunQuery` menulis lengket lebih dulu dan
  menulis `lihat` paling akhir.

- [ ] **Step 1: Tambahkan `lengket` ke tipe dan pengurai**

Di `src/app/_shell/panel/daftar.ts`, ubah tipe dan tambahkan parameter ketiga:

```ts
export type ParamDaftar = {
  cari: string;
  saring: Readonly<Record<string, string>>;
  /**
   * Parameter yang IKUT TERBAWA di setiap tautan daftar ini, tanpa pernah
   * mengembalikan halaman ke 1 — pada `/admin/sesi` itu `tab`.
   *
   * OPSIONAL dengan sengaja: tujuh daftar lain (dan 80 literal `ParamDaftar`
   * di dalam uji) tidak punya parameter lengket, dan mewajibkan medan ini
   * berarti menyunting kedelapan puluhnya untuk menuliskan `{}` — diff besar
   * yang menyembunyikan perubahan yang sesungguhnya.
   */
  lengket?: Readonly<Record<string, string>>;
  hal: number;
};
```

Tambahkan `"tab"` dan `"lihat"` ke `BUKAN_SARINGAN`:

```ts
// `tab` dan `lihat` menyusul `ubah` dengan alasan yang sama: keduanya bukan
// saringan. `lihat` membuka panel detail permintaan — membuka lalu menutupnya
// dari halaman 3 tidak boleh memindahkan admin ke halaman 1, karena baris yang
// barusan diklik justru lenyap dari layar. `tab` memilih daftar mana yang
// tampil, dan berpindah tab sudah membuang saringannya lewat href bersih.
const BUKAN_SARINGAN = new Set(["cari", "hal", "ubah", "tab", "lihat"]);
```

Ubah `uraikanParamDaftar`:

```ts
export function uraikanParamDaftar(
  sp: ParamMentah,
  saringSah: SaringSah,
  lengketSah: SaringSah = {},
): ParamDaftar {
  const saring: Record<string, string> = {};
  for (const [nama, nilaiBoleh] of Object.entries(saringSah)) {
    const v = nilaiTunggal(sp[nama]).trim();
    if (v !== "" && nilaiBoleh.includes(v)) saring[nama] = v;
  }

  // Daftar putih yang sama seperti saringan: nilai `tab` asing dibuang, dan
  // halaman jatuh ke bawaannya alih-alih merender daftar yang tidak ada.
  const lengket: Record<string, string> = {};
  for (const [nama, nilaiBoleh] of Object.entries(lengketSah)) {
    const v = nilaiTunggal(sp[nama]).trim();
    if (v !== "" && nilaiBoleh.includes(v)) lengket[nama] = v;
  }

  const halMentah = nilaiTunggal(sp.hal).trim();
  const hal = /^\d+$/.test(halMentah) ? Number(halMentah) : 1;

  return {
    cari: nilaiTunggal(sp.cari).trim(),
    saring,
    lengket,
    hal: hal >= 1 ? hal : 1,
  };
}
```

- [ ] **Step 2: Tulis lengket dan `lihat` di `bangunQuery`**

Di `bangunQuery`, tepat sesudah `const q = new URLSearchParams();`, sisipkan:

```ts
  // PALING AWAL supaya urutan parameternya stabil dan href bisa dicocokkan
  // sebagai string utuh. Daftar tanpa parameter lengket tidak berubah sama
  // sekali — `param.lengket` kosong menghasilkan nol iterasi.
  for (const [nama, nilai] of Object.entries(param.lengket ?? {})) {
    const dipakai = nama in ubahan ? ubahan[nama] : nilai;
    if (dipakai !== null && dipakai !== undefined && String(dipakai) !== "") {
      q.set(nama, String(dipakai));
    }
  }
```

Lalu, tepat sesudah blok yang menulis `ubah` di akhir fungsi, tambahkan blok kembarnya untuk
`lihat`:

```ts
  // `lihat` mengikuti `ubah`: ditulis paling akhir, dan hanya bila diminta.
  const lihat = "lihat" in ubahan ? ubahan.lihat : null;
  if (lihat !== null && lihat !== undefined && String(lihat) !== "") {
    q.set("lihat", String(lihat));
  }
```

- [ ] **Step 3: Bawa lengket sebagai input tersembunyi di kotak cari**

Di `src/app/_shell/panel/bilah-daftar.tsx`, di dalam `<form method="get">`, tepat di bawah blok
yang memetakan `param.saring`:

```tsx
          {/* Lengket ikut dibawa bersama saringan. Tanpa baris ini, mencari
              sesuatu dari tab Sesi mengirim form tanpa `tab`, dan admin
              mendarat di tab bawaan dengan kata cari yang benar — kegagalan
              yang terbaca sebagai "pencariannya yang salah". */}
          {Object.entries(param.lengket ?? {}).map(([nama, nilai]) => (
            <input key={nama} type="hidden" name={nama} value={nilai} />
          ))}
```

- [ ] **Step 4: Periksa tipe dan uji murni yang ada**

```bash
cd web && npx tsc --noEmit
npx vitest run tests/panel-daftar.test.ts tests/panel-bilah-daftar.test.tsx tests/panel-paginasi.test.tsx
```

Harapan: `tsc` bersih; ketiga berkas uji **hijau tanpa disunting** — `lengket` opsional dan
bawaannya kosong, jadi href daftar lain tidak berubah satu karakter pun. Bila ada href yang
berubah, itu bug di Step 2 (kemungkinan menulis lengket meski kosong), bukan uji yang perlu
diperbarui.

- [ ] **Step 5: Commit**

```bash
git add src/app/_shell/panel/daftar.ts src/app/_shell/panel/bilah-daftar.tsx
git commit -m "feat(panel): parameter lengket + lihat pada primitif daftar

Parameter yang ikut terbawa di setiap tautan daftar tanpa mengembalikan
halaman ke 1. Tanpa ini, memaginasi dari tab Sesi kehilangan tab=sesi."
```

---

### Task 2: Lapisan data daftar permintaan

**Files:**
- Create: `src/lib/admin/permintaan.ts`

**Interfaces:**
- Consumes: `ParamDaftar`, `hitungRentang` (Task 1 tidak mengubah keduanya).
- Produces: `SARING_PERMINTAAN`, `TAB_SESI`, `statusUntukSaring(nilai)`, `BarisPermintaanDaftar`,
  `ambilDaftarPermintaan(param) → { baris, total }`.

- [ ] **Step 1: Tulis modulnya**

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import { hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";
import {
  STATUS_ANTRE,
  STATUS_PERMINTAAN,
  type StatusPermintaan,
} from "@/lib/jadwal/status";
import type { PreferensiWaktu } from "@/app/admin/sesi/status";

/**
 * Lapisan data daftar PERMINTAAN (tab pertama `/admin/sesi`).
 *
 * Terpisah dari `@/lib/admin/sesi` karena keduanya membaca TABEL yang berbeda
 * untuk OBJEK yang berbeda: rantai terbelah di `dikonfirmasi` — sebelumnya
 * hidup sebuah permintaan, sesudahnya hidup sebuah sesi. Menyatukan keduanya
 * dalam satu modul akan menggoda satu query melayani dua arti.
 *
 * Seluruh bacaan memakai SESI PENGGUNA, bukan service role: policy
 * `booking: staf` yang mengizinkannya, dan di bawah service role `user_role()`
 * memulangkan 'klien' sehingga tidak satu pun pagar ikut diperiksa.
 */

/** Nilai `tab` yang sah — daftar putih untuk parameter lengket. */
export const TAB_SESI = { tab: ["permintaan", "sesi"] } satisfies SaringSah;

/**
 * Saringan status. Dua nilai pertama adalah HIMPUNAN, sisanya satu status
 * persis.
 */
export const SARING_PERMINTAAN = {
  status: ["menunggu", "riwayat", ...STATUS_PERMINTAAN],
} satisfies SaringSah;

/**
 * Himpunan status untuk sebuah nilai saringan.
 *
 * `riwayat` DIHITUNG DENGAN PENGURANGAN, tidak pernah ditulis sebagai daftar
 * tangan. Repo ini sudah membayar akibatnya sekali: nilai enum baru membuat
 * konstanta himpunan tulisan tangan salah diam-diam, tanpa satu galat pun.
 * Ditulis begini, status kesembilan otomatis muncul di riwayat pada hari ia
 * lahir — yang mana memang artinya "bukan lagi menunggu".
 */
export function statusUntukSaring(nilai: string): readonly StatusPermintaan[] {
  if (nilai === "riwayat") {
    return STATUS_PERMINTAAN.filter((s) => !STATUS_ANTRE.includes(s));
  }
  if (nilai === "" || nilai === "menunggu") return STATUS_ANTRE;
  return [nilai as StatusPermintaan];
}

export type BarisPermintaanDaftar = {
  id: string;
  namaKlien: string;
  padmaId: string;
  noHpKlien: string;
  namaLayanan: string;
  /** Nama varian; null bila embed-nya dipulangkan kosong. */
  namaVarian: string | null;
  namaMitra: string | null;
  /** ISO `YYYY-MM-DD` mentah — pemformatannya milik halaman. */
  tanggal: string;
  /** 'HH:MM:SS' apa adanya dari Postgres. */
  jamMulai: string;
  preferensiWaktu: PreferensiWaktu;
  catatan: string;
  alamat: string;
  /** Nullable persis kolomnya: alamat tanpa koordinat bukan galat. */
  alamatLat: number | null;
  alamatLon: number | null;
  status: StatusPermintaan;
  statusBayar: "belum" | "menunggu_verifikasi" | "lunas";
  tenggat: string | null;
};

type BarisMentah = {
  id: string;
  tanggal: string;
  jam_mulai: string;
  preferensi_waktu: PreferensiWaktu;
  catatan: string;
  alamat: string;
  alamat_lat: number | null;
  alamat_lon: number | null;
  status: StatusPermintaan;
  status_bayar: "belum" | "menunggu_verifikasi" | "lunas";
  tenggat: string | null;
  clients: { nama: string; padma_id: string; no_hp: string } | null;
  services: { nama: string } | null;
  service_variants: { nama: string } | null;
  partners: { nama: string } | null;
};

export async function ambilDaftarPermintaan(
  param: ParamDaftar,
): Promise<{ baris: BarisPermintaanDaftar[]; total: number }> {
  const supabase = await createServerSupabase();
  const { dari, sampai } = hitungRentang(param.hal);

  // `clients!inner` karena kata cari menyaring NAMA KLIEN, dan menyaring kolom
  // tabel tertanam menuntut join dalam. Aman: `client_id` NOT NULL sejak skema
  // awal, jadi join dalam tidak membuang satu baris pun.
  let q = supabase
    .from("booking_requests")
    .select(
      "id, tanggal, jam_mulai, preferensi_waktu, catatan, alamat, alamat_lat, alamat_lon, " +
        "status, status_bayar, tenggat, " +
        "clients!inner ( nama, padma_id, no_hp ), services ( nama ), " +
        "service_variants ( nama ), partners ( nama )",
      { count: "exact" },
    )
    // Disalin ke array biasa: `.in()` menolak `readonly string[]`.
    .in("status", [...statusUntukSaring(param.saring.status ?? "")])
    // Yang paling dekat tanggalnya paling mendesak dijawab.
    .order("tanggal", { ascending: true })
    .order("created_at", { ascending: true });

  if (param.cari !== "") {
    // `%` dan `_` yang diketik manusia dicari sebagai HURUF, bukan wildcard.
    const aman = param.cari.replace(/[%_\\]/g, (c) => `\\${c}`);
    q = q.ilike("clients.nama", `%${aman}%`);
  }

  const { data, count } = await q.range(dari, sampai).returns<BarisMentah[]>();

  return {
    baris: (data ?? []).map((p) => ({
      id: p.id,
      // Embed yang tertahan RLS pulang sebagai NULL, bukan galat — jadi setiap
      // nama tertanam punya jalan mundur yang terbaca manusia. Tanpa itu,
      // policy yang salah muncul di layar sebagai "undefined".
      namaKlien: p.clients?.nama ?? "Klien",
      padmaId: p.clients?.padma_id ?? "",
      noHpKlien: p.clients?.no_hp ?? "",
      namaLayanan: p.services?.nama ?? "Layanan",
      namaVarian: p.service_variants?.nama ?? null,
      namaMitra: p.partners?.nama ?? null,
      tanggal: p.tanggal,
      jamMulai: p.jam_mulai,
      preferensiWaktu: p.preferensi_waktu,
      catatan: p.catatan,
      alamat: p.alamat,
      alamatLat: p.alamat_lat,
      alamatLon: p.alamat_lon,
      status: p.status,
      statusBayar: p.status_bayar,
      tenggat: p.tenggat,
    })),
    total: count ?? 0,
  };
}
```

- [ ] **Step 2: Periksa tipe**

```bash
cd web && npx tsc --noEmit
```

Harapan: bersih. Bila `PreferensiWaktu` tidak terekspor dari `@/app/admin/sesi/status`, periksa
nama ekspornya di berkas itu dan sesuaikan impornya — jangan mendefinisikan tipe kembar.

- [ ] **Step 3: Commit**

```bash
git add src/lib/admin/permintaan.ts
git commit -m "feat(admin): lapisan data daftar permintaan dengan saring & paginasi

riwayat dihitung sebagai komplemen STATUS_ANTRE, bukan daftar tangan:
status kesembilan ikut benar sendiri pada hari ia lahir."
```

---

### Task 3: Label jarak yang menyebut sebab

**Files:**
- Modify: `src/lib/jadwal/urutan-mitra.ts`
- Modify: `tests/urutan-mitra.test.ts` (memperbarui uji lama yang pecah — bukan uji baru)

**Interfaces:**
- Produces: `SebabTanpaJarak`, `MitraTerurut` bertambah medan `sebab`, `labelJarak(m)`.
  **`formatKm` dihapus.**

- [ ] **Step 1: Ganti bentuk label di `src/lib/jadwal/urutan-mitra.ts`**

Tambahkan tipe dan ubah `MitraTerurut`:

```ts
/**
 * Kenapa jarak tidak bisa dihitung. Dua sebab yang berbeda, dan sebelumnya
 * keduanya memulangkan kalimat yang SAMA — "domisili belum diisi" — sehingga
 * alamat permintaan yang gagal digeocode menuduh mitra yang datanya sudah
 * benar, dan menuduh SELURUH mitra sekaligus karena tujuannya satu untuk semua.
 */
export type SebabTanpaJarak = "alamat_permintaan" | "domisili_mitra";

export type MitraTerurut = MitraJarak & {
  km: number | null;
  /** Null ketika `km` ada. Selalu terisi ketika `km` null. */
  sebab: SebabTanpaJarak | null;
};
```

Ubah pemetaan di dalam `urutkanMitraMenurutJarak`:

```ts
  const berjarak: MitraTerurut[] = mitra.map((m) => {
    // TUJUAN DIPERIKSA LEBIH DULU, dan urutan itu disengaja: bila alamat
    // permintaan tanpa koordinat, tidak satu pun mitra bisa dihitung jaraknya,
    // dan satu pin memperbaiki seluruh baris sekaligus. Menyebut domisili
    // mitra lebih dulu akan mengirim admin membetulkan sepuluh data mitra
    // untuk satu koordinat yang hilang.
    if (tujuan === null) return { ...m, km: null, sebab: "alamat_permintaan" as const };
    if (m.lat === null || m.lon === null) {
      return { ...m, km: null, sebab: "domisili_mitra" as const };
    }
    return { ...m, km: haversineKm({ lat: m.lat, lon: m.lon }, tujuan), sebab: null };
  });
```

Ganti `formatKm` dengan:

```ts
/**
 * Jarak untuk dibaca manusia: satu angka desimal, koma sebagai pemisah — atau
 * kalimat yang menyebut APA yang kurang dan pada siapa.
 *
 * Menerima barisnya, bukan `number | null`, dan itu yang menutup cacatnya:
 * dengan `null` sebagai satu-satunya masukan, sebab hilangnya jarak tidak
 * pernah sampai ke sini, dan pemanggil mana pun terpaksa menebak. Sekarang
 * tipenya yang menjaga, bukan disiplin.
 *
 * Sengaja TIDAK dibulatkan ke jenjang tarif. Admin yang tahu bahwa 4,2 km ke
 * seberang sungai berarti 9 km memutar yang memutuskan — dan angka yang sudah
 * dijadikan jenjang menyembunyikan justru bagian yang ia butuhkan.
 */
export function labelJarak(m: Pick<MitraTerurut, "km" | "sebab">): string {
  if (m.km !== null) return `${m.km.toFixed(1).replace(".", ",")} km`;
  if (m.sebab === "alamat_permintaan") return "alamat permintaan belum berkoordinat";
  return "domisili bidan belum diisi";
}
```

- [ ] **Step 2: Perbarui uji lama supaya hijau**

Di `tests/urutan-mitra.test.ts`, ganti impor `formatKm` menjadi `labelJarak`, dan ganti isi
`describe("format jarak untuk layar admin")` menjadi:

```ts
describe("format jarak untuk layar admin", () => {
  it("satu angka desimal dengan koma, bukan titik", () => {
    expect(labelJarak({ km: 4.234, sebab: null })).toBe("4,2 km");
    expect(labelJarak({ km: 0, sebab: null })).toBe("0,0 km");
  });

  it("menyebut APA yang kurang dan PADA SIAPA, bukan satu kalimat untuk dua sebab", () => {
    // "0 km" untuk mitra tanpa domisili akan membuatnya selalu tampak paling
    // dekat — kebohongan yang persis membalik urutan yang sedang dibangun.
    expect(labelJarak({ km: null, sebab: "domisili_mitra" })).toBe("domisili bidan belum diisi");
    // Dan yang ini dulunya juga berbunyi "domisili belum diisi": alamat
    // permintaan yang gagal digeocode menuduh mitra yang datanya sudah benar.
    expect(labelJarak({ km: null, sebab: "alamat_permintaan" })).toBe(
      "alamat permintaan belum berkoordinat",
    );
  });
});
```

Bila ada uji lain di berkas itu yang menyusun `MitraTerurut` secara literal, tambahkan `sebab` yang
sesuai. Mitra tanpa domisili harus **tetap ada** di hasil urut — jangan menyunting uji yang
menjaganya.

- [ ] **Step 3: Jalankan uji murni ini**

```bash
cd web && npx vitest run tests/urutan-mitra.test.ts && npx tsc --noEmit
```

Harapan: hijau. `tsc` akan menunjuk `src/app/admin/sesi/page.tsx` yang masih memanggil `formatKm` —
itu **diperbaiki di Tugas 6**, jadi galat itu boleh berdiri sampai tugas tersebut. Catat, jangan
tambal dengan `any`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/jadwal/urutan-mitra.ts tests/urutan-mitra.test.ts
git commit -m "fix(jadwal): label jarak menyebut sebab, bukan selalu menuduh mitra

km null punya dua sebab: domisili mitra kosong, atau alamat permintaan
tanpa koordinat. Keduanya dulu memulangkan kalimat yang sama, dan yang
kedua menuduh pihak yang salah — seluruh daftar bidan sekaligus."
```

---

### Task 4: Server action pin alamat permintaan

**Files:**
- Create: `src/app/admin/sesi/aksi-koordinat.ts`

**Interfaces:**
- Consumes: `koordinatDariFormData` dari `@/lib/transport/koordinat-form`, `STATUS_ANTRE`.
- Produces: `tetapkanKoordinatPermintaan(permintaanId: string, formData: FormData) →
  Promise<{ ok: true } | { ok: false; pesan: string }>`.

- [ ] **Step 1: Tulis actionnya**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { koordinatDariFormData } from "@/lib/transport/koordinat-form";
import { STATUS_ANTRE } from "@/lib/jadwal/status";

/**
 * Menaruh pin pada alamat sebuah PERMINTAAN.
 *
 * Kenapa layar ini ada: formulir pengajuan klien tidak punya pemilih peta, dan
 * `booking_requests.alamat_lat` hanya terisi lewat warisan alamat profil yang
 * IDENTIK persis atau lewat Nominatim — yang untuk alamat Malang sebagian
 * besar gagal (26 dari 32 pada probe spec pemilih-lokasi). Akibatnya bukan
 * sekadar label yang membingungkan: `konfirmasi_permintaan` menghitung jenjang
 * transport dari koordinat ini, jadi permintaan tanpa koordinat melahirkan sesi
 * tanpa jenjang yang harus ditetapkan tangan belakangan.
 *
 * Berkas `"use server"` hanya boleh mengekspor fungsi async.
 */
type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true };

export async function tetapkanKoordinatPermintaan(
  permintaanId: string,
  formData: FormData,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  // Parser yang SAMA dengan form mitra dan form klien, bukan yang kedua:
  // rentang lat/lon dan penolakan medan kosong sudah hidup di sana.
  const koordinat = koordinatDariFormData(formData);
  if (!koordinat) {
    return { ok: false, pesan: "Pin belum dijatuhkan di peta, atau koordinatnya tidak sah." };
  }

  const supabase = await createServerSupabase();

  // HANYA yang masih di antrean. Sesudah dikonfirmasi, sesinya sudah lahir
  // membawa SALINAN koordinat ini beserta jenjang yang dihitung darinya —
  // mengubah baris permintaan di titik itu tidak memperbaiki apa pun, ia hanya
  // membuat dua baris bercerita berbeda tentang tempat yang sama.
  //
  // `status` TIDAK ikut dalam payload: menaruh koordinat bukan langkah dalam
  // rantai, dan guard_booking_status memang hanya menjaga perpindahan status.
  const { data, error } = await supabase
    .from("booking_requests")
    .update({ alamat_lat: koordinat.lat, alamat_lon: koordinat.lon })
    .eq("id", permintaanId)
    .in("status", [...STATUS_ANTRE])
    .select("id");

  // UPDATE yang tertahan RLS dijawab PostgREST dengan 200 + [] — melaporkan
  // "berhasil" tanpa memeriksa jumlah barisnya adalah kebohongan senyap.
  if (error || (data ?? []).length === 0) {
    return {
      ok: false,
      pesan: "Gagal menyimpan pin. Permintaan mungkin sudah dikonfirmasi atau dibatalkan.",
    };
  }

  revalidatePath("/admin/sesi");
  return { ok: true };
}
```

- [ ] **Step 2: Periksa tipe**

```bash
cd web && npx tsc --noEmit
```

Harapan: tidak ada galat baru dari berkas ini (galat `formatKm` dari Tugas 3 masih boleh ada).

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/sesi/aksi-koordinat.ts
git commit -m "feat(sesi): admin bisa menaruh pin pada alamat permintaan

Menutup di hulu: koordinat kosong melahirkan sesi tanpa jenjang transport.
Hanya untuk permintaan yang masih di antrean — sesudah konfirmasi, sesinya
sudah memegang salinannya sendiri."
```

---

### Task 5: Panel detail permintaan

Membongkar `BlokPermintaan` jadi dua: **penyaji** yang dirender di server (bisa diperiksa dengan
`renderToStaticMarkup`, satu-satunya perkakas render suite ini yang berjalan tanpa jsdom) dan
**tombol** yang harus klien.

**Files:**
- Create: `src/app/admin/sesi/aksi-permintaan.tsx` (klien)
- Create: `src/app/admin/sesi/panel-permintaan.tsx` (server)

**Interfaces:**
- Consumes: `BarisPermintaanDaftar` (Task 2), `labelJarak`/`MitraTerurut` (Task 3),
  `tetapkanKoordinatPermintaan` (Task 4), `PanelGeser`, `PemilihLokasi`.
- Produces: `TombolPermintaan` (klien), `FormPinPermintaan` (klien),
  `PanelPermintaan({ permintaan, mitra, hrefTutup, tautanWa, labelBayar, lunas })` (server).

- [ ] **Step 1: Komponen klien `src/app/admin/sesi/aksi-permintaan.tsx`**

```tsx
"use client";

import { useState, useTransition, type ReactNode } from "react";
import { cariMitra, pilihMitra, konfirmasiPermintaan, terbitkanTagihan } from "./aksi";
import { tetapkanKoordinatPermintaan } from "./aksi-koordinat";
import {
  PERMINTAAN_AWAL,
  PERMINTAAN_DICARIKAN,
  PERMINTAAN_MENUNGGU_BAYAR,
  PERMINTAAN_SIAP_KONFIRMASI,
  type StatusPermintaan,
} from "@/lib/jadwal/status";

/** Satu pilihan bidan, jaraknya SUDAH diformat di server. */
export type MitraPilihan = { id: string; nama: string; jarak: string };

const KELAS_UTAMA =
  "rounded-lg bg-gold px-3 py-1.5 text-[12px] font-bold text-night disabled:opacity-60";
const KELAS_KEDUA =
  "rounded-lg border border-black/15 px-3 py-1.5 text-[12px] font-bold text-ink-soft disabled:opacity-60";

/**
 * Tombol-tombol satu permintaan — TIGA LANGKAH, bukan satu (spec C1 J7):
 *
 *   diminta        -> "Cari bidan"
 *   mencari_mitra  -> daftar bidan terurut jarak + "Tetapkan bidan"
 *   mitra_siap     -> "Terbitkan tagihan" + "Ganti bidan"
 *   menunggu_bayar -> WA tagihan, lalu "Konfirmasi jadwal" bila sudah lunas
 *
 * Langkahnya dipisah karena tarif transport berasal dari domisili BIDAN ke
 * alamat KLIEN: transport tidak bisa dihitung sebelum bidannya diketahui.
 *
 * TOMBOL "TOLAK" SENGAJA TIDAK ADA (spec C1 J8). Admin tidak menolak pengajuan;
 * klien yang membatalkan miliknya sendiri dari Passport. `tolakPermintaan`
 * masih hidup di aksi.ts, hanya tidak terjangkau dari layar — dan
 * tests/pembatalan-klien.test.ts menjaga agar tidak ada berkas di src/ yang
 * memanggilnya.
 *
 * Komponen ini KLIEN karena memanggil server action lalu menampilkan pesan
 * galatnya di tempat. Yang tidak ada di sini: pengambilan data dan
 * pemformatan — seluruhnya datang sebagai prop yang sudah jadi dari server.
 */
export function TombolPermintaan({
  permintaanId,
  status,
  namaMitra,
  mitra,
  lunas,
  tautanWa,
}: {
  permintaanId: string;
  status: StatusPermintaan;
  namaMitra: string | null;
  mitra: MitraPilihan[];
  lunas: boolean;
  tautanWa: string;
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [partnerId, setPartnerId] = useState(mitra[0]?.id ?? "");
  const tanpaMitra = mitra.length === 0;

  function jalankan(aksi: () => Promise<{ ok: true } | { ok: false; pesan: string }>) {
    mulai(async () => {
      const r = await aksi();
      setPesan(r.ok ? null : r.pesan);
    });
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {status === PERMINTAAN_AWAL && (
        <button
          type="button"
          disabled={pending}
          onClick={() => jalankan(() => cariMitra(permintaanId))}
          className={KELAS_UTAMA}
        >
          {pending ? "Memproses…" : "Cari bidan"}
        </button>
      )}

      {status === PERMINTAAN_DICARIKAN && (
        <>
          <label className="sr-only" htmlFor={`mitra-${permintaanId}`}>
            Bidan untuk permintaan ini
          </label>
          <select
            id={`mitra-${permintaanId}`}
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            className="min-h-[38px] w-full rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-[12.5px]"
          >
            {mitra.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nama} · {m.jarak}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending || tanpaMitra}
            onClick={() => jalankan(() => pilihMitra(permintaanId, partnerId))}
            className={KELAS_UTAMA}
          >
            {pending ? "Memproses…" : "Tetapkan bidan"}
          </button>
          {tanpaMitra && (
            <p className="text-[12px] font-semibold text-clay">
              Belum ada mitra aktif. Tambahkan di menu Mitra lebih dulu.
            </p>
          )}
        </>
      )}

      {status === PERMINTAAN_SIAP_KONFIRMASI && (
        <>
          <span className="text-[12.5px] font-semibold text-ink">Bidan: {namaMitra ?? "—"}</span>
          {/* Tagihan terbit TEPAT di sini, tidak lebih awal: tarif transport
              berasal dari domisili bidan ke alamat klien, jadi totalnya baru
              bisa diketahui sesudah bidannya dipilih. */}
          <button
            type="button"
            disabled={pending}
            onClick={() => jalankan(() => terbitkanTagihan(permintaanId))}
            className={KELAS_UTAMA}
          >
            {pending ? "Memproses…" : "Terbitkan tagihan"}
          </button>
          {/* JALAN MUNDUR. Tanpa tombol ini, permintaan yang bidannya
              berhalangan tersangkut permanen: konfirmasi menolaknya, dan sejak
              J8 admin tidak lagi punya tombol tolak. */}
          <button
            type="button"
            disabled={pending}
            onClick={() => jalankan(() => cariMitra(permintaanId))}
            className={KELAS_KEDUA}
          >
            Ganti bidan
          </button>
        </>
      )}

      {status === PERMINTAAN_MENUNGGU_BAYAR && (
        <>
          {tautanWa ? (
            <a href={tautanWa} target="_blank" rel="noopener" className={KELAS_KEDUA}>
              Kirim tagihan via WA
            </a>
          ) : (
            /* Tombolnya HILANG ketika nomor klien tidak sah, dan kalimat ini
               yang membuat hilangnya terlihat. Tanpa kalimat, admin membaca
               layar yang sama persis seperti layar yang benar dan menyimpulkan
               tagihannya sudah terkirim — sementara tenggat 24 jam berjalan. */
            <span className="text-[12px] font-semibold text-clay">
              Nomor WhatsApp klien belum sah — lengkapi di menu Klien.
            </span>
          )}
          {/* Konfirmasi hanya muncul ketika pembayaran SUDAH diverifikasi.
              Menampilkannya lebih awal berarti menawarkan tombol yang akan
              ditolak basis data — dan tombol yang berbohong adalah cara
              tercepat membuat admin berhenti memercayai layarnya. */}
          {lunas && (
            <button
              type="button"
              disabled={pending}
              onClick={() => jalankan(() => konfirmasiPermintaan(permintaanId))}
              className={KELAS_UTAMA}
            >
              {pending ? "Memproses…" : "Konfirmasi jadwal"}
            </button>
          )}
        </>
      )}

      {pesan && <p className="w-full text-[12px] font-semibold text-clay">{pesan}</p>}
    </div>
  );
}

/**
 * Formulir pin alamat permintaan.
 *
 * `PemilihLokasi` menaruh dua input tersembunyi bernama `lat`/`lon`; formulir
 * ini hanya membungkusnya dan menyerahkan FormData-nya ke server action.
 */
export function FormPinPermintaan({
  permintaanId,
  anak,
}: {
  permintaanId: string;
  /** `PemilihLokasi`, dirender halaman di server lalu dioper masuk. */
  anak: ReactNode;
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  return (
    <form
      action={(formData) =>
        mulai(async () => {
          const r = await tetapkanKoordinatPermintaan(permintaanId, formData);
          setPesan(r.ok ? "Pin tersimpan." : r.pesan);
        })
      }
    >
      {anak}
      <button type="submit" disabled={pending} className={`mt-2 ${KELAS_UTAMA}`}>
        {pending ? "Menyimpan…" : "Simpan pin"}
      </button>
      {pesan && <p className="mt-1 text-[12px] font-semibold text-ink-soft">{pesan}</p>}
    </form>
  );
}
```

- [ ] **Step 2: Penyaji server `src/app/admin/sesi/panel-permintaan.tsx`**

```tsx
import { PemilihLokasi } from "@/app/_shell/pemilih-lokasi";
import { TombolPermintaan, FormPinPermintaan, type MitraPilihan } from "./aksi-permintaan";
import type { BarisPermintaanDaftar } from "@/lib/admin/permintaan";
import { LABEL_PERMINTAAN } from "@/lib/jadwal/status";

/**
 * Isi panel geser untuk SATU permintaan.
 *
 * Komponen SERVER dengan sengaja: seluruh penyajian — ringkasan, alamat,
 * keadaan bayar — dirender di server, dan hanya tombol serta pemilih pin yang
 * menyeberang sebagai komponen klien. Suite proyek ini berjalan TANPA jsdom,
 * jadi apa pun yang hanya lahir sesudah hidrasi tidak bisa diperiksa sama
 * sekali.
 *
 * Tidak ada pengambilan data di sini. Seluruh isinya datang sebagai prop yang
 * sudah dirender halaman.
 */
export function PanelPermintaan({
  permintaan,
  mitra,
  tanggal,
  jam,
  waktu,
  labelBayar,
  lunas,
  tautanWa,
}: {
  permintaan: BarisPermintaanDaftar;
  mitra: MitraPilihan[];
  /** Sudah diformat lewat kalender Asia/Jakarta di halaman. */
  tanggal: string;
  jam: string;
  waktu: string;
  labelBayar: string;
  lunas: boolean;
  tautanWa: string;
}) {
  const berkoordinat = permintaan.alamatLat !== null && permintaan.alamatLon !== null;

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <section>
        <p className="text-[13.5px] font-bold text-panel-ink">
          {permintaan.namaKlien}
          {permintaan.padmaId && (
            <span className="ml-1.5 text-[11.5px] font-normal text-panel-muted">
              {permintaan.padmaId}
            </span>
          )}
        </p>
        <p className="mt-0.5 text-[12px] text-panel-muted">
          {permintaan.namaLayanan}
          {permintaan.namaVarian ? ` · ${permintaan.namaVarian}` : ""} · {tanggal} ·{" "}
          <b>{jam}</b> · alternatif {waktu}
        </p>
        <p className="mt-1 text-[12px] font-bold text-panel-ink">
          {LABEL_PERMINTAAN[permintaan.status]}
        </p>
        {permintaan.catatan && (
          <p className="mt-2 rounded-lg bg-black/[0.03] px-3 py-2 text-[12.5px] italic text-ink-soft">
            “{permintaan.catatan}”
          </p>
        )}
      </section>

      <section>
        <p className="text-[12.5px] font-bold text-panel-muted">Alamat kunjungan</p>
        <p className="mt-1 whitespace-pre-line text-[12.5px] text-panel-ink">
          {permintaan.alamat || "—"}
        </p>

        {berkoordinat ? (
          <p className="mt-1 text-[11px] text-panel-muted">
            Pin: {permintaan.alamatLat!.toFixed(6)}, {permintaan.alamatLon!.toFixed(6)}
          </p>
        ) : (
          <>
            {/* Kalimat menyebut AKIBATNYA, bukan hanya keadaannya. "Belum
                berkoordinat" saja tidak memberi tahu admin bahwa sesi yang
                lahir dari sini akan menuntut jenjang transport ditetapkan
                tangan belakangan. */}
            <p className="mt-2 rounded-lg bg-clay/10 px-3 py-2 text-[12px] font-semibold text-clay">
              Alamat ini belum berkoordinat. Jarak ke bidan tidak bisa dihitung, dan sesi yang lahir
              darinya tidak akan punya jenjang transport.
            </p>
            <FormPinPermintaan
              permintaanId={permintaan.id}
              anak={<PemilihLokasi awal={null} />}
            />
          </>
        )}
        {/* Lisensi ODbL menuntut atribusi tampak di layar yang memakai
            hasilnya, bukan cukup di komentar kode. */}
        <p className="mt-1 text-[11px] text-panel-muted">
          Peta &amp; lokasi dari data © OpenStreetMap contributors.
        </p>
      </section>

      <section>
        <p className="text-[12.5px] font-bold text-panel-muted">Pembayaran</p>
        <p className="mt-1 text-[12.5px] text-panel-ink">{labelBayar}</p>
      </section>

      <TombolPermintaan
        permintaanId={permintaan.id}
        status={permintaan.status}
        namaMitra={permintaan.namaMitra}
        mitra={mitra}
        lunas={lunas}
        tautanWa={tautanWa}
      />
    </div>
  );
}
```

- [ ] **Step 3: Periksa tipe**

```bash
cd web && npx tsc --noEmit
```

Harapan: tidak ada galat baru dari kedua berkas ini.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/sesi/aksi-permintaan.tsx src/app/admin/sesi/panel-permintaan.tsx
git commit -m "feat(sesi): panel detail permintaan — penyaji di server, tombol di klien

Isi panel yang hanya lahir sesudah hidrasi tidak bisa diperiksa sama
sekali: suite ini berjalan tanpa jsdom."
```

---

### Task 6: Halaman `/admin/sesi` menjadi dua tab

Tugas terbesar. Sesudah ini `npx tsc --noEmit` harus bersih seluruhnya.

**Files:**
- Modify: `src/app/admin/sesi/page.tsx`
- Delete: `src/app/admin/sesi/antrean-permintaan.tsx`

**Interfaces:**
- Consumes: seluruh keluaran Tugas 1–5.

- [ ] **Step 1: Uraikan `tab` dan pilih daftar mana yang dimuat**

Di `src/app/admin/sesi/page.tsx`, ganti impor `formatKm` → `labelJarak`, buang impor
`BlokPermintaan`, dan tambahkan:

```ts
import { PanelPermintaan } from "./panel-permintaan";
import type { MitraPilihan as MitraPilihanPanel } from "./aksi-permintaan";
import {
  ambilDaftarPermintaan,
  SARING_PERMINTAAN,
  TAB_SESI,
} from "@/lib/admin/permintaan";
```

Perbarui juga impor status yang sudah ada di berkas itu: **tambahkan** `STATUS_PERMINTAAN` dan
`LABEL_PERMINTAAN` (dipakai chip saringan dan kolom Status), dan **buang** `STATUS_ANTRE` — ia
menganggur begitu query `booking_requests` inline dihapus, dan `npm run lint` menolak impor yang
tidak terpakai.

Di awal komponen, ganti penguraian parameter:

```ts
  const sp = await searchParams;

  // `ubah` MEMAKSA tab `sesi`, apa pun bawaannya. Panel itu milik daftar sesi,
  // dan tautan `?ubah=<id>` yang tersimpan di riwayat browser seseorang harus
  // tetap membuka panelnya — bukan mendarat di tab permintaan dengan panel yang
  // tidak punya daftar induk.
  const ubah = typeof sp.ubah === "string" ? sp.ubah : "";
  const tab = ubah !== "" ? "sesi" : (sp.tab === "sesi" ? "sesi" : "permintaan");

  const param = uraikanParamDaftar(
    { ...sp, tab },
    tab === "sesi" ? SARING_SESI : SARING_PERMINTAAN,
    TAB_SESI,
  );
```

Muat **hanya daftar tab yang aktif** — memuat keduanya berarti membayar dua query untuk satu
layar:

```ts
  const hariIni = hariIniJakarta();
  const supabase = await createServerSupabase();

  const [{ jamLayanan }, daftarSesi, daftarPermintaan] = await Promise.all([
    bacaPengaturan(),
    tab === "sesi"
      ? ambilDaftarSesi(param, hariIni)
      : Promise.resolve({ baris: [], total: 0 }),
    tab === "permintaan"
      ? ambilDaftarPermintaan(param)
      : Promise.resolve({ baris: [], total: 0 }),
  ]);
```

Sesuaikan pemakaian `baris`/`total` di sisa berkas menjadi `daftarSesi.baris`/`daftarSesi.total`,
dan hapus query `booking_requests` inline beserta tipe `BarisPermintaan` — keduanya kini hidup di
`@/lib/admin/permintaan`.

`mitra` tetap ditarik ketika `tab === "permintaan"` atau `ubah === "baru"`; `klien`/`layanan`/
`varian` tetap hanya ketika `ubah === "baru"`.

- [ ] **Step 2: Bilah dua tab**

Tepat di bawah `<header>`, sebelum `BilahDaftar`:

```tsx
      {/* Href BERSIH, tanpa mewarisi cari/status/hal: saringan tab sebelah
          tidak punya arti di sini, dan halaman 3 daftar sesi bukan halaman 3
          daftar permintaan. */}
      <nav aria-label="Bagian halaman Sesi" className="mb-4 flex gap-2">
        {[
          { nilai: "permintaan", label: "Permintaan" },
          { nilai: "sesi", label: "Sesi" },
        ].map((t) => (
          <Link
            key={t.nilai}
            href={t.nilai === "permintaan" ? BASIS : `${BASIS}?tab=sesi`}
            aria-current={tab === t.nilai ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-[12.5px] font-bold ${
              tab === t.nilai
                ? "bg-panel-ink text-panel-surface"
                : "border border-panel-border bg-panel-surface text-panel-muted"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
```

- [ ] **Step 3: Cabang tab Permintaan**

Bungkus `BilahDaftar` + tabel sesi + `Paginasi` yang sudah ada dalam `{tab === "sesi" && ( … )}`,
lalu tambahkan cabang kembarannya untuk permintaan:

```tsx
      {tab === "permintaan" && (
        <>
          <BilahDaftar
            basis={BASIS}
            param={param}
            kelompok={[
              {
                nama: "status",
                label: "Status",
                pilihan: [
                  { nilai: "menunggu", label: "Menunggu", menuntut: true },
                  { nilai: "riwayat", label: "Riwayat" },
                  // Diturunkan dari SATU sumber: daftar dan labelnya tidak
                  // pernah bisa berselisih dengan enum basis data.
                  ...STATUS_PERMINTAAN.map((s) => ({ nilai: s, label: LABEL_PERMINTAAN[s] })),
                ],
              },
            ]}
            jumlah={daftarPermintaan.baris.length}
            total={daftarPermintaan.total}
            aksi={null}
          />

          {daftarPermintaan.baris.length === 0 ? (
            <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
              Tidak ada permintaan jadwal yang cocok.
            </p>
          ) : (
            <Tabel label="Daftar permintaan jadwal">
              <thead>
                <tr>
                  <Th>Klien</Th>
                  <Th>Layanan</Th>
                  <Th>Tanggal &amp; jam</Th>
                  <Th>Status</Th>
                  <Th>Pembayaran</Th>
                </tr>
              </thead>
              <tbody>
                {daftarPermintaan.baris.map((p) => (
                  <tr key={p.id} data-permintaan={p.id} data-status={p.status}>
                    <Td>
                      <Link
                        href={`${BASIS}${bangunQuery(param, { lihat: p.id })}`}
                        className="font-bold text-panel-ink underline-offset-2 hover:underline"
                      >
                        {p.namaKlien}
                      </Link>
                    </Td>
                    <Td>{p.namaLayanan}</Td>
                    <Td>
                      {formatTanggalID(p.tanggal)} · {formatJam(jamDariDb(p.jamMulai))}
                    </Td>
                    <Td>{LABEL_PERMINTAAN[p.status]}</Td>
                    <Td>{labelBayarPermintaan(p)}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabel>
          )}

          <Paginasi basis={BASIS} param={param} total={daftarPermintaan.total} />
        </>
      )}
```

Tambahkan penolong pemformatan di puncak berkas (di luar komponen) — **diformat di server** karena
sisa waktu yang dihitung di peramban berbeda antara render server dan render klien, dan
ketidakcocokan hidrasinya muncul acak:

```ts
function labelBayarPermintaan(p: {
  statusBayar: "belum" | "menunggu_verifikasi" | "lunas";
  tenggat: string | null;
}): string {
  if (p.statusBayar === "lunas") return "sudah dibayar & diverifikasi";
  if (p.statusBayar === "menunggu_verifikasi") return "bukti masuk, menunggu verifikasi";
  return `belum dibayar · ${labelSisaWaktu(p.tenggat)}`;
}
```

- [ ] **Step 4: Panel detail lewat `?lihat=`**

Sesudah blok `PanelGeser` untuk sesi yang sudah ada, tambahkan:

```tsx
      {barisLihat && (
        <PanelGeser
          judul={`Permintaan — ${barisLihat.namaKlien}`}
          hrefTutup={`${BASIS}${bangunQuery(param, { lihat: null })}`}
        >
          <PanelPermintaan
            permintaan={barisLihat}
            mitra={mitraUntukLihat}
            tanggal={formatTanggalID(barisLihat.tanggal)}
            jam={formatJam(jamDariDb(barisLihat.jamMulai))}
            waktu={LABEL_WAKTU[barisLihat.preferensiWaktu] ?? barisLihat.preferensiWaktu}
            labelBayar={labelBayarPermintaan(barisLihat)}
            lunas={barisLihat.statusBayar === "lunas"}
            tautanWa={tautanWaUntukLihat}
          />
        </PanelGeser>
      )}
```

dan hitung ketiganya sebelum `return`. **Kesahihan `lihat` dibuktikan dengan menemukan barisnya**,
bukan dengan mempercayai URL:

```ts
  const lihat = typeof sp.lihat === "string" ? sp.lihat : "";
  const barisLihat = daftarPermintaan.baris.find((p) => p.id === lihat);

  // Bidan diurutkan terhadap alamat PERMINTAAN INI. Daftar bersama untuk
  // seluruh antrean akan benar untuk paling banyak satu baris.
  const mitraUntukLihat: MitraPilihanPanel[] = barisLihat
    ? urutkanMitraMenurutJarak(
        mitra,
        barisLihat.alamatLat != null && barisLihat.alamatLon != null
          ? { lat: barisLihat.alamatLat, lon: barisLihat.alamatLon }
          : null,
      ).map((m) => ({ id: m.id, nama: m.nama, jarak: labelJarak(m) }))
    : [];

  // Pesannya dirakit DI SERVER: `pesanTagihan` murni, tetapi nominal dan sisa
  // waktunya butuh tarif & jam server.
  //
  // Tujuannya nomor KLIEN, bukan setelan `nomor_wa` klinik. Versi sebelumnya
  // memakai yang kedua, dan bentuk kegagalannya tidak terlihat sebagai galat:
  // WhatsApp terbuka dengan pesan tagihan yang rapi, hanya saja lawan
  // bicaranya PADMA sendiri. Klien tidak pernah ditagih dan tenggat 24 jamnya
  // tetap berjalan. `nomorWaKlien` sengaja TANPA nomor cadangan.
  const tautanWaUntukLihat =
    barisLihat &&
    barisLihat.status === PERMINTAAN_MENUNGGU_BAYAR &&
    nomorWaKlien(barisLihat.noHpKlien)
      ? tautanWaTagihan(
          nomorWaKlien(barisLihat.noHpKlien),
          pesanTagihan({
            namaKlien: barisLihat.namaKlien,
            namaLayanan: barisLihat.namaLayanan,
            tanggal: formatTanggalID(barisLihat.tanggal),
            jam: formatJam(jamDariDb(barisLihat.jamMulai)),
            total: totalPerPermintaan.get(barisLihat.id) ?? null,
            sisaWaktu: labelSisaWaktu(barisLihat.tenggat),
          }),
        )
      : "";
```

`totalPerPermintaan` sudah ada di berkas ini (dari `daftarTagihanPengajuanAdmin`); pastikan ia tetap
dihitung ketika `tab === "permintaan"`, bukan hanya untuk antrean lama.

- [ ] **Step 5: Hapus komponen antrean lama**

```bash
cd web && git rm src/app/admin/sesi/antrean-permintaan.tsx
```

Pastikan tidak ada sisa impor:

```bash
grep -rn "antrean-permintaan\|BlokPermintaan\|formatKm" src/ tests/
```

Harapan: nol hasil.

- [ ] **Step 6: Periksa tipe, lint, dan pagar yang tidak menyentuh basis data**

```bash
cd web && npx tsc --noEmit && npm run lint
npx vitest run tests/pagar-batas-server-klien.test.ts tests/pembatalan-klien.test.ts tests/status-satu-sumber.test.ts
```

Harapan: seluruhnya hijau. Bila pagar batas server/klien merah, yang dibetulkan adalah **kodenya**
— sesuatu yang seharusnya di server ikut terseret ke bundel peramban — bukan pagarnya.

- [ ] **Step 7: Verifikasi manual oleh pemilik repo**

Serahkan ke pemilik repo dengan daftar periksa ini:

1. `/admin/sesi` membuka tab **Permintaan**.
2. Klik satu baris → panel geser muncul; Escape dan klik overlay menutupnya, dan halaman tetap di
   halaman/saringan yang sama.
3. Pada permintaan tanpa koordinat: peringatan clay muncul, peta bisa diklik, **Simpan pin**
   berhasil, lalu label bidan berubah dari "alamat permintaan belum berkoordinat" menjadi jarak
   sungguhan.
4. **Yang paling penting** — sesudah pin dipasang, jalankan permintaan itu sampai **Konfirmasi
   jadwal**, lalu periksa di tab Sesi bahwa sesinya lahir **dengan jenjang transport terisi**
   (bukan masuk saringan "Tanpa jenjang"). Inilah pembuktian bahwa bug asalnya tertutup; tidak ada
   uji otomatis yang menjaganya.
5. Saringan **Riwayat** menampilkan permintaan `dibatalkan_klien`/`dibatalkan_tenggat`/`ditolak`.
6. Dari tab **Sesi**: mencari sesuatu, menekan chip saringan, dan menekan "Berikutnya" semuanya
   **tetap di tab Sesi** (bukan melompat ke Permintaan). Ini yang dijaga Tugas 1.

- [ ] **Step 8: Commit**

```bash
git add -A src/app/admin/sesi
git commit -m "feat(sesi): dua tab — Permintaan (bawaan) dan Sesi, detail di panel geser

Antrean blok emas diganti daftar yang bisa dicari, disaring, dan
dipaginasi. Riwayat permintaan batal/tolak akhirnya terjangkau: sebelumnya
dibatalkan_tenggat hilang dari seluruh panel."
```

---

### Task 7: Tautan beranda dan badge

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: Beri `?tab=sesi` pada empat tautan yang menuju daftar sesi**

| Baris | Sekarang | Menjadi |
|---|---|---|
| "+ Sesi baru" | `/admin/sesi` | `/admin/sesi?tab=sesi` |
| StatTile "menunggu jenjang" | `/admin/sesi?status=selesai&jenjang=kosong` | `/admin/sesi?tab=sesi&status=selesai&jenjang=kosong` |
| "Buka Sesi" | `/admin/sesi` | `/admin/sesi?tab=sesi` |
| "Jadwalkan sesi" | `/admin/sesi` | `/admin/sesi?tab=sesi` |

Urutan parameter pada StatTile — `tab`, lalu `status`, lalu `jenjang` — harus sama persis dengan
yang dihasilkan `bangunQuery` (lengket lebih dulu), supaya chip yang menyala di halaman tujuan
adalah ketiganya, bukan sebagian.

**Tidak diubah:** StatTile "Permintaan jadwal" dan badge sidebar `permintaanMenunggu`
(`src/app/admin/_shell/nav-admin.tsx`) — keduanya menunjuk `/admin/sesi` telanjang, yang kini sudah
mendarat tepat di tab Permintaan.

- [ ] **Step 2: Periksa**

```bash
cd web && npx tsc --noEmit && npm run lint
grep -rn '"/admin/sesi' src/app/admin/page.tsx
```

Harapan: empat tautan bertambah `tab=sesi`, StatTile "Permintaan jadwal" tetap telanjang.

- [ ] **Step 3: Verifikasi manual**

Dari `/admin`: klik keempat tautan di atas → mendarat di tab **Sesi** (StatTile jenjang dengan dua
chip menyala). Klik StatTile "Permintaan jadwal" → mendarat di tab **Permintaan**.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/page.tsx
git commit -m "fix(admin): tautan beranda menuju daftar sesi membawa tab=sesi

Bawaan /admin/sesi kini tab Permintaan; tanpa ini keempatnya mendarat di
tab yang salah."
```

---

## Tindak Lanjut (tidak dikerjakan di sini)

Dicatat supaya tidak dianggap selesai:

1. **Uji RLS `tetapkanKoordinatPermintaan` di sesi klien.** Kebocoran di sini tidak terlihat saat
   diklik sebagai admin, dan kegagalan RLS di repo ini pulang sebagai `[]`, bukan galat.
2. **Uji `riwayat` sebagai komplemen turunan.** Tidak gagal sekarang; gagal saat nilai enum
   kesembilan lahir, dan gagalnya diam-diam.
3. **Uji rantai pin → sesi lahir dengan `jenjang` terisi.** Untuk sekarang dibuktikan manual sekali
   (Tugas 6 Step 7 butir 4).
4. **Pemilih peta di formulir pengajuan klien** (`/passport/ajukan`). Selama ini belum ada,
   koordinat tetap tidak terisi dari sumbernya dan setiap permintaan baru dengan alamat yang bukan
   salinan persis alamat profil akan lahir tanpa koordinat, menunggu ditambal admin.
