// tests/materi-unggah-aksi.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SUMBER = readFileSync(
  path.resolve(__dirname, "../src/app/admin/materi/unggah.ts"), "utf8",
);

describe("aksi unggah halaman — pagar struktural", () => {
  it('berkas server action, dan setiap aksi memanggil requireRole sendiri', () => {
    expect(SUMBER.trimStart().startsWith('"use server"')).toBe(true);
    const aksi = [...SUMBER.matchAll(/export async function (\w+)/g)];
    expect(aksi.length).toBeGreaterThan(0);
    const penjaga = [...SUMBER.matchAll(/requireRole\(\["admin", ?"owner"\]\)/g)];
    // Server action adalah endpoint POST tersendiri; layout tidak menjaganya.
    expect(penjaga.length).toBe(aksi.length);
    // Jumlah total yang cocok TIDAK CUKUP: mutasi membuktikan seluruh
    // requireRole bisa ditumpuk di SATU aksi (dipanggil dua kali) sementara
    // aksi lain sama sekali tidak memanggilnya — total tetap cocok, tes tetap
    // hijau. Setiap POTONGAN badan fungsi (dari deklarasinya sampai deklarasi
    // aksi berikutnya, atau akhir berkas) wajib memuat panggilannya SENDIRI.
    for (let i = 0; i < aksi.length; i++) {
      const mulai = aksi[i].index!;
      const akhir = i + 1 < aksi.length ? aksi[i + 1].index! : SUMBER.length;
      const tubuh = SUMBER.slice(mulai, akhir);
      expect(tubuh, `${aksi[i][1]} tidak memanggil requireRole sendiri`).toMatch(
        /requireRole\(\["admin", ?"owner"\]\)/,
      );
    }
  });

  it("path objek ditentukan server, tidak pernah diterima dari parameter", () => {
    // Browser yang memilih path adalah browser yang bisa menimpa objek materi lain.
    expect(SUMBER).toContain("namaObjekHalaman(");
    expect(SUMBER).not.toMatch(/objek:\s*(formData|params)/);
    // Kedua asersi di atas tetap hijau walau terbitkanUrlUnggahHalaman diberi
    // parameter tambahan yang membiarkan PEMANGGIL menimpa path (dibuktikan
    // lewat mutasi): namaObjekHalaman() masih disebut di pemeriksaan
    // catatHalamanMateri, dan parameter baru itu tidak akan pernah bernama
    // formData/params. Tanda tangannya dikunci PERSIS sesuai kontrak
    // "Produces" milik brief (dua parameter, tidak lebih) supaya penambahan
    // parameter path apa pun tertangkap di sini.
    expect(SUMBER).toMatch(
      /export async function terbitkanUrlUnggahHalaman\(\s*materiId:\s*string,\s*jumlahHalaman:\s*number,?\s*\)/,
    );
  });

  it("jumlah halaman dibatasi sebelum satu URL pun diterbitkan", () => {
    expect(SUMBER).toContain("MAKS_HALAMAN");
    // "toContain" saja lolos lewat import yang tak terpakai walau KEDUA pagar
    // batas dihapus (dibuktikan lewat mutasi). MAKS_HALAMAN wajib muncul
    // bersanding operator perbandingan di salah satu arah — bukti ia benar
    // dipakai membatasi, bukan sekadar diimpor.
    expect(SUMBER).toMatch(/[<>]=?\s*MAKS_HALAMAN|MAKS_HALAMAN\s*[<>]=?/);
  });

  it("pencatatan memakai RPC, bukan delete lalu insert dari klien", () => {
    // Kedua asersi sengaja menerima kutip tunggal MAUPUN ganda. Versi yang hanya
    // mengenali kutip ganda terbukti bisa dielakkan hanya dengan mengganti gaya
    // kutip — pada pagar yang justru menjaga kelas bug terburuk di repo ini
    // (satu filter tautologis pernah menghapus SELURUH bab materi).
    //
    // Yang pertama menuntut RPC benar-benar DIPANGGIL, bukan sekadar namanya
    // muncul: penyebutan di dalam komentar saja pernah cukup membuatnya hijau.
    expect(SUMBER).toMatch(/\.rpc\(\s*['"]ganti_halaman_materi['"]/);
    expect(SUMBER).not.toMatch(/from\(\s*['"]material_pages['"]\s*\)\s*\.?\s*delete\s*\(/);
  });

  it("baris material_pages dikosongkan SEBELUM objek storage lama dihapus", () => {
    // Urutan ini terikat pada jalur GAGAL, bukan jalur sukses — keduanya
    // berakhir sama saat sukses, jadi tes yang hanya melihat hasil akhir
    // tidak akan pernah menangkap regresi ini (Ruling T7-D).
    //
    // Bila objek storage dihapus DULU dan RPC pengosongan baris inilah yang
    // gagal sesudahnya (blip PostgREST, timeout, koneksi habis), objeknya
    // sudah lenyap sementara baris material_pages lama masih menunjuknya:
    // pasien melihat halaman rusak sementara panel admin menyatakan materi
    // ini punya isi — dan review pernah menemukan pesan galatnya identik
    // dengan jalur gagal yang aman, sehingga tidak ada yang bisa membedakan
    // keduanya. Membalik urutan — kosongkan baris DULU, baru hapus objek —
    // membuat kegagalan RPC pengosongan INERT (belum ada yang tersentuh sama
    // sekali) dan menyisakan hanya mode gagal lunak (baris sudah kosong,
    // paling buruk objek yatim menumpuk sebentar, disapu percobaan
    // berikutnya). Tes ini mengunci urutan itu supaya edit berikutnya tidak
    // bisa menukarnya balik tanpa disadari — diam-diam mengembalikan kelas
    // bug yang perbaikan ini ada untuk menutupnya.
    const aksi = [...SUMBER.matchAll(/export async function (\w+)/g)];
    const iniIdx = aksi.findIndex((m) => m[1] === "terbitkanUrlUnggahHalaman");
    expect(iniIdx, "terbitkanUrlUnggahHalaman tidak ditemukan").toBeGreaterThanOrEqual(0);
    const mulai = aksi[iniIdx].index!;
    const akhir = iniIdx + 1 < aksi.length ? aksi[iniIdx + 1].index! : SUMBER.length;
    const tubuh = SUMBER.slice(mulai, akhir);

    const idxKosongkanBaris = tubuh.search(/\.rpc\(\s*['"]ganti_halaman_materi['"]/);
    const idxHapusObjek = tubuh.indexOf(".remove(");
    expect(idxKosongkanBaris, "panggilan ganti_halaman_materi(...) tidak ditemukan di badan fungsi").toBeGreaterThanOrEqual(0);
    expect(idxHapusObjek, "panggilan storage .remove( tidak ditemukan di badan fungsi").toBeGreaterThanOrEqual(0);
    expect(idxKosongkanBaris, "baris harus dikosongkan SEBELUM objek storage dihapus").toBeLessThan(idxHapusObjek);
  });
});
