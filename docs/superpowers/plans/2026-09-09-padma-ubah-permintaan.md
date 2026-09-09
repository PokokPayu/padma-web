# Hubungi Klien & Ubah Permintaan — Rencana Implementasi

> **Untuk pekerja agentik:** SUB-SKILL WAJIB: pakai superpowers:subagent-driven-development
> (disarankan) atau superpowers:executing-plans untuk mengerjakan rencana ini tugas demi tugas.
> Langkahnya memakai checkbox (`- [ ]`) untuk penandaan.

**Tujuan:** Memberi admin tiga kemampuan di panel detail permintaan — menghubungi klien lewat
WhatsApp, mengubah teks alamat, dan mengubah tanggal & jam — dalam satu formulir yang menggantikan
formulir pin.

**Arsitektur:** Satu server action `perbaruiPermintaan` menggantikan `tetapkanKoordinatPermintaan`.
Panel merender medannya di server; hanya pembungkus `<form>` dan tombolnya yang klien. Tidak ada
migrasi.

**Tech Stack:** Next.js 16 (server component + server action), Supabase JS di sesi pengguna,
Tailwind, Leaflet lewat `PemilihLokasi` yang sudah ada.

**Spec:** `docs/superpowers/specs/2026-09-09-padma-ubah-permintaan-design.md`

## Batasan Global

- **NOL UJI BARU.** Keputusan pemilik repo, ditegaskan dua kali. Yang dikerjakan hanyalah menjaga
  uji yang sudah ada tetap hijau. Setiap tugas diakhiri **verifikasi manual oleh pemilik repo**.
- **Jangan jalankan `npm test` penuh.** Supabase lokal dipakai bersama sesi lain. Berkas uji
  bertarget (termasuk yang ber-DB) BOLEH dijalankan.
- **Jangan `supabase db push`.** Tidak ada migrasi.
- `npx tsc --noEmit` dan `npm run lint` wajib bersih di akhir SETIAP tugas. Tidak ada tugas yang
  boleh meninggalkan build merah dalam rencana ini.
- Jalankan perintah dari `/Users/arvinfairuz/Documents/padma/web`.
- Komentar dan pengenal berbahasa Indonesia.
- Bacaan & tulisan memakai `createServerSupabase()` (sesi pengguna), bukan service role.
- Setiap UPDATE diperiksa **jumlah barisnya**, bukan hanya `error` — RLS menjawab `200 + []`.
- `status` tidak pernah masuk payload update; bidan tidak pernah dilepas otomatis (spec K2).
- Nol rupiah di layar admin.

---

## Struktur Berkas

| Berkas | Tanggung jawab | Aksi |
|---|---|---|
| `src/lib/jadwal/status.ts` | Sumber tunggal nama status | Modifikasi — `STATUS_UBAH_PERMINTAAN` |
| `src/app/admin/sesi/aksi-ubah-permintaan.ts` | Server action ubah permintaan | **Baru** |
| `src/app/admin/sesi/aksi-koordinat.ts` | Server action pin (lama) | **Hapus** di Tugas 2 |
| `src/app/admin/sesi/aksi-permintaan.tsx` | Komponen klien panel | Modifikasi — `FormUbahPermintaan` |
| `src/app/admin/sesi/panel-permintaan.tsx` | Penyaji panel (server) | Modifikasi besar |
| `src/app/admin/sesi/page.tsx` | Halaman | Modifikasi — prop `jamPilihan`, `tautanWaPercakapan` |
| `src/lib/tagihan/pesan-tagihan.ts` | Perakit tautan WA | Modifikasi — `tautanWaPercakapan` |

---

### Task 1: Konstanta status + server action `perbaruiPermintaan`

Aditif seluruhnya — tidak ada yang memanggilnya sampai Tugas 2, dan build tetap hijau.

**Files:**
- Modify: `src/lib/jadwal/status.ts`
- Create: `src/app/admin/sesi/aksi-ubah-permintaan.ts`

**Interfaces:**
- Produces: `STATUS_UBAH_PERMINTAAN`;
  `perbaruiPermintaan(permintaanId: string, formData: FormData) → Promise<{ ok: true } | { ok: false; pesan: string }>`.

- [ ] **Step 1: Konstanta himpunan status**

Di `src/lib/jadwal/status.ts`, tepat sesudah `STATUS_ANTRE`, tambahkan:

```ts
/**
 * Keadaan yang masih boleh DIUBAH admin (tanggal, jam, alamat).
 *
 * SENGAJA BUKAN `STATUS_ANTRE`, walau ketiganya adalah anggotanya. `STATUS_ANTRE`
 * memuat `menunggu_bayar` juga, dan di keadaan itu tagihan SUDAH terbit: nominal
 * transportnya sudah dihitung, pesannya sudah ada di tangan klien, dan tenggat 24
 * jamnya sudah berjalan. Mengubah tanggal atau alamat sesudah itu membuat tagihan
 * yang sudah dikirim tidak lagi benar — tanpa satu pun galat.
 *
 * Di ketiga keadaan di bawah tidak ada nominal basi yang tertinggal: jenjang
 * transport baru dihitung `konfirmasi_permintaan` pada saat konfirmasi, dari
 * koordinat yang berlaku saat itu.
 */
export const STATUS_UBAH_PERMINTAAN: readonly StatusPermintaan[] = [
  "diminta",
  "mencari_mitra",
  "mitra_siap",
];
```

- [ ] **Step 2: Server action**

Buat `src/app/admin/sesi/aksi-ubah-permintaan.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { koordinatDariFormData } from "@/lib/transport/koordinat-form";
import { geocodeAlamat } from "@/lib/transport/geocode";
import { STATUS_UBAH_PERMINTAAN } from "@/lib/jadwal/status";
import { bacaPengaturan } from "@/lib/settings";
import { hariIniJakarta } from "@/lib/passport/waktu";

/**
 * Mengubah alamat, tanggal, dan jam sebuah PERMINTAAN — satu aksi, satu
 * formulir (spec K3).
 *
 * Menggantikan `tetapkanKoordinatPermintaan`. Dilebur karena dua tempat yang
 * sama-sama menulis `alamat_lat` dengan aturan berbeda adalah bentuk yang
 * melahirkan dua baris bercerita beda tentang tempat yang sama.
 *
 * Berkas `"use server"` hanya boleh mengekspor fungsi async.
 */
type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true };

type BarisSebelum = {
  alamat: string;
  alamat_lat: number | null;
  alamat_lon: number | null;
};

export async function perbaruiPermintaan(
  permintaanId: string,
  formData: FormData,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const alamat = String(formData.get("alamat") ?? "").trim();
  const tanggal = String(formData.get("tanggal") ?? "").trim();
  const jam = String(formData.get("jam") ?? "").trim();

  if (alamat === "") {
    return { ok: false, pesan: "Alamat kunjungan tidak boleh kosong." };
  }

  // ===== TANGGAL & JAM DIPERIKSA DI SINI, DAN HANYA DI SINI (spec K8/L2) =====
  // `guard_booking_pembatas` memeriksa keduanya untuk KLIEN saja — badannya
  // dibuka `if user_role() = 'klien'`. Untuk admin, basis data TIDAK MEMERIKSA
  // APA PUN: tidak ada trigger, constraint, maupun policy yang menahan tanggal
  // di masa lalu atau jam di luar jam layanan. Kalau kedua pemeriksaan di bawah
  // dihapus atau dilewati jalur tulis lain, tidak ada jaring apa pun di
  // bawahnya, dan kegagalannya SENYAP.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    return { ok: false, pesan: "Tanggal tidak sah." };
  }
  // Kalender ASIA/JAKARTA, bukan jam server: Vercel berjalan UTC, dan antara
  // 17:00–24:00 UTC tanggal Jakarta sudah besok.
  if (tanggal < hariIniJakarta()) {
    return { ok: false, pesan: "Tanggal tidak boleh di masa lalu." };
  }

  const { jamLayanan } = await bacaPengaturan();
  if (!jamLayanan.includes(jam)) {
    return { ok: false, pesan: "Jam itu tidak termasuk jam layanan klinik." };
  }

  const supabase = await createServerSupabase();

  // Baris dibaca lebih dulu, dan disaring status di sini juga: alamat LAMA yang
  // memutuskan apakah koordinat perlu dicari ulang. Tanpa pembacaan ini,
  // pilihannya tinggal selalu menggeocode ulang — membakar kuota Nominatim
  // untuk alamat yang tidak berubah — atau tidak pernah, yang meninggalkan
  // koordinat menunjuk tempat lain.
  const { data: sebelum } = await supabase
    .from("booking_requests")
    .select("alamat, alamat_lat, alamat_lon")
    .eq("id", permintaanId)
    .in("status", [...STATUS_UBAH_PERMINTAAN])
    .maybeSingle<BarisSebelum>();

  if (!sebelum) {
    return {
      ok: false,
      pesan:
        "Permintaan ini tidak bisa diubah lagi — tagihannya mungkin sudah terbit, atau sudah ditangani.",
    };
  }

  // ===== PIN MENANG (konvensi yang sama dengan form mitra) =====
  // Bila admin menjatuhkan pin, koordinat itu yang dipakai dan Nominatim TIDAK
  // ditanya sama sekali — menanyakan alamat yang jawabannya sudah pasti dibuang
  // hanya membakar kuota gratis milik pihak lain, dan pada volume nyata itulah
  // yang memicu pemblokiran.
  //
  // Tanpa pin, alamat yang BERUBAH membuang koordinat lama lalu menggeocode
  // sekali: koordinat lama menandai TEMPAT LAIN, dan mempertahankannya berarti
  // jenjang transport dihitung untuk lokasi yang bukan alamat kunjungan —
  // hasilnya keluar rapi, tanpa satu pun galat.
  //
  // Alamat yang SAMA mempertahankan koordinat lama apa adanya; tidak ada yang
  // perlu ditanyakan ulang.
  const pin = koordinatDariFormData(formData);
  const alamatBerubah = alamat !== sebelum.alamat;
  const koordinatLama =
    sebelum.alamat_lat !== null && sebelum.alamat_lon !== null
      ? { lat: sebelum.alamat_lat, lon: sebelum.alamat_lon }
      : null;

  const koordinat = pin ?? (alamatBerubah ? await geocodeAlamat(alamat) : koordinatLama);

  const { data, error } = await supabase
    .from("booking_requests")
    .update({
      alamat,
      tanggal,
      jam_mulai: jam,
      alamat_lat: koordinat?.lat ?? null,
      alamat_lon: koordinat?.lon ?? null,
    })
    .eq("id", permintaanId)
    .in("status", [...STATUS_UBAH_PERMINTAAN])
    .select("id");

  // 23505 = indeks `booking_requests_antrean_unik`
  // (client_id, service_id, tanggal, preferensi_waktu) untuk status
  // pra-konfirmasi. Tanpa terjemahan ini admin membaca kode Postgres dan
  // menyimpulkan sistemnya rusak, padahal yang terjadi punya nama.
  if (error?.code === "23505") {
    return {
      ok: false,
      pesan: "Klien ini sudah punya permintaan lain untuk layanan dan tanggal yang sama.",
    };
  }

  // UPDATE yang tertahan RLS dijawab PostgREST dengan 200 + [] — melaporkan
  // "berhasil" tanpa memeriksa jumlah barisnya adalah kebohongan senyap.
  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Gagal menyimpan perubahan. Coba lagi." };
  }

  revalidatePath("/admin/sesi");
  return { ok: true };
}
```

- [ ] **Step 3: Verifikasi**

```bash
cd web && npx tsc --noEmit && npm run lint
npx vitest run tests/status-satu-sumber.test.ts
```

Harapan: semuanya bersih/hijau. Berkas pagar `status-satu-sumber` ikut dijalankan karena tugas ini
menambah nilai status — bila ia merah, yang salah adalah tempat literalnya ditulis, bukan pagarnya.

- [ ] **Step 4: Commit**

```bash
git add src/lib/jadwal/status.ts src/app/admin/sesi/aksi-ubah-permintaan.ts
git commit -m "feat(sesi): server action ubah alamat, tanggal & jam permintaan

Tanggal & jam diperiksa di sini dan HANYA di sini: guard_booking_pembatas
berbunyi \`if user_role() = 'klien'\`, jadi untuk admin basis data tidak
memeriksa apa pun."
```

---

### Task 2: Formulir "Ubah permintaan" di panel

**Files:**
- Modify: `src/app/admin/sesi/aksi-permintaan.tsx`
- Modify: `src/app/admin/sesi/panel-permintaan.tsx`
- Modify: `src/app/admin/sesi/page.tsx`
- Delete: `src/app/admin/sesi/aksi-koordinat.ts`

**Interfaces:**
- Consumes: `perbaruiPermintaan` (Task 1), `STATUS_UBAH_PERMINTAAN` (Task 1).
- Produces: `FormUbahPermintaan` (klien) menggantikan `FormPinPermintaan`.

- [ ] **Step 1: Ganti `FormPinPermintaan` dengan `FormUbahPermintaan`**

Di `src/app/admin/sesi/aksi-permintaan.tsx`, ganti impor `tetapkanKoordinatPermintaan` menjadi
`perbaruiPermintaan` dari `./aksi-ubah-permintaan`, dan ganti seluruh `FormPinPermintaan` dengan:

```tsx
/**
 * Pembungkus formulir "Ubah permintaan".
 *
 * SELURUH medannya — alamat, tanggal, jam, dan peta — dirender halaman di
 * SERVER lalu dioper masuk sebagai `anak`. Yang klien di sini hanya `<form>`,
 * tombolnya, dan tempat pesan galat mendarat. Suite proyek ini berjalan tanpa
 * jsdom, jadi apa pun yang hanya lahir sesudah hidrasi tidak bisa diperiksa
 * sama sekali.
 */
export function FormUbahPermintaan({
  permintaanId,
  anak,
}: {
  permintaanId: string;
  anak: ReactNode;
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  return (
    <form
      action={(formData) =>
        mulai(async () => {
          const r = await perbaruiPermintaan(permintaanId, formData);
          setPesan(r.ok ? "Perubahan tersimpan." : r.pesan);
        })
      }
    >
      {anak}
      <button type="submit" disabled={pending} className={`mt-2 ${KELAS_UTAMA}`}>
        {pending ? "Menyimpan…" : "Simpan perubahan"}
      </button>
      {pesan && <p className="mt-1 text-[12px] font-semibold text-ink-soft">{pesan}</p>}
    </form>
  );
}
```

- [ ] **Step 2: Bagian "Ubah permintaan" di panel**

Di `src/app/admin/sesi/panel-permintaan.tsx`:

- Tambahkan prop `jamPilihan: string[]` dan `tanggalIso: string` (nilai `YYYY-MM-DD` mentah untuk
  `<input type="date">` — prop `tanggal` yang sudah ada sudah diformat untuk manusia dan tidak bisa
  dipakai sebagai nilai medan).
- Impor `FormUbahPermintaan` (bukan `FormPinPermintaan`), `STATUS_UBAH_PERMINTAAN`, dan `formatJam`
  dari `@/lib/jadwal/jam`.
- **`preferensi_waktu` TIDAK diberi medan** (spec K5). Ia preferensi milik klien atas alternatif
  waktu, dan ia juga bagian dari kunci indeks dedup — mengubahnya diam-diam mengubah baris mana yang
  dianggap kembar. Jangan menambahkannya "sekalian".
- **Hapus** `<input type="hidden" name="alamat" …>`. Ia dipasang agar tombol "Cari alamat di peta"
  menemukan alamatnya; dengan textarea `name="alamat"` sungguhan di dalam form, penambal itu tidak
  diperlukan lagi — dan dua medan bernama sama dalam satu form membuat `namedItem` memulangkan
  koleksi, bukan satu elemen.

Ganti seluruh bagian alamat (cabang berkoordinat/tanpa-koordinat beserta `FormPinPermintaan`)
dengan satu bagian:

```tsx
      <section>
        <p className="text-[12.5px] font-bold text-panel-muted">Alamat kunjungan</p>
        {!bisaDiubah ? (
          <>
            <p className="mt-1 whitespace-pre-line text-[12.5px] text-panel-ink">
              {permintaan.alamat || "—"}
            </p>
            {berkoordinat ? (
              <p className="mt-1 text-[11px] text-panel-muted">
                Pin: {permintaan.alamatLat!.toFixed(6)}, {permintaan.alamatLon!.toFixed(6)}
              </p>
            ) : (
              <p className="mt-2 rounded-lg bg-clay/10 px-3 py-2 text-[12px] font-semibold text-clay">
                Alamat ini belum berkoordinat, dan tidak bisa diubah lagi dari layar ini.
              </p>
            )}
          </>
        ) : (
          <FormUbahPermintaan
            permintaanId={permintaan.id}
            anak={
              <>
                {!berkoordinat && (
                  /* Kalimat menyebut AKIBATNYA, bukan hanya keadaannya. "Belum
                     berkoordinat" saja tidak memberi tahu admin bahwa sesi yang
                     lahir dari sini akan menuntut jenjang transport ditetapkan
                     tangan belakangan. */
                  <p className="mb-2 rounded-lg bg-clay/10 px-3 py-2 text-[12px] font-semibold text-clay">
                    Alamat ini belum berkoordinat. Jarak ke bidan tidak bisa dihitung, dan sesi yang
                    lahir darinya tidak akan punya jenjang transport.
                  </p>
                )}

                <label className="block">
                  <span className="text-[12px] font-bold text-panel-muted">Alamat</span>
                  <textarea
                    name="alamat"
                    rows={2}
                    defaultValue={permintaan.alamat}
                    className="mt-1 w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13px] text-panel-ink"
                  />
                </label>

                <div className="mt-2 flex flex-wrap gap-2">
                  <label className="flex-1">
                    <span className="text-[12px] font-bold text-panel-muted">Tanggal</span>
                    <input
                      type="date"
                      name="tanggal"
                      defaultValue={tanggalIso}
                      className="mt-1 w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13px] text-panel-ink"
                    />
                  </label>
                  <label className="flex-1">
                    <span className="text-[12px] font-bold text-panel-muted">Jam</span>
                    {/* Daftarnya sama dengan yang ditawarkan ke klien, supaya dua
                        jalur tidak melahirkan dua kebiasaan jam yang berbeda. */}
                    <select
                      name="jam"
                      defaultValue={permintaan.jamMulai.slice(0, 5)}
                      className="mt-1 w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13px] text-panel-ink"
                    >
                      {jamPilihan.map((j) => (
                        <option key={j} value={j}>
                          {formatJam(j)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* Peta SELALU ada di sini, tidak lagi hanya saat koordinat
                    kosong: pin salah klik sebelumnya tidak bisa dikoreksi dari
                    layar mana pun, dan pin yang salah menghasilkan jenjang
                    transport yang percaya diri dan salah — bukan NULL yang akan
                    tertangkap StatTile "menunggu jenjang". */}
                <PemilihLokasi
                  awal={berkoordinat ? { lat: permintaan.alamatLat!, lon: permintaan.alamatLon! } : null}
                  kalimatKosong="Belum ada pin. Klik di peta untuk menandai lokasinya — bila teks alamat diubah, sistem mencoba menebak koordinatnya sekali."
                />
              </>
            }
          />
        )}
        {/* Lisensi ODbL menuntut atribusi tampak di layar yang memakai
            hasilnya, bukan cukup di komentar kode. */}
        <p className="mt-1 text-[11px] text-panel-muted">
          Peta &amp; lokasi dari data © OpenStreetMap contributors.
        </p>
      </section>
```

dengan, di puncak komponen:

```tsx
  const berkoordinat = permintaan.alamatLat !== null && permintaan.alamatLon !== null;
  const bisaDiubah = STATUS_UBAH_PERMINTAAN.includes(permintaan.status);
```

Dan tepat di bawah bagian itu, peringatan bidan (spec K2) — hanya saat bidan sudah ditetapkan:

```tsx
      {permintaan.namaMitra !== null && bisaDiubah && (
        /* Bidan TIDAK dilepas otomatis saat jadwal atau alamat berubah (spec
           K2): sistem tidak tahu jadwal, cuti, maupun kesediaan bidan, jadi ia
           tidak berhak melepas orang berdasarkan pengetahuan yang tidak
           dimilikinya. Yang bisa ia lakukan adalah mengatakannya. */
        <p className="rounded-lg bg-gold/15 px-3 py-2 text-[12px] font-semibold text-[#8A6A16]">
          {permintaan.namaMitra} ditetapkan untuk jadwal &amp; alamat sebelum perubahan. Pastikan
          ulang ke beliau, atau tekan “Ganti bidan”.
        </p>
      )}
```

- [ ] **Step 3: Halaman mengoper prop baru**

Di `src/app/admin/sesi/page.tsx`, pada pemakaian `<PanelPermintaan …>`, tambahkan:

```tsx
            jamPilihan={jamLayanan}
            tanggalIso={barisLihat.tanggal}
```

`jamLayanan` sudah ditarik di berkas ini lewat `bacaPengaturan()`; jangan menariknya dua kali.

- [ ] **Step 4: Hapus server action lama**

```bash
cd web && git rm src/app/admin/sesi/aksi-koordinat.ts
grep -rn "aksi-koordinat\|tetapkanKoordinatPermintaan\|FormPinPermintaan" src/ tests/
```

Harapan: nol hasil.

- [ ] **Step 5: Verifikasi**

```bash
cd web && npx tsc --noEmit && npm run lint
npx vitest run tests/pagar-batas-server-klien.test.ts tests/pembatalan-klien.test.ts \
  tests/admin-sesi-konfirmasi.test.ts tests/admin-sesi-catatan.test.ts
```

Harapan: semuanya hijau. Bila sebuah uji merah karena menegaskan teks lama ("Simpan pin"), perbaiki
teks yang diharapkan — **jangan** melemahkan assertion-nya. Bila pagar batas server/klien merah,
yang dibetulkan adalah kodenya, bukan pagarnya.

- [ ] **Step 6: Commit**

```bash
git add -A src/app/admin/sesi
git commit -m "feat(sesi): satu formulir ubah alamat, tanggal & jam menggantikan formulir pin

Peta kini selalu tersedia, jadi pin salah klik bisa dikoreksi — pin salah
menghasilkan jenjang transport yang percaya diri dan salah, bukan NULL yang
akan tertangkap StatTile."
```

---

### Task 3: Tombol "Hubungi klien"

**Files:**
- Modify: `src/lib/tagihan/pesan-tagihan.ts`
- Modify: `src/app/admin/sesi/panel-permintaan.tsx`
- Modify: `src/app/admin/sesi/page.tsx`

**Interfaces:**
- Produces: `tautanWaPercakapan(nomorWa: string): string`; prop `tautanWaKosong: string` pada
  `PanelPermintaan`.

- [ ] **Step 1: Perakit tautan**

Di `src/lib/tagihan/pesan-tagihan.ts`, tepat di bawah `tautanWaTagihan`:

```ts
/**
 * Percakapan WhatsApp KOSONG — tanpa `?text=` sama sekali.
 *
 * Sengaja tanpa template (spec K6). Repo ini sudah dua kali salah menuliskan
 * kebijakan pembatalan dari ingatan, dan pesan siap-tempel yang menyebut aturan
 * adalah cara tercepat mengulanginya. Tagihan tetap bertemplat karena nominal
 * dan sisa waktunya DIHITUNG SERVER, bukan diingat manusia.
 */
export function tautanWaPercakapan(nomorWa: string): string {
  return `https://wa.me/${nomorWa}`;
}
```

- [ ] **Step 2: Halaman merakit tautannya**

Di `src/app/admin/sesi/page.tsx`, di sebelah `tautanWaUntukLihat`, tambahkan:

```ts
  // Tersedia di SEMUA status, termasuk permintaan yang sudah batal — menghubungi
  // klien tidak pernah berbahaya, dan justru permintaan yang batal karena tenggat
  // itulah yang paling perlu dijelaskan.
  //
  // Nomornya lewat `nomorWaKlien`, yang sengaja TANPA nomor cadangan klinik:
  // versi sebelumnya memakai setelan `nomor_wa` dan bentuk kegagalannya tidak
  // terlihat sebagai galat — WhatsApp terbuka rapi, hanya saja lawan bicaranya
  // PADMA sendiri.
  const tautanWaKosongUntukLihat =
    barisLihat && nomorWaKlien(barisLihat.noHpKlien)
      ? tautanWaPercakapan(nomorWaKlien(barisLihat.noHpKlien))
      : "";
```

Impor `tautanWaPercakapan` bersama `tautanWaTagihan` yang sudah ada, dan oper
`tautanWaKosong={tautanWaKosongUntukLihat}` ke `<PanelPermintaan>`.

- [ ] **Step 3: Tombol di panel**

Tambahkan prop `tautanWaKosong: string` pada `PanelPermintaan`, dan di bagian ringkasan — tepat di
bawah baris nama klien & PADMA ID — sisipkan:

```tsx
        {tautanWaKosong ? (
          <a
            href={tautanWaKosong}
            target="_blank"
            rel="noopener"
            className="mt-2 inline-block rounded-lg border border-black/15 px-3 py-1.5 text-[12px] font-bold text-ink-soft"
          >
            Hubungi klien via WA
          </a>
        ) : (
          /* Tombolnya HILANG ketika nomor klien tidak sah, dan kalimat ini yang
             membuat hilangnya terlihat. Tanpa kalimat, admin membaca layar yang
             sama persis seperti layar yang benar dan menyimpulkan nomornya ada. */
          <p className="mt-2 text-[12px] font-semibold text-clay">
            Nomor WhatsApp klien belum sah — lengkapi di menu Klien.
          </p>
        )}
```

- [ ] **Step 4: Verifikasi**

```bash
cd web && npx tsc --noEmit && npm run lint
npx vitest run tests/admin-sesi-konfirmasi.test.ts tests/admin-sesi-catatan.test.ts
```

Harapan: hijau.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tagihan/pesan-tagihan.ts src/app/admin/sesi/panel-permintaan.tsx src/app/admin/sesi/page.tsx
git commit -m "feat(sesi): tombol hubungi klien — percakapan WA kosong, tanpa template

Tersedia di semua status. Tanpa template karena pesan siap-tempel yang
menyebut kebijakan adalah cara tercepat mengulangi kesalahan yang sudah
dua kali terjadi."
```

---

## Verifikasi Manual (pemilik repo)

Dalam mode nol uji baru, inilah satu-satunya pembuktian.

1. **Hubungi klien** muncul di panel pada semua status, membuka WhatsApp ke nomor klien dengan
   percakapan kosong. Pada klien bernomor tidak sah, tombolnya hilang dan kalimat clay muncul.
2. **Ubah jam** pada permintaan `diminta` → tersimpan, dan jam baru tampil di daftar.
3. **Ubah tanggal ke kemarin** → ditolak dengan kalimat, bukan tersimpan. *(Ini satu-satunya pagar
   yang ada — basis data tidak akan menangkapnya.)*
4. **Ubah alamat** ke alamat lain → pin lama hilang; bila Nominatim gagal, peringatan "belum
   berkoordinat" muncul kembali dan peta siap diklik.
5. **Pindahkan pin tanpa mengubah alamat** → koordinat baru tersimpan (pin menang).
6. **Simpan tanpa mengubah apa pun** pada permintaan yang sudah berkoordinat → koordinatnya **tetap**
   (tidak hilang, tidak digeocode ulang).
7. Pada `mitra_siap`: ubah tanggal → **peringatan bidan muncul**, dan bidannya **tidak** dilepas.
8. Pada `menunggu_bayar`: **tidak ada** formulir ubah — hanya alamat sebagai teks.
9. Buat dua permintaan klien yang sama untuk layanan & tanggal berbeda, lalu ubah salah satunya agar
   tanggalnya bertabrakan → muncul kalimat *"Klien ini sudah punya permintaan lain…"*, bukan kode
   Postgres.
10. Sesudah mengubah alamat + menjatuhkan pin, jalankan sampai **Konfirmasi jadwal** dan pastikan
    sesinya lahir dengan **jenjang transport terisi**.

---

## Tindak Lanjut (tidak dikerjakan di sini)

1. **Tidak ada jejak siapa mengubah apa** (spec L1). Penutupnya tabel `jejak_permintaan`
   tersendiri, bukan memperlebar `jejak_jadwal`.
2. **Validasi tanggal & jam hanya hidup di TypeScript** (spec L2). Penutupnya memperluas
   `guard_booking_pembatas` ke peran staf — sebuah migrasi.
3. **Nol uji baru** (spec L3): PIN MENANG dan ketiga cabangnya, penolakan tanggal masa lalu & jam
   di luar jam layanan, penerjemahan 23505, penolakan `menunggu_bayar`, dan RLS di sesi klien —
   semuanya tanpa penjaga uji.
