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
import { jamDariDb } from "@/lib/jadwal/jam";

const akar = path.resolve(__dirname, "..");

describe("ringkasan yang dilihat admin", () => {
  it("menyebut jenjang DAN akibatnya dalam kalimat manusia", () => {
    const sekarang = new Date("2027-03-08T02:00:00Z");
    const r = ringkasanPembatalan("2027-03-10", "09:00", sekarang);
    expect(r.jenjang).toBe(1);
    expect(r.kalimat).toContain("dikembalikan penuh");
  });

  it("jendela 2–24 jam menyebut hak, bukan uang", () => {
    const sekarang = new Date("2027-03-10T00:00:00Z"); // 07:00 WIB
    const r = ringkasanPembatalan("2027-03-10", "09:00", sekarang);
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
    expect(sumber).toMatch(/required/);
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
