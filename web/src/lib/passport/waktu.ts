const ZONA = "Asia/Jakarta";

// en-CA menghasilkan YYYY-MM-DD — satu-satunya jalan aman mendapatkan
// "hari ini menurut Jakarta" tanpa aritmatika Date.
const FMT_ISO = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function hariIniJakarta(sekarang: Date = new Date()): string {
  return FMT_ISO.format(sekarang);
}

// Kolom `tanggal` bertipe date dan sudah berupa string YYYY-MM-DD.
// `new Date("2026-09-04")` = tengah malam UTC; di zona barat mundur sehari.
// Karena itu tanggal dirakit sebagai UTC tengah hari lalu diformat di zona
// Jakarta — aman untuk seluruh zona server.
function keDate(tgl: string): Date {
  return new Date(`${tgl}T12:00:00Z`);
}

const FMT_PANJANG = new Intl.DateTimeFormat("id-ID", {
  timeZone: ZONA,
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatTanggalID(tgl: string): string {
  return FMT_PANJANG.format(keDate(tgl));
}

const FMT_HARI = new Intl.DateTimeFormat("id-ID", { timeZone: ZONA, day: "numeric" });
const FMT_BULAN = new Intl.DateTimeFormat("id-ID", { timeZone: ZONA, month: "short" });

export function formatTanggalPendek(tgl: string): { hari: string; bulan: string } {
  return {
    hari: FMT_HARI.format(keDate(tgl)),
    bulan: FMT_BULAN.format(keDate(tgl)).replace(".", "").toUpperCase(),
  };
}

// Perbandingan tanggal = perbandingan string. Jangan pernah pakai getTime().
export function sudahLewat(tgl: string, sekarang: string): boolean {
  return tgl < sekarang;
}
