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
