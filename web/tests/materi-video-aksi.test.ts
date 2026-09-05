import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SUMBER = readFileSync("src/app/admin/materi/unggah-video.ts", "utf8");

/** Memotong sumber menjadi badan satu fungsi, supaya asersi tidak bisa lolos
 *  hanya karena string yang dicari muncul di fungsi TETANGGA. */
function badan(nama: string): string {
  const mulai = SUMBER.indexOf(`export async function ${nama}`);
  if (mulai < 0) throw new Error(`fungsi ${nama} tidak ditemukan`);
  const berikut = SUMBER.indexOf("\nexport async function ", mulai + 1);
  return SUMBER.slice(mulai, berikut < 0 ? SUMBER.length : berikut);
}

describe("pagar server action video", () => {
  it("KEDUA action memanggil requireRole sendiri", () => {
    // Server action adalah endpoint mandiri; layout tidak menjaganya.
    for (const f of ["terbitkanUrlUnggahVideo", "catatVideoMateri"]) {
      expect(badan(f)).toContain('requireRole(["admin", "owner"])');
    }
  });

  it("penerbitan URL memeriksa batas SEBELUM menandatangani", () => {
    // ContentLength memagari ukuran PERSIS, bukan maksimum — kalau urutannya
    // dibalik, tanda tangan untuk 900 MB tetap terbit dan batas 200 MB hanya
    // jadi hiasan di browser.
    const b = badan("terbitkanUrlUnggahVideo");
    const iPeriksa = b.indexOf("periksaBerkasVideo");
    const iTanda = b.indexOf("urlUnggahVideo");
    expect(iPeriksa).toBeGreaterThan(-1);
    expect(iTanda).toBeGreaterThan(iPeriksa);
  });

  it("nama objek dibuat SERVER, bukan diterima dari argumen", () => {
    const b = badan("terbitkanUrlUnggahVideo");
    expect(b).toContain("randomUUID()");
    expect(b).toContain("namaObjekVideo(");
  });

  it("pencatatan menolak objek yang bentuknya tidak sah", () => {
    expect(badan("catatVideoMateri")).toContain("objekVideoSah(");
  });

  it("pencatatan memeriksa panjang hasil .select()", () => {
    // PostgREST menjawab 200 + [] untuk tulisan yang ditolak RLS; melaporkan
    // "berhasil" tanpa memeriksa panjangnya adalah kebohongan senyap.
    const b = badan("catatVideoMateri");
    expect(b).toContain(".select(");
    expect(b).toMatch(/\.length\s*===\s*0|\.length\s*<\s*1|!data\?\.length/);
  });

  it("membersihkan objek LAMA sesudah baris diperbarui, bukan sebelumnya", () => {
    // Mengganti video meninggalkan objek lama di R2 selamanya bila tidak
    // dibersihkan — dan free tier hanya 10 GB. Urutannya mengikat: baris
    // diperbarui DULU. Bila dibalik dan pembaruan baris gagal, objeknya sudah
    // lenyap sementara baris lama masih menunjuknya — pasien mendapat pemutar
    // yang menunjuk objek yang tidak ada.
    const b = badan("catatVideoMateri");
    const iUpsert = b.indexOf(".upsert(");
    const iHapus = b.indexOf("hapusObjekVideo(");
    expect(iUpsert).toBeGreaterThan(-1);
    expect(iHapus).toBeGreaterThan(iUpsert);
  });

  it("TIDAK memakai service role di mana pun", () => {
    // Presigned URL diterbitkan hanya sesudah RLS mengizinkan; service role
    // menembus segala pagar.
    expect(SUMBER).not.toContain("createAdminSupabase");
  });

  it("tidak pernah mencetak URL presigned", () => {
    // URL presigned adalah tautan unduhan. Membocorkannya ke log berarti
    // membocorkan videonya ke siapa pun yang bisa membaca log.
    expect(SUMBER).not.toMatch(/console\.(log|error|warn)\s*\([^)]*url/i);
  });
});

const SUMBER_AKSI = readFileSync("src/app/admin/materi/aksi.ts", "utf8");

/** Sama seperti `badan()` di atas, tapi untuk `aksi.ts` — berkas berbeda,
 *  jadi butuh potongan sumber sendiri supaya asersi di bawah tidak bisa
 *  lolos hanya karena string yang dicari muncul di fungsi TETANGGA (mis.
 *  `catatVideoMateri` di `unggah-video.ts`, yang juga punya `hapusObjekVideo`). */
function badanAksi(nama: string): string {
  const mulai = SUMBER_AKSI.indexOf(`export async function ${nama}`);
  if (mulai < 0) throw new Error(`fungsi ${nama} tidak ditemukan`);
  const berikut = SUMBER_AKSI.indexOf("\nexport async function ", mulai + 1);
  return SUMBER_AKSI.slice(mulai, berikut < 0 ? SUMBER_AKSI.length : berikut);
}

describe("lepasVideo tidak mengyatimkan objek R2 (F2, fix wave)", () => {
  it("membaca kunci objek SEBELUM RPC menghapus barisnya", () => {
    // Baris `material_videos` adalah SATU-SATUNYA catatan kunci objeknya.
    // Membaca objeknya SESUDAH RPC berarti baris itu sudah tidak ada lagi
    // untuk dibaca — kunci objeknya lenyap tanpa jejak, dan objeknya
    // tertinggal di R2 selamanya, tidak ditemukan siapa pun lagi.
    const b = badanAksi("lepasVideo");
    const iSelect = b.indexOf('.select("objek")');
    const iRpc = b.indexOf('.rpc("lepas_video_materi"');
    expect(iSelect).toBeGreaterThan(-1);
    expect(iRpc).toBeGreaterThan(-1);
    expect(iRpc).toBeGreaterThan(iSelect);
  });

  it("menghapus objek SESUDAH RPC terbukti berhasil, bukan sebelumnya", () => {
    // Urutan sebaliknya (hapus objek dulu) meninggalkan baris `material_videos`
    // yang menunjuk objek yang sudah tidak ada bila RPC-nya gagal SESUDAH
    // objeknya terlanjur dihapus — pasien mendapat pemutar yang menunjuk ke
    // ketiadaan. Simetris dengan urutan `catatVideoMateri` di `unggah-video.ts`.
    const b = badanAksi("lepasVideo");
    const iRpc = b.indexOf('.rpc("lepas_video_materi"');
    const iHapus = b.indexOf("hapusObjekVideo(");
    expect(iRpc).toBeGreaterThan(-1);
    expect(iHapus).toBeGreaterThan(iRpc);
  });

  it("kegagalan RPC dilaporkan SEBELUM sempat mencoba menghapus objek", () => {
    // `return` pada baris galat RPC harus jatuh SEBELUM pemanggilan
    // `hapusObjekVideo` — bukan cuma soal urutan teks, tapi soal jalur
    // eksekusi: RPC gagal berarti barisnya (mungkin) masih ada, jadi
    // objeknya tidak boleh disentuh sama sekali.
    const b = badanAksi("lepasVideo");
    const iReturnGagal = b.indexOf('{ ok: false, pesan: "Gagal melepas video materi." }');
    const iHapus = b.indexOf("hapusObjekVideo(");
    expect(iReturnGagal).toBeGreaterThan(-1);
    expect(iHapus).toBeGreaterThan(iReturnGagal);
  });

  it("kegagalan hapus objek dilaporkan lewat objekTersisa, tidak ditelan", () => {
    const b = badanAksi("lepasVideo");
    expect(b).toContain("objekTersisa");
    expect(b).toMatch(/catch\s*\{[^}]*objekTersisa\s*=\s*true/);
  });
});
