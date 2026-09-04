import { describe, it, expect } from "vitest";
import { moovDiDepan } from "@/lib/materi/moov";

/** Menyusun satu box MP4: ukuran 4 byte big-endian + tipe 4 byte ASCII + isi. */
function box(tipe: string, isiByte: number): Uint8Array {
  const b = new Uint8Array(8 + isiByte);
  new DataView(b.buffer).setUint32(0, 8 + isiByte, false);
  for (let i = 0; i < 4; i++) b[4 + i] = tipe.charCodeAt(i);
  return b;
}
const gabung = (...p: Uint8Array[]) => {
  const total = p.reduce((n, x) => n + x.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const x of p) { out.set(x, o); o += x.length; }
  return out;
};

describe("deteksi posisi atom moov", () => {
  it("true bila moov datang sebelum mdat (faststart)", () => {
    expect(moovDiDepan(gabung(box("ftyp", 16), box("moov", 64), box("mdat", 99))))
      .toBe(true);
  });

  it("false bila mdat lebih dulu — pemutar harus mengunduh seluruh berkas", () => {
    expect(moovDiDepan(gabung(box("ftyp", 16), box("mdat", 200), box("moov", 64))))
      .toBe(false);
  });

  it("null bila potongan kepala habis sebelum keduanya ditemukan", () => {
    // Kita hanya membaca beberapa ratus KB pertama; berkas dengan banyak box
    // kecil di depan bisa belum menampakkan keduanya. Jawaban jujurnya
    // "tidak tahu", BUKAN "tidak faststart" — memperingatkan admin atas
    // ketidaktahuan kita sendiri adalah cara cepat membuat peringatan diabaikan.
    expect(moovDiDepan(gabung(box("ftyp", 16), box("free", 32)))).toBeNull();
  });

  it("null untuk data yang jelas bukan MP4", () => {
    expect(moovDiDepan(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(moovDiDepan(new Uint8Array(0))).toBeNull();
  });

  it("menangani box berukuran 64-bit (size == 1)", () => {
    // mdat besar memakai largesize 64-bit; salah membacanya membuat penelusuran
    // melompat ke tempat acak dan menghasilkan jawaban yang mengarang.
    const mdat64 = new Uint8Array(16 + 32);
    const dv = new DataView(mdat64.buffer);
    dv.setUint32(0, 1, false);
    for (let i = 0; i < 4; i++) mdat64[4 + i] = "mdat".charCodeAt(i);
    dv.setUint32(8, 0, false);
    dv.setUint32(12, 16 + 32, false);
    expect(moovDiDepan(gabung(box("ftyp", 8), mdat64, box("moov", 8)))).toBe(false);
  });

  it("null bila ukuran box mustahil, alih-alih berputar selamanya", () => {
    const rusak = new Uint8Array(16);
    new DataView(rusak.buffer).setUint32(0, 0, false); // size 0 = sampai EOF
    for (let i = 0; i < 4; i++) rusak[4 + i] = "free".charCodeAt(i);
    expect(moovDiDepan(rusak)).toBeNull();
  });

  it("true dengan box largesize (size == 1) bertipe selain moov/mdat diikuti moov", () => {
    // Tes ini memastikan jalur largesize 64-bit benar-benar dijalankan. Box harus
    // bertipe selain `mdat` karena jika bertipe `mdat`, fungsi kembali dengan false
    // SEBELUM membaca largesize — itulah mengapa tes "menangani box berukuran 64-bit"
    // tidak pernah menyentuh kode largesize meski komenknya menyatakan demikian.
    const free64 = new Uint8Array(16 + 32);
    const dv = new DataView(free64.buffer);
    dv.setUint32(0, 1, false); // size == 1 = largesize 64-bit berikut
    for (let i = 0; i < 4; i++) free64[4 + i] = "free".charCodeAt(i);
    dv.setUint32(8, 0, false); // 32 bit tinggi largesize
    dv.setUint32(12, 16 + 32, false); // 32 bit rendah = 48 byte
    expect(moovDiDepan(gabung(box("ftyp", 8), free64, box("moov", 8)))).toBe(true);
  });

  it("null bila largesize < 16 — penjaga infinite loop pada box kecil bertipe bukan moov/mdat", () => {
    // Box ber-size == 1 dengan largesize rendah bernilai < 16 (misalnya 0)
    // dengan tipe selain moov/mdat akan membuat p += 0 dan loop selamanya.
    // Penjaga `if (lompat < 16) return null;` menjaga kasus ini.
    const free64invalid = new Uint8Array(16 + 32);
    const dv = new DataView(free64invalid.buffer);
    dv.setUint32(0, 1, false); // size == 1 = largesize 64-bit berikut
    for (let i = 0; i < 4; i++) free64invalid[4 + i] = "free".charCodeAt(i);
    dv.setUint32(8, 0, false); // 32 bit tinggi
    dv.setUint32(12, 0, false); // 32 bit rendah = 0 (invalid, < 16)
    expect(moovDiDepan(gabung(box("ftyp", 8), free64invalid))).toBeNull();
  });
});
