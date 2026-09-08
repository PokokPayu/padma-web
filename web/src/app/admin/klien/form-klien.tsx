"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { buatKlien, perbaruiKlien, type KlienBentrok } from "./aksi";
import { PemilihLokasi } from "@/app/_shell/pemilih-lokasi";

export type PilihanFase = { id: string; nama: string };

const KELAS_MEDAN =
  "mt-1 min-h-[42px] w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-[13.5px]";
const KELAS_LABEL = "block text-[12.5px] font-bold text-ink-soft";

/**
 * Pesan sukses dan pesan galat SALING MENIADAKAN — diekstrak jadi fungsi
 * murni (tanpa `useState`) supaya invarian ini bisa diuji langsung tanpa
 * jsdom/interaksi klik, yang tidak tersedia di suite ini (`environment:
 * "node"`, lihat `vitest.config.ts`).
 *
 * Fungsi ini ada karena bug nyata: sejak `FormKlienBaru` berhenti unmount
 * sesudah sukses (komponen ini sekarang tetap terbuka, lihat komentar di
 * bawah), `berhasil` dari submit SEBELUMNYA tidak lagi lenyap bersama
 * unmount. Tanpa fungsi ini, jalur gagal yang lupa menghapus `berhasil` lama
 * membuat "Tersimpan sebagai PAD-XXXX" tampil berdampingan dengan pesan
 * galat submit BERIKUTNYA — admin bisa membacanya sebagai "klien kedua ini
 * ikut tersimpan", padahal sebaliknya.
 */
export function pesanBerikutnya(
  hasil: { ok: true; padmaId: string } | { ok: false; pesan: string },
): { pesan: string | null; berhasil: string | null } {
  return hasil.ok
    ? { pesan: null, berhasil: hasil.padmaId }
    : { pesan: hasil.pesan, berhasil: null };
}

/**
 * Formulir "Klien baru".
 *
 * Dulu komponen ini menyimpan gerbang buka/tutup sendiri (mulai TERTUTUP),
 * karena ia dulu duduk di HEADER daftar klien — formulir yang selalu terbuka
 * di sana mendorong admin membuat baris ganda untuk klien yang sebenarnya
 * sudah ada. Sejak modul ini pindah ke pola B (halaman detail berdiri
 * sendiri), satu-satunya pemanggil komponen ini adalah rute berdiri sendiri
 * `/admin/klien/baru` — mendarat di rute itu SUDAH berarti admin bermaksud
 * membuat klien baru, jadi gerbang kedua di dalam komponen ini hanya
 * mengulang klik yang sama tanpa mencegah apa pun. "Terbuka atau tidak"
 * sekarang keputusan URL (lewat tombol tautan di `page.tsx`), bukan lagi
 * state komponen — sejalan dengan aturan yang sama untuk `FormMitra`.
 *
 * Pilihan fase datang dari tabel `phases` lewat prop — tidak pernah disalin
 * ulang sebagai literal di komponen ini, supaya fase yang ditambah klinik
 * tidak perlu menunggu rilis kode.
 */
export function FormKlienBaru({ fase }: { fase: PilihanFase[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [berhasil, setBerhasil] = useState<string | null>(null);
  // Id klien yang baru tersimpan, dipakai untuk menaut ke halaman detailnya
  // (K14) — bukan lewat `pesanBerikutnya`, yang sengaja tetap murni hanya
  // mengurus invarian pesan sukses/galat dan diuji begitu di
  // tests/admin-klien.test.ts.
  const [idBaru, setIdBaru] = useState<string | null>(null);
  // K17: identitas baris klien yang bentrok emailnya, kalau `buatKlien`
  // menyertakannya. Dipisah dari `pesanBerikutnya` dengan alasan yang sama
  // dengan `idBaru` — fungsi itu murni untuk invarian pesan sukses/galat.
  const [klienBentrok, setKlienBentrok] = useState<KlienBentrok | null>(null);

  return (
    <form
      ref={formRef}
      // Nilai formulir dikirim apa adanya; PADMA ID dan status penautan
      // ditetapkan server — keduanya tidak pernah menjadi medan di sini.
      action={(fd) =>
        mulai(async () => {
          const r = await buatKlien(fd);
          const { pesan: pesanBaru, berhasil: berhasilBaru } = pesanBerikutnya(r);
          setPesan(pesanBaru);
          setBerhasil(berhasilBaru);
          setIdBaru(r.ok ? r.id : null);
          setKlienBentrok(!r.ok ? (r.klienBentrok ?? null) : null);
          if (r.ok) {
            // Formulir tetap TERBUKA (tidak ada lagi state "tertutup" untuk
            // kembali ke sana) — medannya dikosongkan lewat reset native
            // supaya admin tidak keliru mengira submit kedua akan membuat
            // baris duplikat dari data yang masih tersisa di layar.
            formRef.current?.reset();
          }
        })
      }
      className="rounded-2xl border-[1.5px] border-dashed border-gold bg-[#FDFAF1] p-4"
    >
      {/* K14: anjuran utama sesudah simpan adalah pendaftaran mandiri, bukan
          lagi tautan aktivasi WhatsApp — lihat kotak sukses di bawah tombol. */}
      <h2 className="mb-3 text-[13.5px] font-extrabold text-ink">
        Klien baru — mendaftar sendiri dulu, tautan aktivasi WhatsApp untuk
        cadangan
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={KELAS_LABEL}>Nama lengkap</span>
          <input
            name="nama"
            type="text"
            required
            minLength={2}
            placeholder="mis. Sari Utami"
            className={KELAS_MEDAN}
          />
        </label>
        <label>
          <span className={KELAS_LABEL}>Email (dipakai untuk masuk)</span>
          <input
            name="email"
            type="email"
            required
            placeholder="nama@gmail.com"
            className={KELAS_MEDAN}
          />
        </label>
        <label>
          <span className={KELAS_LABEL}>No. WhatsApp</span>
          <input name="no_hp" type="tel" placeholder="08xx" className={KELAS_MEDAN} />
        </label>
        <label>
          <span className={KELAS_LABEL}>Fase</span>
          <select name="fase" required defaultValue={fase[0]?.id ?? ""} className={KELAS_MEDAN}>
            {fase.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nama}
              </option>
            ))}
          </select>
        </label>
        {/* Alamat BOLEH kosong di sini — beda dari alamat pengajuan jadwal
            klien sendiri yang wajib. Boleh terisi menyusul. */}
        <label className="sm:col-span-2">
          <span className={KELAS_LABEL}>Alamat (opsional, bisa diisi menyusul)</span>
          <textarea name="alamat" rows={2} placeholder="Alamat rumah klien" className={KELAS_MEDAN} />
          {/* Alamat ini digeocoding lewat Nominatim (OSM) untuk saran jenjang
              transport — lisensi ODbL mewajibkan atribusi tampak di layar yang
              memakai hasilnya, bukan cukup tertulis di komentar kode. */}
          <span className="mt-1 block text-[11px] text-ink-soft/70">
            Lokasi diperkirakan lewat data © OpenStreetMap contributors.
          </span>
          <PemilihLokasi />
        </label>
      </div>

      {pesan && (
        <div className="mt-3 text-[13px] font-semibold text-clay">
          <p>{pesan}</p>
          {/* K17: bentrok email TIDAK BISA dibereskan lewat pencarian daftar
              klien (`ambilDaftarKlien` hanya mencocokkan nama & PADMA ID,
              bukan email) — jadi tautan LANGSUNG ke baris yang sudah ada,
              memuat nama & PADMA ID-nya supaya admin tahu ia menuju ke mana
              sebelum mengklik. Tidak ada penggabungan otomatis; admin melihat
              datanya lalu memutuskan sendiri. */}
          {klienBentrok && (
            <p className="mt-1 font-normal">
              <Link
                href={`/admin/klien/${klienBentrok.id}`}
                className="font-bold underline underline-offset-4"
              >
                Buka data {klienBentrok.nama} ({klienBentrok.padmaId})
              </Link>
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex gap-2.5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-night px-4 py-2.5 text-[13px] font-bold text-gold-pale disabled:opacity-60"
        >
          {pending ? "Menyimpan…" : "Simpan klien"}
        </button>
        {/* `type="reset"` bukan tombol JS: mengosongkan medan lewat mekanisme
            form native, bukan lewat state "tertutup" yang sudah tidak ada. */}
        <button
          type="reset"
          onClick={() => {
            setPesan(null);
            setKlienBentrok(null);
          }}
          className="rounded-xl border border-black/15 px-4 py-2.5 text-[13px] font-bold text-ink-soft"
        >
          Batal
        </button>
      </div>

      {berhasil && (
        <div className="mt-3 text-[13px]">
          <p className="text-leaf">
            Tersimpan sebagai <b className="font-mono">{berhasil}</b>.
          </p>
          {/* K14: penautan lewat email terverifikasi (K1) membuat undangan
              WhatsApp bukan lagi satu-satunya jalan — anjuran utama sekarang
              minta klien mendaftar sendiri dengan email yang sama, undangan
              turun jadi cadangan untuk klien yang perlu dituntun. Tidak ada
              kode penautan yang dihapus; ini hanya urutan anjuran di layar. */}
          <p className="mt-1.5 text-ink">
            Minta klien mendaftar sendiri di halaman <b>Daftar</b> dengan email
            ini — begitu emailnya terkonfirmasi, akunnya otomatis tertaut ke
            data ini.
          </p>
          {idBaru && (
            <p className="mt-1 text-ink-soft">
              Atau kirimkan tautan aktivasi dari{" "}
              <Link
                href={`/admin/klien/${idBaru}`}
                className="font-bold text-ink underline underline-offset-4"
              >
                halaman detail klien ini
              </Link>
              .
            </p>
          )}
        </div>
      )}
    </form>
  );
}

/**
 * Formulir ubah data OPERASIONAL pada halaman detail.
 *
 * Alamat email sengaja tidak punya medan di sini: ia kunci pencocokan saat
 * klien menukarkan tautan aktivasi, dan mengubahnya diam-diam akan membuat
 * tautan yang sudah terkirim berhenti bekerja tanpa pesan apa pun.
 */
export function FormEditKlien({
  id,
  awal,
  fase,
}: {
  id: string;
  awal: {
    nama: string;
    noHp: string;
    /** NULL = belum ditentukan — lihat penjelasan di medan Fase di bawah. */
    faseId: string | null;
    alamat: string;
    lat: number | null;
    lon: number | null;
  };
  fase: PilihanFase[];
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [tersimpan, setTersimpan] = useState(false);

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await perbaruiKlien(id, fd);
          setTersimpan(r.ok);
          setPesan(r.ok ? null : r.pesan);
        })
      }
      className="rounded-2xl border border-black/10 bg-white p-5"
    >
      <h2 className="mb-3 font-serif text-lg text-night">Data operasional</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={KELAS_LABEL}>Nama lengkap</span>
          <input
            name="nama"
            type="text"
            required
            minLength={2}
            defaultValue={awal.nama}
            className={KELAS_MEDAN}
          />
        </label>
        <label>
          <span className={KELAS_LABEL}>No. WhatsApp</span>
          <input name="no_hp" type="tel" defaultValue={awal.noHp} className={KELAS_MEDAN} />
        </label>
        <label>
          <span className={KELAS_LABEL}>Fase</span>
          {/* PILIHAN KOSONG YANG SAH — bukan kerapian, dan bukan `required`.
              Sejak `clients.phase_id` boleh NULL (migration
              `fase_klien_boleh_kosong`), baris klien yang lahir dari
              pendaftaran mandiri datang ke layar ini TANPA fase, karena fasenya
              memang belum ditanyakan siapa pun — ia datang dari skrining.

              Sebelum opsi ini ada, `defaultValue` bernilai null membuat
              peramban diam-diam memilih OPSI PERTAMA, dan `required` merasa
              puas. Akibatnya admin yang membuka halaman ini untuk menyunting
              ALAMAT saja ikut menetapkan fase yang tidak pernah dipilih
              siapa pun — data klinis berubah tanpa ada yang memutuskan, dan
              tanpa satu pun jejak bahwa itu terjadi.

              Karena itu keadaan kosong harus BISA disimpan apa adanya: memaksa
              admin menebak fase hanya supaya formulirnya lolos adalah bentuk
              lain dari kesalahan yang sama. Mengisinya tetap boleh, dan
              mengosongkannya kembali juga — keduanya kini pilihan sadar.
              `perbaruiKlien` menerjemahkan "" menjadi NULL. */}
          <select
            name="fase"
            defaultValue={awal.faseId ?? ""}
            className={KELAS_MEDAN}
          >
            <option value="">— Belum ditentukan —</option>
            {fase.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nama}
              </option>
            ))}
          </select>
        </label>
        <label className="sm:col-span-2">
          <span className={KELAS_LABEL}>Alamat (opsional, bisa diisi menyusul)</span>
          <textarea
            name="alamat"
            rows={2}
            defaultValue={awal.alamat}
            placeholder="Alamat rumah klien"
            className={KELAS_MEDAN}
          />
          {/* Sama seperti FormKlienBaru: alamat ini digeocoding lewat
              Nominatim (OSM) setiap kali disimpan ulang, jadi atribusinya
              wajib tetap tampak di sini juga. */}
          <span className="mt-1 block text-[11px] text-ink-soft/70">
            Lokasi diperkirakan lewat data © OpenStreetMap contributors.
          </span>
          <PemilihLokasi
            awal={awal.lat !== null && awal.lon !== null ? { lat: awal.lat, lon: awal.lon } : null}
          />
        </label>
      </div>

      {pesan && <p className="mt-3 text-[13px] font-semibold text-clay">{pesan}</p>}
      {tersimpan && !pesan && (
        <p className="mt-3 text-[13px] text-leaf">Perubahan tersimpan.</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-xl bg-night px-4 py-2.5 text-[13px] font-bold text-gold-pale disabled:opacity-60"
      >
        {pending ? "Menyimpan…" : "Simpan perubahan"}
      </button>
    </form>
  );
}
