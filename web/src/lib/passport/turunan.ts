import { formatTanggalID, sudahLewat } from "./waktu";
import { labelVarian, type FormatVarian } from "@/lib/varian";
import type { JenjangTransport } from "@/lib/transport/jarak";
// Label jenjang dipakai ULANG dari modul Sesi admin — SATU-SATUNYA sumber,
// sama seperti `app/owner/transport/status.ts` sudah melakukannya. Menulis
// ulang lima label ini di sini akan melahirkan DUA daftar yang bisa berbeda
// nama pada perubahan berikutnya (persis kelas bug yang diperingatkan
// berulang kali di proyek ini untuk `labelVarian`/`tarifTransportPadaTanggal`).
import { LABEL_JENJANG } from "@/app/admin/sesi/status";

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
  /**
   * Jenjang jarak (Task 8/9) — `null` berarti jaraknya belum diketahui (sesi
   * lama, atau mitra belum ditentukan). `susunTagihan()` hanya menambahkan
   * baris transport ketika medan ini TERISI; tidak ada nominal di sini sama
   * sekali (money firewall) — labelnya murni jenjang + tanggal.
   */
  jenjang: JenjangTransport | null;
  /**
   * Varian yang dipesan sesi ini — dibawa mentah (bukan label jadi) supaya
   * `susunTagihan()` merangkainya lewat `labelVarian()` (`@/lib/varian`),
   * SATU-SATUNYA perangkai label varian di proyek ini, dan bukan lewat
   * perangkai kedua. Inilah yang membuat label yang dibaca KLIEN di sini
   * dan label yang dibaca ADMIN di `daftarTagihanAdmin()`
   * (`@/lib/admin/tagihan`) tidak pernah berpisah diam-diam.
   */
  varian: { label: string; durasiMenit: number | null; format: FormatVarian | null };
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
  //
  // Label menyertakan LABEL varian sejak layanan punya lebih dari satu harga:
  // dua sesi layanan yang sama bisa berbeda harga bila variannya berbeda (mis.
  // 60 menit vs 90 menit), dan nominal disampaikan lewat WhatsApp (keputusan
  // #10) — tanpa varian di label, klien tidak punya cara membedakan DUA
  // tagihan sesi yang sama layanan & tanggalnya. Dirangkai lewat sama persis
  // `labelVarian()` yang dipakai `daftarTagihanAdmin()` (`@/lib/admin/tagihan`)
  // — lihat komentar di `SesiRingkas.varian` di atas.
  for (const s of input.sesi) {
    if (s.clientPackageId !== null) continue;
    if (s.status === "batal") continue;
    const varLabel = labelVarian(s.varian);
    item.push({
      jenis: "sesi",
      id: s.id,
      label:
        varLabel === ""
          ? `${s.namaLayanan} · ${formatTanggalID(s.tanggal)}`
          : `${s.namaLayanan} · ${varLabel} · ${formatTanggalID(s.tanggal)}`,
      status: s.statusBayar,
    });

    // (Task 9) Baris TRANSPORT tambahan — hanya ketika jaraknya diketahui.
    // TANPA NOMINAL sama sekali (money firewall): klien di sini tidak pernah
    // berhak baca `transport_rates`/`transport_khusus` (RLS "hanya owner"),
    // jadi labelnya murni jenjang + tanggal, persis seperti rate card owner
    // menamainya (`LABEL_JENJANG`, `@/app/admin/sesi/status`).
    //
    // `id` & `jenis` SENGAJA SAMA PERSIS dengan baris sesi di atas — tidak ada
    // kolom `status_bayar` terpisah untuk transport, jadi "Tandai
    // lunas"/"Saya sudah bayar" pada baris ini melunasi SESI YANG SAMA, bukan
    // baris hantu ber-id palsu yang tidak pernah ada di `sessions`.
    if (s.jenjang !== null) {
      item.push({
        jenis: "sesi",
        id: s.id,
        label: `Transport · ${LABEL_JENJANG[s.jenjang]} · ${formatTanggalID(s.tanggal)}`,
        status: s.statusBayar,
      });
    }
  }
  return item;
}
