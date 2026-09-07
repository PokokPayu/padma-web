import { formatTanggalID, sudahLewat } from "./waktu";
import { labelVarian, type FormatVarian } from "@/lib/varian";
import { LABEL_JENJANG, type JenjangTransport } from "@/lib/transport/jarak";

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
  /**
   * Rincian transport (Task 9, Ruling 16 — fix round 1). `null` untuk SETIAP
   * item paket, dan untuk item sesi yang tidak berjenjang atau berjenjang
   * `di_atas_20` (lihat gerbang di `susunTagihan()`).
   *
   * SENGAJA sebuah MEDAN pada item sesi yang sudah ada — BUKAN item kedua
   * ber-`id` yang sama. Draf pertama Task 9 menambahkan
   * `item.push({ jenis: "sesi", id: s.id, ... })` KEDUA untuk transport, dan
   * itu ternyata bug, bukan sekadar gaya: `key={`${t.jenis}-${t.id}`}` di
   * `app/passport/bayar/page.tsx` membuatnya identik dengan baris sesi
   * induknya, dan React boleh mencampur STATE dua `<TombolKlaim>` client
   * component yang keduanya ber-key sama — klien melihat dua tombol "Saya
   * sudah bayar" untuk satu pembayaran, di dalam dua elemen yang React sendiri
   * tidak bisa membedakan. Satu sesi punya SATU `status_bayar`, jadi ia wajib
   * menghasilkan SATU item — transport hanya boleh menjadi rincian di
   * dalamnya, dirender sebagai sub-baris tanpa tombol sendiri.
   */
  rincianTransport: string | null;
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
    // Paket tidak pernah punya rincian transport sendiri: harganya tetap/
    // pre-paid per paket, bukan per sesi — lihat Ruling 18 di `hitungRekap()`
    // (lib/owner/rekap.ts) untuk keputusan uang yang sama pada sisi owner.
    rincianTransport: null,
    status: p.statusBayar,
  }));

  // Hanya sesi LEPAS yang menjadi item. `sessions.status_bayar` untuk sesi
  // berpaket tidak relevan dan memang kontradiktif di data nyata — memakainya
  // akan melahirkan "tagihan hantu" saat presentasi. Konsekuensinya sesi
  // BERPAKET yang berjenjang pun tidak pernah sampai ke loop ini sama sekali
  // — rincian transportnya menunggu spec paket yang sama (Ruling 18), bukan
  // hilang sendirian di sini.
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

    // Rincian TRANSPORT (Task 9) — TANPA NOMINAL sama sekali (money
    // firewall): klien di sini tidak pernah berhak baca
    // `transport_rates`/`transport_khusus` (RLS "hanya owner"), jadi
    // teksnya murni jenjang + tanggal, dari `LABEL_JENJANG`
    // (`@/lib/transport/jarak`) — SATU-SATUNYA sumber, sama persis yang
    // dipakai `daftarTagihanAdmin()` (`@/lib/admin/tagihan`).
    //
    // `di_atas_20` SENGAJA DIKECUALIKAN (Ruling 17): materi klien menulis
    // ">20 km: konfirmasi admin" — KETIADAAN tarif otomatis, dirundingkan
    // langsung per kasus, bukan lewat baris otomatis. Klien di sini juga
    // TIDAK PUNYA cara memverifikasi apakah owner sudah menetapkan tarif
    // khususnya (RLS yang sama menutup `transport_khusus` dari klien maupun
    // admin) — menampilkan rincian transport untuk sesi yang nominalnya
    // belum pernah ditetapkan siapa pun akan menagih sesuatu yang belum ada.
    // Rate-card jenjang lain (`0_5`..`15_20`) tidak punya masalah ini: sekali
    // owner menetapkan tarif SATU jenjang, tarif itu otomatis berlaku untuk
    // SETIAP sesi jenjang itu — bukan keputusan per sesi seperti `di_atas_20`.
    const rincianTransport =
      s.jenjang !== null && s.jenjang !== "di_atas_20"
        ? `Transport · ${LABEL_JENJANG[s.jenjang]} · ${formatTanggalID(s.tanggal)}`
        : null;

    item.push({
      jenis: "sesi",
      id: s.id,
      label:
        varLabel === ""
          ? `${s.namaLayanan} · ${formatTanggalID(s.tanggal)}`
          : `${s.namaLayanan} · ${varLabel} · ${formatTanggalID(s.tanggal)}`,
      rincianTransport,
      status: s.statusBayar,
    });
  }
  return item;
}
