/**
 * PANEL PEMBATALAN ADMIN (spec C3 P1, P7).
 *
 * Yang dijaga di sini bukan tampilan melainkan SATU janji: admin melihat
 * jenjang yang sudah dihitung beserta akibatnya SEBELUM menekan, dan tidak
 * pernah mengetik jenjangnya sendiri. Admin yang mengetik jenjang adalah admin
 * yang salah mengetik jenjang.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ringkasanPembatalan } from "@/lib/admin/pembatalan";

const akar = path.resolve(__dirname, "..");

describe("ringkasan yang dilihat admin", () => {
  it("PADMA yang membatalkan SELALU jenjang 4, berapa pun sisa waktunya", () => {
    // Sesi 1 jam lagi: menurut waktu ia jenjang 3 (hangus). Tapi yang
    // membatalkan PADMA, dan klinik yang berhalangan bukan tanggungan klien.
    const sekarang = new Date("2027-03-10T01:00:00Z"); // 08:00 WIB
    const r = ringkasanPembatalan("2027-03-10", "09:00", { oleh: "padma" }, sekarang);
    expect(r.jenjang).toBe(4);
    expect(r.kalimat).toContain("dikembalikan penuh");
  });

  it("darurat medis menaikkan pembatalan klien ke jenjang 1", () => {
    const sekarang = new Date("2027-03-10T01:00:00Z");
    const r = ringkasanPembatalan("2027-03-10", "09:00", { oleh: "klien", darurat: true }, sekarang);
    expect(r.jenjang).toBe(1);
  });

  it("menyebut jenjang DAN akibatnya dalam kalimat manusia", () => {
    const sekarang = new Date("2027-03-08T02:00:00Z");
    const r = ringkasanPembatalan("2027-03-10", "09:00", { oleh: "klien" }, sekarang);
    expect(r.jenjang).toBe(1);
    expect(r.kalimat).toContain("dikembalikan penuh");
  });

  it("jendela 2–24 jam menyebut hak, bukan uang", () => {
    const sekarang = new Date("2027-03-10T00:00:00Z"); // 07:00 WIB
    const r = ringkasanPembatalan("2027-03-10", "09:00", { oleh: "klien" }, sekarang);
    expect(r.jenjang).toBe(2);
    expect(r.kalimat).toContain("hak satu sesi");
    expect(r.kalimat).not.toMatch(/Rp/);
  });
});

describe("panel tidak pernah meminta admin mengetik jenjang", () => {
  const sumber = readFileSync(
    path.join(akar, "src/app/admin/sesi/panel-pembatalan.tsx"),
    "utf8",
  );

  it("tidak ada medan masukan jenjang", () => {
    expect(sumber).not.toMatch(/name="jenjang"/);
  });

  it("jam dari basis data dilewatkan `jamDariDb`, bukan dioper apa adanya", () => {
    // `jamMulai` bernilai 'HH:MM:SS'; `instanSesi` hanya menerima 'HH:MM' dan
    // MELEMPAR untuk selainnya. Mengopernya apa adanya mematikan panel untuk
    // setiap sesi terjadwal — dan itu tidak akan terlihat di uji mana pun yang
    // hanya memanggil `ringkasanPembatalan` dengan literal 'HH:MM'.
    expect(sumber).toContain("jamDariDb(jamMulai)");
  });

  it("alasan darurat WAJIB terisi di markup, bukan hanya di basis data", () => {
    // Basis data memang menolaknya, tapi pagar yang hanya di basis data
    // memberi admin galat sesudah menekan alih-alih sebelum.
    //
    // Polanya menuntut MEDAN ALASAN itu sendiri, bukan sekadar kata
    // "required" di suatu tempat. Versi pertama uji ini memakai `/required/`
    // polos — dan medan tanggal serta jam pada formulir jadwal ulang juga
    // membawa `required`, sehingga uji ini tetap hijau walau pagar pada medan
    // alasan dicabut seluruhnya. Uji yang tidak bisa merah untuk subjeknya
    // sendiri lebih buruk daripada tidak ada uji: ia meyakinkan pembaca
    // berikutnya bahwa sesuatu dijaga padahal tidak.
    expect(sumber).toMatch(/name="alasan"[\s\S]{0,120}required=\{/);
    // Dan `alasanWajib` benar-benar menyertakan kedua sebabnya.
    expect(sumber).toMatch(/const alasanWajib = darurat \|\| oleh === "padma"/);
  });

  it("aktor pembatalan DIPILIH, bukan disimpulkan dari kotak alasan", () => {
    // Cacat yang ditutup: `alasan` dulu dirender sebagai catatan biasa yang
    // opsional, sementara basis data membacanya sebagai pernyataan "PADMA yang
    // membatalkan" (jenjang 4, refund penuh). Admin tidak punya satu isyarat
    // pun bahwa mengetiknya mengubah akibat uang.
    expect(sumber).toContain('name="oleh"');
    expect(sumber).toContain("AKTOR_PEMBATALAN");
    // Ringkasan jenjang MENGIKUTI pilihan aktornya.
    expect(sumber).toMatch(/ringkasanPembatalan\([\s\S]{0,120}\{ oleh, darurat \}/);
  });

  it("jam jadwal ulang dipilih dari jam layanan, bukan medan waktu bebas", () => {
    // `type="time" step={900}` menawarkan kelipatan 15 menit, padahal basis
    // data menuntut keanggotaan `app_settings.jam_layanan` DAN kelipatan 30
    // menit — tiga dari empat pilihan yang ditawarkan peramban pasti ditolak
    // sesudah admin menekan.
    expect(sumber).not.toContain('type="time"');
    expect(sumber).toMatch(/<select name="jam"/);
    expect(sumber).toContain("jamPilihan.map");
  });

  it("dua formulir, dua kotak pesan — kegagalan tidak muncul di bawah tombol yang salah", () => {
    expect(sumber).toContain("pesanBatal");
    expect(sumber).toContain("pesanUlang");
  });
});

describe("aksi pembatalan tidak melaporkan panggilan kosong sebagai berhasil", () => {
  const sumber = readFileSync(
    path.join(akar, "src/app/admin/sesi/aksi-pembatalan.ts"),
    "utf8",
  );

  it("`data === null` diperlakukan GAGAL, bukan berhasil", () => {
    // `batalkan_sesi` dan `jadwal_ulang_sesi` memulangkan NULL — bukan galat —
    // ketika barisnya tidak lagi `terjadwal` (klausa `and status` pada
    // UPDATE-nya). Aksi yang hanya melihat `error` melaporkan panggilan
    // semacam itu sebagai BERHASIL: admin menutup panel yakin sesi sudah
    // batal, sementara barisnya tidak berubah sama sekali.
    const kena = sumber.match(/if \(data === null\) return \{ ok: false/g) ?? [];
    expect(kena, "kedua RPC harus memeriksanya").toHaveLength(2);
  });

  it("aktor dikirim ke RPC, dan ditolak di sini bila tidak dipilih", () => {
    expect(sumber).toContain("oleh,");
    expect(sumber).toContain("AKTOR_PEMBATALAN");
  });

  it("kalimat sesudah menekan dirakit dari nilai kembalian RPC, bukan dihitung ulang", () => {
    // Yang MEMUTUSKAN adalah basis data. Menghitung ulang jenjang di sini
    // mengembalikan tebakan layar dan menghapus satu-satunya kesempatan admin
    // melihat kalau keduanya berselisih.
    expect(sumber).toContain("hasil.jenjang");
    expect(sumber).toContain("hasil.akibat");
    expect(sumber).not.toContain("jenjangPembatalan(");
  });
});

describe("aksi pembatalan tidak memakai service role", () => {
  it("berkas aksinya tidak menyentuh service role", () => {
    // `src/app/admin/**` tidak boleh memuat service role
    // (`tests/admin-shell.test.ts`): jejak audit harus menyebut aktor yang
    // NYATA, dan service role tidak punya `auth.uid()`.
    const sumber = readFileSync(
      path.join(akar, "src/app/admin/sesi/aksi-pembatalan.ts"),
      "utf8",
    );
    expect(sumber).not.toContain("createAdminSupabase");
    expect(sumber).not.toContain("SERVICE_ROLE");
  });
});
