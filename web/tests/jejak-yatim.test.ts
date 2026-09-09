/**
 * PAGAR PERMANEN: jejak audit pembayaran tidak boleh menumpuk baris YATIM.
 *
 * Kenapa berkas ini terpisah dari tests/jejak-status-bayar.test.ts — berkas itu
 * menguji PERILAKU trigger (siapa aktornya, transisi apa yang dicatat, siapa
 * yang tidak boleh menyentuhnya). Yang diuji di sini adalah HIGIENE SUITE-nya
 * sendiri, dan itu invarian yang berbeda sifat: ia tidak diuji dengan membuat
 * fixture baru, melainkan dengan memeriksa apa yang DITINGGALKAN seluruh
 * berkas test lain.
 *
 * Kebocoran yang ditutup (ditemukan auditor, bukan hipotesis):
 * `tests/admin-shell.test.ts` menyisipkan satu sesi dan satu paket klien
 * berstatus 'menunggu_verifikasi'. Sejak migration 20260829180000 pencatat
 * jejak ikut menutup jalur INSERT, jadi kedua penyisipan itu menulis dua baris
 * `jejak_status_bayar`. `bersihkan()` menghapus sesi & paketnya, tetapi tidak
 * pernah menghapus jejaknya — dan tabel jejak SENGAJA tanpa foreign key
 * (cascade akan menghapus tepat bukti yang menjelaskan penghapusan), sehingga
 * tidak ada yang menyapunya. Hasilnya `jejak_status_bayar` bertambah tepat +2
 * setiap `npm test`: 0 -> 5 -> 7 -> 9, selamanya, menunjuk baris yang sudah
 * tidak ada.
 *
 * Kenapa tidak ada test yang merah karenanya: tidak satu pun test meng-assert
 * JUMLAH TOTAL jejak — semuanya menyaring per `sesi_id`/`paket_klien_id`
 * fixture masing-masing. Kebocoran yang tidak bisa membuat suite merah akan
 * hidup selamanya. Berkas ini persis pagar yang hilang itu.
 *
 * Sifat pagarnya sengaja TIDAK bergantung urutan berkas: apa pun urutan
 * vitest menjalankan berkas test (fileParallelism: false), setiap berkas wajib
 * merapikan jejaknya sendiri di afterAll, jadi nol baris yatim benar sebelum
 * maupun sesudah berkas mana pun.
 *
 * Pembersihan yang menutup kebocoran ini WAJIB lewat service role: peran
 * `authenticated` sengaja tidak memegang DELETE atas tabel jejak (baris audit
 * tidak boleh dihapus oleh admin yang sedang diaudit). Hak itu ditegaskan
 * ulang di bawah supaya "perbaikan" yang sebenarnya melonggarkan keamanan —
 * memberi DELETE ke `authenticated` agar pembersihan gampang — tetap merah.
 */
import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";

type Yatim = {
  id: string;
  sesi_id: string | null;
  paket_klien_id: string | null;
  status_lama: string | null;
  status_baru: string;
  peran_aktor: string;
  dicatat_pada: string;
};

/**
 * Baris jejak yang sasarannya sudah tidak ada.
 *
 * `left join` + `is null`, bukan `not exists (...)` atas UNION: constraint
 * `jejak_sasaran_tunggal` menjamin tepat satu dari dua kolom terisi, jadi tiap
 * baris hanya bisa yatim lewat satu sisi — dan bentuk ini ikut menangkap kolom
 * yang berisi UUID yang tidak pernah ada sama sekali (salah ketik fixture),
 * bukan hanya yang sudah dihapus.
 */
async function jejakYatim(): Promise<Yatim[]> {
  return querySql<Yatim>(
    `select j.id,
            j.sesi_id,
            j.paket_klien_id,
            j.status_lama::text as status_lama,
            j.status_baru::text as status_baru,
            j.peran_aktor,
            j.dicatat_pada
       from public.jejak_status_bayar j
       left join public.sessions s on s.id = j.sesi_id
       left join public.client_packages p on p.id = j.paket_klien_id
      where (j.sesi_id is not null and s.id is null)
         or (j.paket_klien_id is not null and p.id is null)
      order by j.dicatat_pada`,
  );
}

function ringkas(baris: Yatim[]): string {
  return baris
    .map(
      (b) =>
        `  - ${b.sesi_id ? `sesi ${b.sesi_id}` : `paket ${b.paket_klien_id}`}` +
        ` : ${b.status_lama ?? "(lahir)"} -> ${b.status_baru}` +
        ` oleh ${b.peran_aktor} pada ${b.dicatat_pada}`,
    )
    .join("\n");
}

describe("higiene jejak audit pembayaran", () => {
  it("tidak ada baris jejak YATIM (menunjuk sesi/paket yang sudah tidak ada)", async () => {
    const yatim = await jejakYatim();
    expect(
      yatim.length,
      yatim.length === 0
        ? ""
        : `${yatim.length} baris jejak menunjuk sesi/paket yang sudah tidak ada.\n` +
          `Sebuah berkas test menyisipkan/mengubah status_bayar lalu menghapus barisnya\n` +
          `tanpa ikut menghapus jejaknya di afterAll. Tabel jejak sengaja TANPA foreign\n` +
          `key, jadi tidak ada cascade yang menyapunya — sapu manual lewat SERVICE ROLE\n` +
          `(peran authenticated memang tidak boleh punya DELETE di sini).\n` +
          `Baris yatim:\n${ringkas(yatim)}`,
    ).toBe(0);
  });

  it("pembersihan tidak boleh dipermudah dengan memberi DELETE ke peran API", async () => {
    // Pagar terhadap "perbaikan" yang salah arah. Kebocoran di atas ditutup
    // dengan menyapu lewat service role — BUKAN dengan melonggarkan hak tabel
    // supaya `authenticated` bisa menghapus jejaknya sendiri.
    const hak = await querySql<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name = 'jejak_status_bayar'
          and grantee in ('anon','authenticated')
          and privilege_type in ('DELETE','TRUNCATE','UPDATE','INSERT')`,
    );
    expect(hak).toEqual([]);
  });
});

describe("higiene jejak_jadwal (C3-a)", () => {
  it("tidak ada baris jejak jadwal YATIM", async () => {
    // Alasan yang sama dengan jejak pembayaran: tabelnya sengaja tanpa foreign
    // key, jadi menghapus sesi tidak menyapu jejaknya. Setiap berkas uji yang
    // membuat lalu menghapus sesi WAJIB menyapu `jejak_jadwal` miliknya sendiri
    // lewat service role — `authenticated` memang tidak boleh punya DELETE.
    const yatim = await querySql<{ id: string; sesi_id: string; tindakan: string }>(
      `select j.id, j.sesi_id, j.tindakan
         from public.jejak_jadwal j
         left join public.sessions s on s.id = j.sesi_id
        where s.id is null`,
    );
    expect(
      yatim.length,
      `${yatim.length} baris jejak_jadwal menunjuk sesi yang sudah tidak ada.\n` +
        yatim.map((y) => `  - ${y.tindakan} pada sesi ${y.sesi_id}`).join("\n"),
    ).toBe(0);
  });
});
