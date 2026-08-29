import { formatTanggalID, sudahLewat } from "./waktu";

export type StatusSesi = "terjadwal" | "selesai" | "batal";
export type PayStatus = "belum" | "menunggu_verifikasi" | "lunas";

export type SesiRingkas = {
  id: string;
  serviceId: string;
  namaLayanan: string;
  namaMitra: string;
  tanggal: string;          // YYYY-MM-DD
  status: StatusSesi;
  clientPackageId: string | null;
  catatan: string;
  rekomendasi: string;
  statusBayar: PayStatus;
};

export type PaketRingkas = {
  id: string;
  nama: string;
  jumlahSesi: number;
  statusBayar: PayStatus;
};

// `tanggal` sudah berupa string YYYY-MM-DD, jadi urutan leksikografis = urutan
// kronologis. Komparator ini sengaja mengembalikan 0 untuk tanggal kembar:
// komparator yang mengembalikan 1 untuk elemen setara melanggar kontrak
// Array#sort dan bisa menghasilkan urutan yang salah pada TimSort V8.
const urutTanggal = (a: SesiRingkas, b: SesiRingkas) =>
  a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0;

const selesaiDalamPaket = (sesi: SesiRingkas[]) =>
  sesi
    .filter((s) => s.status === "selesai" && s.clientPackageId !== null)
    .sort(urutTanggal);

export function progresPaket(input: {
  totalSesi: number | null;
  sesi: SesiRingkas[];
}): { selesai: number; total: number; persen: number } | null {
  if (input.totalSesi === null) return null; // klien sesi-lepas (model hybrid)
  const selesai = selesaiDalamPaket(input.sesi).length;
  // `packages.jumlah_sesi` bisa diedit admin sehingga penyebut menyusut
  // retroaktif — persen dibatasi 100 supaya angka tetap jujur.
  const persen = input.totalSesi > 0
    ? Math.min(100, Math.round((selesai / input.totalSesi) * 100))
    : 0;
  return { selesai, total: input.totalSesi, persen };
}

export function sesiBerikutnya(
  sesi: SesiRingkas[],
  sekarang: string,
): SesiRingkas | null {
  const calon = sesi
    .filter((s) => s.status === "terjadwal" && !sudahLewat(s.tanggal, sekarang))
    .sort(urutTanggal);
  return calon[0] ?? null;
}

export function gridStempel(input: {
  totalSesi: number;
  sesi: SesiRingkas[];
  sekarang: string;
}): Array<{ jenis: "terisi" | "berikutnya" | "kosong"; tanggal?: string }> {
  const terisi = selesaiDalamPaket(input.sesi);
  const berikut = sesiBerikutnya(
    input.sesi.filter((s) => s.clientPackageId !== null),
    input.sekarang,
  );
  const slot: Array<{ jenis: "terisi" | "berikutnya" | "kosong"; tanggal?: string }> = [];
  for (let i = 0; i < input.totalSesi; i++) {
    if (i < terisi.length) slot.push({ jenis: "terisi", tanggal: terisi[i].tanggal });
    else if (i === terisi.length && berikut) slot.push({ jenis: "berikutnya", tanggal: berikut.tanggal });
    else slot.push({ jenis: "kosong" });
  }
  return slot;
}

export function badgeDari(sesi: SesiRingkas[]): Array<{ serviceId: string; nama: string }> {
  const peta = new Map<string, string>();
  for (const s of sesi) {
    if (s.status === "selesai") peta.set(s.serviceId, s.namaLayanan);
  }
  return [...peta].map(([serviceId, nama]) => ({ serviceId, nama }));
}

export type ItemTagihan = {
  jenis: "paket" | "sesi";
  id: string;
  label: string;
  status: PayStatus;
};

export function susunTagihan(input: {
  paket: PaketRingkas[];
  sesi: SesiRingkas[];
}): ItemTagihan[] {
  // Anotasi tipe eksplisit: tanpa ini TypeScript menyimpulkan tipe array dari
  // .map() sebagai {jenis:"paket"} dan push item "sesi" akan gagal kompilasi.
  const item: ItemTagihan[] = input.paket.map((p) => ({
    jenis: "paket",
    id: p.id,
    label: `${p.nama} · ${p.jumlahSesi} sesi`,
    status: p.statusBayar,
  }));

  // Hanya sesi LEPAS yang menjadi item. `sessions.status_bayar` untuk sesi
  // berpaket tidak relevan dan memang kontradiktif di data nyata — memakainya
  // akan melahirkan "tagihan hantu" saat presentasi.
  for (const s of input.sesi) {
    if (s.clientPackageId !== null) continue;
    if (s.status === "batal") continue;
    item.push({
      jenis: "sesi",
      id: s.id,
      label: `${s.namaLayanan} · ${formatTanggalID(s.tanggal)}`,
      status: s.statusBayar,
    });
  }
  return item;
}
