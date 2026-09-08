import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BilahDaftar, type KelompokSaring } from "@/app/_shell/panel/bilah-daftar";
import type { ParamDaftar } from "@/app/_shell/panel/daftar";

const KELOMPOK: KelompokSaring[] = [
  {
    nama: "status",
    label: "Status",
    pilihan: [
      { nilai: "terjadwal", label: "Terjadwal" },
      { nilai: "selesai", label: "Selesai" },
    ],
  },
];

const KOSONG: ParamDaftar = { cari: "", saring: {}, hal: 1 };

function render(param: ParamDaftar, total = 40, jumlah = 25) {
  return renderToStaticMarkup(
    <BilahDaftar
      basis="/admin/sesi"
      param={param}
      kelompok={KELOMPOK}
      jumlah={jumlah}
      total={total}
      aksi={<a href="/admin/sesi?ubah=baru">+ Sesi baru</a>}
    />,
  );
}

describe("BilahDaftar", () => {
  it("kotak cari adalah FORM GET — bekerja tanpa JavaScript sama sekali", () => {
    // Ini bukan preferensi gaya. Suite ini berjalan tanpa jsdom, jadi apa pun
    // yang hanya hidup lewat onChange TIDAK BISA DIUJI di sini sama sekali.
    const m = render(KOSONG);
    expect(m).toContain('method="get"');
    expect(m).toContain('action="/admin/sesi"');
    expect(m).toContain('name="cari"');
  });

  it("membawa saringan aktif sebagai input tersembunyi supaya tidak hilang saat mencari", () => {
    const m = render({ cari: "", saring: { status: "selesai" }, hal: 1 });
    expect(m).toContain('type="hidden"');
    expect(m).toContain('name="status"');
    expect(m).toContain('value="selesai"');
  });

  it("TIDAK membawa halaman ke dalam form cari", () => {
    // Mencari dari halaman 3 harus mendarat di halaman 1 hasil baru.
    const m = render({ cari: "", saring: {}, hal: 3 });
    expect(m).not.toContain('name="hal"');
  });

  it("chip saringan menaut ke query yang benar, dan chip aktif menaut untuk MEMATIKANNYA", () => {
    const m = render({ cari: "", saring: { status: "selesai" }, hal: 1 });
    expect(m).toContain('href="/admin/sesi?status=terjadwal"');
    // "Selesai" sedang menyala, jadi tautannya melepasnya — bukan memasangnya lagi.
    expect(m).toContain('href="/admin/sesi"');
  });

  it("menyebut jumlah yang tampil DAN total, bukan salah satunya saja", () => {
    // "40 mitra" pada halaman berisi 25 baris membuat admin mengira ada yang hilang.
    expect(render(KOSONG, 40, 25)).toContain("25 dari 40");
  });

  it("merender slot aksi apa adanya", () => {
    expect(render(KOSONG)).toContain("+ Sesi baru");
  });

  it('chip aktif ber-aria-current="true", bukan aria-pressed — Link bukan role button/switch', () => {
    // aria-pressed hanya sah pada role="button" atau role="switch"; chip ini
    // adalah <Link> navigasi. Tanpa aria-current, "chip ini menyala" hanya
    // tersampaikan lewat warna, jadi pembaca layar mendengar tujuh halaman
    // tautan tanpa satu pun tanda mana yang sedang aktif.
    const m = render({ cari: "", saring: { status: "selesai" }, hal: 1 });
    expect(m).toContain('aria-current="true"');
    expect(m).not.toContain("aria-pressed");
  });

  it("chip TIDAK aktif tidak membawa aria-current sama sekali", () => {
    // Menyamai sidebar.tsx & bottom-bar.tsx: aria-current hanya dirender saat
    // aktif, bukan aria-current="false" untuk yang tidak aktif.
    const m = render({ cari: "", saring: {}, hal: 1 });
    expect(m).not.toContain("aria-current");
    expect(m).not.toContain("aria-pressed");
  });

  it("menandai chip menuntut secara berbeda", () => {
    const kelompok: KelompokSaring[] = [{
      nama: "jenjang", label: "Jenjang",
      pilihan: [{ nilai: "kosong", label: "Tanpa jenjang", menuntut: true }],
    }];
    const m = renderToStaticMarkup(
      <BilahDaftar basis="/admin/sesi" param={KOSONG} kelompok={kelompok}
        jumlah={0} total={0} aksi={null} />,
    );
    expect(m).toContain("text-clay");
  });
});
