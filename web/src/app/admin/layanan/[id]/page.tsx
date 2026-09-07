import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { ambilLayanan } from "@/lib/admin/layanan";
import { pilihanFase } from "@/lib/admin/katalog-admin";
import { daftarMateriAdmin } from "@/lib/admin/materi-admin";
import type { ParamMentah } from "@/app/_shell/panel/daftar";
import { Kartu } from "@/app/_shell/panel/kartu";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { PanelGeser } from "@/app/_shell/panel/panel-geser";
import { AksiLayanan, AksiPaket } from "../form-layanan";
import { FormVarian } from "../form-varian";
import { labelVarian } from "@/lib/varian";

export const metadata = { title: "Detail layanan" };

const BASIS = "/admin/layanan";

function PillAktif({ aktif }: { aktif: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
        aktif ? "bg-leaf-soft text-leaf" : "bg-clay/10 text-clay"
      }`}
    >
      {aktif ? "Aktif" : "Nonaktif"}
    </span>
  );
}

/**
 * Halaman detail layanan — pola B (spec K1).
 *
 * Layanan memiliki DUA daftar anak (varian, paket) plus satu daftar bacaan
 * (materi terkait). Menyesakkan ketiganya ke dalam panel geser selebar
 * setengah layar mengulangi kesalahan yang sama seperti formulir di dalam sel
 * tabel — hanya dengan wadah yang berbeda.
 */
export default async function DetailLayananPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const { id } = await params;

  const layanan = await ambilLayanan(id);
  // `notFound()`, bukan halaman kosong: URL yang salah ketik harus menjawab
  // 404, bukan 200 berisi kerangka tanpa isi.
  if (!layanan) notFound();

  const sp = await searchParams;
  const ubah = typeof sp.ubah === "string" ? sp.ubah : "";
  // Varian dicari DI DALAM layanan ini, bukan di seluruh katalog: panel yang
  // terbuka untuk varian layanan lain akan menyimpan perubahan ke baris yang
  // tidak sedang dilihat admin.
  const varianUbah = ubah === "baru" ? null : layanan.varian.find((v) => v.id === ubah) ?? null;
  const panelTerbuka = ubah === "baru" || varianUbah !== null;
  const hrefTutup = `${BASIS}/${id}`;

  // `pilihanFase()`, bukan `daftarKatalogAdmin()` kedua kalinya: `ambilLayanan()`
  // di atas SUDAH memanggil `daftarKatalogAdmin()` sendiri untuk data layanan
  // ini. Memanggilnya lagi di sini hanya untuk daftar {id, nama} fase berarti
  // membaca ULANG seluruh `sessions`/`packages`/`service_variants` klinik
  // (temuan #4 review sapuan panel) — dua belas query per tampilan satu
  // layanan padahal enam sudah cukup, dari dua snapshot yang bisa berbeda di
  // bawah penulisan konkuren.
  const [fase, materiPerLayanan] = await Promise.all([pilihanFase(), daftarMateriAdmin()]);
  const materi = materiPerLayanan.find((l) => l.id === id)?.materi ?? [];

  return (
    <main>
      <Link href={BASIS} className="text-[12px] font-bold text-panel-muted">
        ‹ Kembali ke Layanan
      </Link>

      <header className="mb-4 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold text-panel-ink">{layanan.nama}</h1>
          <p className="mt-0.5 text-[12.5px] text-panel-muted">
            {layanan.namaFase} · {layanan.sesiTercatat} sesi tercatat
          </p>
        </div>
        <PillAktif aktif={layanan.aktif} />
      </header>

      <div className="grid gap-3">
        <Kartu judul="Data layanan">
          <AksiLayanan
            id={layanan.id}
            nama={layanan.nama}
            deskripsi={layanan.deskripsi}
            faseId={layanan.faseId}
            aktif={layanan.aktif}
            fase={fase}
          />
        </Kartu>

        <Kartu
          judul="Varian"
          aksi={
            // Tautan, bukan tombol yang membuka formulir di tempat: `?ubah=`
            // dibaca di bawah untuk memutuskan kapan `PanelGeser` +
            // `FormVarian` dirender (lihat `panelTerbuka` di atas).
            <Link
              href={`${BASIS}/${layanan.id}?ubah=baru`}
              className="text-[12px] font-bold text-panel-ink underline"
            >
              + Varian baru
            </Link>
          }
        >
          {layanan.varian.length === 0 ? (
            <p className="text-[12.5px] italic text-panel-muted">Belum ada varian.</p>
          ) : (
            <Tabel label={`Varian layanan ${layanan.nama}`}>
              <thead>
                <tr><Th>Varian</Th><Th>Sesi tercatat</Th><Th>Status</Th><Th>Aksi</Th></tr>
              </thead>
              <tbody>
                {layanan.varian.map((v) => (
                  <tr key={v.id}>
                    <Td>
                      {/* Varian baku (label kosong) tampil "Standar" — pilihan
                          ini WAJIB selalu punya teks tampilan. */}
                      {labelVarian({ label: v.label, durasiMenit: v.durasiMenit, format: v.format }) ||
                        "Standar"}
                    </Td>
                    <Td className="font-mono text-[12.5px]">{v.sesiTercatat}</Td>
                    <Td><PillAktif aktif={v.aktif} /></Td>
                    <Td>
                      <Link
                        href={`${BASIS}/${layanan.id}?ubah=${v.id}`}
                        className="text-[12px] font-bold text-panel-ink underline"
                      >
                        Ubah
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabel>
          )}
        </Kartu>

        <Kartu judul="Paket">
          {layanan.paket.length === 0 ? (
            <p className="text-[12.5px] italic text-panel-muted">Belum ada paket.</p>
          ) : (
            <ul className="grid gap-2">
              {layanan.paket.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2.5">
                  <span className="min-w-[180px] flex-1">
                    <b className="text-[13px] text-panel-ink">{p.nama}</b>
                    <span className="ml-2 font-mono text-[12px] text-panel-muted">
                      {p.jumlahSesi} sesi
                    </span>
                    <span className="block text-[11.5px] text-panel-muted">
                      {p.dipakai > 0
                        ? `${p.dipakai} klien sedang menjalani paket ini — mengubah jumlah sesi menggeser progres passport mereka.`
                        : "Belum dipakai klien mana pun."}
                    </span>
                  </span>
                  <PillAktif aktif={p.aktif} />
                  <AksiPaket
                    id={p.id}
                    nama={p.nama}
                    jumlahSesi={p.jumlahSesi}
                    aktif={p.aktif}
                    dipakai={p.dipakai}
                  />
                </li>
              ))}
            </ul>
          )}
        </Kartu>

        {/*
          Bacaan saja, sengaja. Keterkaitan materi<->layanan
          (`material_services`) dikelola dari modul Materi — bukan di sini —
          supaya tidak ada dua tempat yang bisa menulis satu relasi. Tapi staf
          yang membuka layar layanan wajib bisa MELIHAT "layanan ini include
          materi apa saja" tanpa berpindah modul.

          RULING B (Tugas 11): judul materi kini menaut ke `/admin/materi/[id]`
          — rute itu tidak ada sampai Tugas 11 lahir, jadi Tugas 7/8 sengaja
          merender teks polos. Sekarang rutenya nyata, jadi tautannya dipasang
          di sini.
        */}
        <Kartu judul="Materi yang termasuk layanan ini">
          {materi.length === 0 ? (
            <p className="text-[12.5px] italic text-panel-muted">
              Belum ada materi yang menautkan layanan ini.
            </p>
          ) : (
            <ul className="grid gap-1">
              {materi.map((m) => (
                <li key={m.id} className="text-[12.5px] text-panel-ink">
                  <Link href={`/admin/materi/${m.id}`} className="underline">
                    {m.judul}
                  </Link>
                  {!m.aktif && (
                    <span className="ml-1 text-[11px] font-bold text-clay">(nonaktif)</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Kartu>
      </div>

      {panelTerbuka && (
        <PanelGeser
          judul={varianUbah ? "Ubah varian" : "Varian baru"}
          hrefTutup={hrefTutup}
        >
          <FormVarian
            serviceId={id}
            namaLayanan={layanan.nama}
            varian={varianUbah}
            hrefTutup={hrefTutup}
          />
        </PanelGeser>
      )}
    </main>
  );
}
