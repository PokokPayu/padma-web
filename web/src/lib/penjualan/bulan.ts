// ============================================================================
// BULAN JAKARTA — kunci bucket rekap penjualan
// ============================================================================
// KENAPA TIDAK MEMOTONG STRING ISO.
//
// `src/lib/owner/pekan.ts` sudah mengeja kelas kesalahannya untuk TANGGAL:
// stempel yang dipulangkan PostgREST adalah UTC, dan peristiwa pukul 06.30
// WIB tercatat 23.30Z HARI SEBELUMNYA. `iso.slice(0, 7)` karena itu
// memulangkan "2026-09" untuk pembelian yang bagi pembelinya — dan bagi
// pembukuan PADMA — terjadi pada 1 Oktober.
//
// Untuk tanggal, kesalahan itu menggeser satu tanda bayar. Untuk BULAN ia
// memindahkan seluruh omzet sebuah pembelian ke bulan pembukuan yang salah,
// dan hanya terjadi pada pembelian di jendela 17.00–24.00 UTC di hari
// terakhir/pertama bulan — yaitu cukup jarang untuk tidak pernah ketahuan,
// dan cukup sering untuk selalu salah sedikit.
//
// `Intl` dipakai untuk MENERJEMAHKAN zona (satu-satunya cara benar), dan
// aritmatika bulannya memakai bilangan bulat murni — tidak ada `Date` yang
// ditambah-kurang, jadi tidak ada DST maupun ICU yang bisa menggesernya.

const ZONA = "Asia/Jakarta";

/** Offset Jakarta TETAP +07:00 — WIB tidak pernah mengenal DST. */
const OFFSET = "+07:00";

const POLA_KUNCI = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * `en-CA` memulangkan tanggal ber-pola ISO, tetapi yang dipungut di bawah
 * adalah BAGIAN-nya (`formatToParts`), bukan stringnya — jadi perubahan data
 * ICU pada pemisah atau urutan tidak bisa menggeser hasilnya diam-diam.
 */
const FMT_BAGIAN = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA,
  year: "numeric",
  month: "2-digit",
});

const FMT_LABEL = new Intl.DateTimeFormat("id-ID", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

const FMT_LABEL_PENDEK = new Intl.DateTimeFormat("id-ID", {
  timeZone: "UTC",
  month: "short",
  year: "2-digit",
});

/**
 * Kunci bucket bulan menurut kalender Jakarta, mis. `"2026-10"`.
 *
 * `null` — bukan string kosong dan bukan lemparan — untuk stempel tak sah:
 * pemanggilnya menghitung uang, dan bucket hantu bernama `"NaN-NaN"` akan
 * mengumpulkan baris yang tidak pernah muncul di bulan mana pun.
 */
export function bulanJakarta(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;

  const bagian = FMT_BAGIAN.formatToParts(new Date(ms));
  const tahun = bagian.find((b) => b.type === "year")?.value;
  const bulan = bagian.find((b) => b.type === "month")?.value;
  if (!tahun || !bulan) return null;

  return `${tahun}-${bulan}`;
}

/** Bulan berjalan menurut jam JAKARTA, bukan jam proses (Vercel berjalan UTC). */
export function bulanSekarangJakarta(sekarang: Date = new Date()): string {
  return bulanJakarta(sekarang.toISOString()) ?? "";
}

function urai(kunci: string): { tahun: number; bulan: number } {
  const cocok = POLA_KUNCI.exec(kunci);
  if (!cocok) throw new Error(`Kunci bulan tak sah: ${kunci}`);
  return { tahun: Number(cocok[1]), bulan: Number(cocok[2]) };
}

function rakit(tahun: number, bulan: number): string {
  return `${String(tahun).padStart(4, "0")}-${String(bulan).padStart(2, "0")}`;
}

/**
 * `banyak` bulan berurutan yang BERAKHIR di `sampai`, terlama lebih dulu.
 *
 * Sumbu-X grafik dibangun dari SINI, bukan dari bulan yang kebetulan punya
 * data. Bulan tanpa penjualan yang hilang dari sumbu membuat tren yang
 * sebenarnya datar terbaca naik — dan grafik tren yang berbohong lebih buruk
 * daripada tidak ada grafik sama sekali.
 */
export function deretBulanTerakhir(sampai: string, banyak: number): string[] {
  let { tahun, bulan } = urai(sampai);
  const hasil: string[] = [];
  for (let i = 0; i < banyak; i++) {
    hasil.push(rakit(tahun, bulan));
    bulan -= 1;
    if (bulan === 0) {
      bulan = 12;
      tahun -= 1;
    }
  }
  return hasil.reverse();
}

/**
 * Rentang satu bulan sebagai stempel ber-offset Jakarta. Batas atas
 * EKSKLUSIF, jadi pemanggilnya memakai `.gte(mulai).lt(sampai)` — bukan
 * `.lte`, yang akan memungut pembelian tepat tengah malam tanggal 1 ke DUA
 * bulan sekaligus dan menghitung uangnya dua kali.
 */
export function rentangBulanJakarta(kunci: string): { mulai: string; sampai: string } {
  const { tahun, bulan } = urai(kunci);
  const tahunBerikut = bulan === 12 ? tahun + 1 : tahun;
  const bulanBerikut = bulan === 12 ? 1 : bulan + 1;
  return {
    mulai: `${rakit(tahun, bulan)}-01T00:00:00${OFFSET}`,
    sampai: `${rakit(tahunBerikut, bulanBerikut)}-01T00:00:00${OFFSET}`,
  };
}

/**
 * `timeZone: "UTC"` pada kedua formatter label BUKAN kelalaian: yang
 * diformat adalah tanggal buatan (hari ke-15 tengah malam UTC), bukan sebuah
 * peristiwa. Hari ke-15 dipilih supaya tidak ada offset zona mana pun yang
 * bisa menggesernya ke bulan tetangga.
 */
function keTanggalLabel(kunci: string): Date | null {
  const cocok = POLA_KUNCI.exec(kunci);
  if (!cocok) return null;
  return new Date(Date.UTC(Number(cocok[1]), Number(cocok[2]) - 1, 15));
}

export function labelBulan(kunci: string): string {
  const d = keTanggalLabel(kunci);
  return d === null ? "—" : FMT_LABEL.format(d);
}

export function labelBulanPendek(kunci: string): string {
  const d = keTanggalLabel(kunci);
  return d === null ? "—" : FMT_LABEL_PENDEK.format(d).replace(".", "");
}

const FMT_STEMPEL = new Intl.DateTimeFormat("id-ID", {
  timeZone: ZONA,
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * Label TANGGAL dari sebuah stempel waktu, mis. `"15 Okt 2026"`.
 *
 * Padanan `stempelJakarta` di `src/lib/owner/pekan.ts`, DISALIN ke sini
 * dengan sengaja alih-alih diimpor. Alasannya batas wilayah, bukan selera:
 * nol berkas di `src/app/admin/**` mengimpor dari `@/lib/owner/` hari ini,
 * dan `/admin/penjualan` tidak boleh menjadi yang pertama. Modul `penjualan`
 * dipakai KEDUA wilayah, jadi di sinilah tempat yang netral.
 *
 * Tanggalnya TIDAK boleh dipotong dari stringnya (`iso.slice(0, 10)`):
 * stempel itu UTC, dan pembelian pukul 06.30 WIB tercatat 23.30Z HARI
 * SEBELUMNYA.
 */
export function stempelTanggalJakarta(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return FMT_STEMPEL.format(new Date(ms)).replace(".", "");
}
