"use client";

import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ajukanJadwal } from "@/lib/passport/aksi";
import { formatJam } from "@/lib/jadwal/jam";
import { Katalog, type LayananKatalogAjukan } from "./katalog";
import { Ringkasan } from "./ringkasan";

// Formulir hanya mengirim keinginan klien (layanan, tanggal, preferensi waktu,
// catatan). Status permintaan bukan urusan formulir ini: ia ditetapkan server
// dan dikunci trigger basis data.
const WAKTU = ["pagi", "siang", "sore"] as const;

export function FormAjukan({
  katalog,
  faseKlien,
  jamPilihan,
  tanggalPalingAwal,
  alamatDefault,
}: {
  // Katalog LENGKAP (layanan aktif, varian aktif, harga yang berlaku hari ini)
  // sudah dirakit di server. Dioper utuh, bukan dipecah jadi dua prop
  // `layanan` + `varian` seperti sebelumnya: pilihan layanan dan pilihan
  // varian adalah SATU keputusan di layar ini, dan memisahkan datanya kembali
  // hanya melahirkan lagi kemungkinan pasangan yang tidak cocok.
  katalog: LayananKatalogAjukan[];
  // `clients.phase_id`, boleh null. Diteruskan apa adanya ke katalog, yang
  // memakainya untuk memilih chip fase mana yang terbuka lebih dulu.
  faseKlien: string | null;
  // Jam mulai yang boleh dipilih, dari `app_settings.jam_layanan` (spec J2).
  // Dibaca di server dan dipakai ULANG sebagai pagar di `ajukanJadwal`, jadi
  // apa yang ditawarkan di sini dan apa yang diterima server tidak pernah bisa
  // berselisih. Tidak pernah kosong: `uraikanDaftarJam()` menjamin itu.
  jamPilihan: string[];
  // String 'YYYY-MM-DD' menurut kalender Jakarta, dirakit di server. Jangan
  // menghitungnya di browser: jam perangkat pemakai bisa apa saja.
  tanggalPalingAwal: string;
  // Alamat PROFIL klien (bisa "" bila belum pernah diisi) — hanya isian AWAL
  // (Ruling 9 T6). Medan tetap `<textarea>` biasa yang bisa diketik ulang;
  // apa pun yang terkirim di FormData saat submit itulah yang tersimpan,
  // bukan nilai prop ini.
  alamatDefault: string;
}) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [waktu, setWaktu] = useState<(typeof WAKTU)[number]>("pagi");
  const [jam, setJam] = useState(jamPilihan[0] ?? "");
  // Pilihan awal = varian pertama dari layanan pertama yang PUNYA varian.
  // Layanan tanpa varian aktif tidak dirender katalog, jadi memilihnya sebagai
  // nilai awal akan menghasilkan formulir yang menunjuk sesuatu yang tidak
  // terlihat di layar — dan pengajuan yang ditolak FK gabungan.
  const layananPertama = katalog.find((l) => l.varian.length > 0);
  const [layananId, setLayananId] = useState(layananPertama?.id ?? "");
  const [varianId, setVarianId] = useState(layananPertama?.varian[0]?.id ?? "");
  // DUA LANGKAH, SATU HALAMAN — bukan dua rute.
  //
  // Pilihan layanan hidup di state komponen ini. Memindahkannya ke rute kedua
  // menuntut ia dititipkan lewat query param atau draf di server, dan bagi
  // klien hasilnya persis sama. Yang dicari klien dari "halaman terpisah"
  // adalah layar yang tidak lagi menampilkan katalog sepanjang lima fase; itu
  // yang diberikan di sini.
  //
  // Kedua langkah TETAP TERPASANG di DOM (disembunyikan dengan atribut
  // `hidden`, bukan dilepas): medan tanggal/jam/alamat tak terkendali, dan
  // melepasnya saat klien mundur ke langkah 1 akan menghapus apa yang sudah
  // diketiknya.
  const [langkah, setLangkah] = useState<1 | 2>(1);
  const [selesai, setSelesai] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);

  /**
   * SATU penyetel untuk KEDUA nilai — bukan dua penyetel terpisah.
   *
   * Varian layanan lain tidak sah untuk layanan yang sedang terpilih: FK
   * gabungan (service_id, variant_id) di basis data menolaknya, dan
   * penolakannya sampai ke klien sebagai kalimat galat untuk kombinasi yang
   * tidak pernah ia maksud. Selama keduanya bergerak bersama-sama dalam satu
   * fungsi, kombinasi itu tidak punya jalan untuk lahir.
   */
  function pilihVarian(serviceId: string, idVarian: string) {
    setLayananId(serviceId);
    setVarianId(idVarian);
  }

  const layananTerpilih = katalog.find((l) => l.id === layananId) ?? null;
  const varianTerpilih = layananTerpilih?.varian.find((v) => v.id === varianId) ?? null;
  // Nama yang dibaca ulang klien di blok ringkasan. Varian baku berlabel
  // kosong (sah — lihat `labelVarian()`), dan untuk varian itu nama layanannya
  // sendiri sudah menjadi nama yang lengkap.
  const namaTerpilih =
    layananTerpilih === null
      ? ""
      : varianTerpilih && varianTerpilih.label !== ""
        ? `${layananTerpilih.nama} · ${varianTerpilih.label}`
        : layananTerpilih.nama;

  if (selesai) {
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-8 text-center">
        <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-leaf/25 bg-leaf-soft text-2xl text-leaf">
          ✓
        </span>
        <h1 className="font-serif text-xl text-night">Permintaan terkirim</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13.5px] text-[#415247]">
          Tim PADMA akan menghubungi Anda via WhatsApp untuk mengonfirmasi jadwal dan
          bidan yang datang.
        </p>
        <Link
          href="/passport"
          className="mt-5 inline-block rounded-xl border border-black/10 px-5 py-2.5 text-sm font-bold"
        >
          Kembali ke Beranda
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-6">
      <h1 className="mb-4 font-serif text-xl text-night">
        Ajukan Jadwal{" "}
        <span className="font-sans text-xs font-semibold text-ink-soft">
          tim PADMA mengonfirmasi via WhatsApp
        </span>
      </h1>

      <form
        action={(fd) => {
          fd.set("waktu", waktu);
          // KONTRAK FormData KE `ajukanJadwal` TIDAK BERUBAH: medannya tetap
          // layanan, varian, tanggal, jam, waktu, alamat, catatan. Itulah yang
          // menjaga seluruh pagar server, gerbang skrining tiga lapis, dan
          // trigger basis data tetap utuh tanpa disentuh.
          //
          // `layanan` DISETEL DI SINI dan barisnya wajib ada: dulu medan itu
          // disediakan otomatis oleh `<select name="layanan">`, dan select itu
          // sudah tidak ada — digantikan katalog yang tombol-tombolnya tidak
          // menyumbang medan apa pun ke FormData. Tanpa baris di bawah,
          // `ajukanJadwal` menerima `layanan` kosong dan MENOLAK SETIAP
          // PENGAJUAN.
          fd.set("layanan", layananId);
          fd.set("varian", varianId);
          fd.set("jam", jam);
          mulai(async () => {
            const r = await ajukanJadwal(fd);
            if (r.ok) {
              // BERPINDAH KE BERANDA, bukan menampilkan panel sukses di sini.
              //
              // Sebabnya bukan selera: begitu pengajuan berhasil, skrining yang
              // menopangnya HANGUS (spec J3) — dan halaman ini, yang dirender
              // ulang sesudah `revalidatePath`, sah berubah menjadi "Isi
              // skrining keselamatan dulu". Panel sukses lalu tertimpa oleh
              // kalimat yang berbohong: klien baru saja memesan dan disuruh
              // mengulang skrining.
              //
              // Ditemukan lewat E2E yang gagal berselang-seling. Beranda juga
              // tujuan yang lebih benar: di sanalah pengajuannya muncul.
              router.replace("/passport?pengajuan=terkirim");
            } else {
              // Galat server selalu tentang isian langkah 2 (tanggal lampau,
              // jam di luar jam layanan, alamat terlalu pendek) atau tentang
              // skrining. Klien DIBIARKAN di langkah 2 supaya kalimat galatnya
              // berdiri di sebelah medan yang menyebabkannya.
              setLangkah(2);
              setPesan(r.pesan);
            }
          });
        }}
      >
        {/* Tiga kelompok, tiga pertanyaan: APA, KAPAN, KE MANA. Urutannya sama
            dengan urutan medan sebelumnya (spec J2) — yang berubah hanya
            tajuknya, supaya formulir yang kini jauh lebih panjang tetap bisa
            dibaca sebagai tiga keputusan, bukan tujuh kotak berderet. */}
        {/* Penanda dua langkah. Bukan hiasan: ia menyatakan ADA BERAPA langkah
            dan di mana klien berada — tanpa itu, layar yang berganti isi
            terasa seperti halaman yang hilang. Keduanya bisa diketuk, jadi
            klien bisa mundur tanpa mencari tombol kembali. */}
        <div className="mb-5 flex items-center gap-2">
          {([1, 2] as const).map((n, i) => (
            <Fragment key={n}>
              {i > 0 && <span aria-hidden className="h-px flex-1 bg-black/10" />}
              <button
                type="button"
                onClick={() => setLangkah(n)}
                aria-current={langkah === n ? "step" : false}
                className={`flex items-center gap-2 text-[12.5px] font-semibold ${
                  langkah === n ? "text-night" : "text-ink-soft"
                }`}
              >
                <span
                  className={`grid h-5 w-5 place-items-center rounded-full border text-[11.5px] ${
                    langkah === n
                      ? "border-night bg-night text-paper"
                      : "border-black/10 bg-white text-ink-soft"
                  }`}
                >
                  {n}
                </span>
                {n === 1 ? "Pilih layanan" : "Isi data"}
              </button>
            </Fragment>
          ))}
        </div>

        <div hidden={langkah !== 1}>
          <Katalog
            layanan={katalog}
            varianId={varianId}
            faseKlien={faseKlien}
            onPilih={pilihVarian}
          />

          {/* Bilah pilihan menempel di bawah layar sepanjang katalog digulir:
              di daftar sepanjang ini, jawaban atas "saya sudah pilih apa, dan
              berapa" tidak boleh ikut tergulir naik. `bottom` di mobile
              menghindari nav bawah yang `fixed` di layout passport. */}
          <div className="sticky bottom-[76px] z-40 mt-5 flex items-center gap-3 rounded-2xl border border-black/10 bg-paper/95 px-4 py-3 backdrop-blur sm:bottom-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] text-ink-soft">Pilihan Anda</span>
              <span className="block truncate text-[13px] text-night">
                {namaTerpilih === "" ? "Belum ada pilihan" : namaTerpilih}
              </span>
            </span>
            {varianTerpilih?.hargaKlien && (
              <b className="shrink-0 font-serif text-[15px] font-normal text-night">
                {varianTerpilih.hargaKlien}
              </b>
            )}
            <button
              type="button"
              onClick={() => setLangkah(2)}
              className="min-h-[44px] shrink-0 rounded-full bg-night px-5 text-[13.5px] font-semibold text-paper"
            >
              Isi data
            </button>
          </div>
        </div>

        <div hidden={langkah !== 2}>
        {/* Pilihan dari langkah 1 ikut terbawa, dan bisa diganti dari sini.
            Tanpa kartu ini, satu-satunya cara memastikan "tadi saya pilih yang
            mana" adalah mundur — dan yang mundur kehilangan tempatnya di
            daftar. */}
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-leaf/25 bg-leaf-soft px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block font-serif text-[15.5px] leading-snug text-night">
              {namaTerpilih === "" ? "Belum ada pilihan" : namaTerpilih}
            </span>
            {varianTerpilih?.hargaKlien && (
              <span className="mt-0.5 block font-serif text-[13px] text-leaf">
                {varianTerpilih.hargaKlien}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setLangkah(1)}
            className="min-h-[36px] shrink-0 rounded-full border border-night/20 bg-white px-3.5 text-[12px] font-semibold text-night"
          >
            Ganti
          </button>
        </div>

        <h2 className="mb-3 text-sm font-semibold text-ink-soft">Kapan</h2>

        <label className="mb-4 block text-sm">
          <span className="font-semibold text-ink-soft">Tanggal yang diinginkan</span>
          <input
            type="date"
            name="tanggal"
            min={tanggalPalingAwal}
            required
            className="mt-1 min-h-[44px] w-full rounded-lg border border-black/15 px-3 py-2.5"
          />
        </label>

        {/* Urutan medan mengikuti gambar alur klien: durasi -> tanggal -> JAM ->
            alamat -> catatan (spec J2). Jam berdiri SESUDAH tanggal karena
            keduanya satu keputusan: "kapan", dan memisahkannya dengan medan
            lain membuat klien memilih tanggal, lupa jam, lalu kembali. */}
        <label className="mb-4 block text-sm">
          <span className="font-semibold text-ink-soft">Jam mulai</span>
          <select
            name="jam"
            required
            value={jam}
            onChange={(e) => setJam(e.target.value)}
            className="mt-1 min-h-[44px] w-full rounded-lg border border-black/15 px-3 py-2.5"
          >
            {jamPilihan.map((j) => (
              <option key={j} value={j}>
                {formatJam(j)}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="mb-4">
          <legend className="text-sm font-semibold text-ink-soft">
            Kalau jam itu penuh, saya lebih suka
          </legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {WAKTU.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWaktu(w)}
                aria-pressed={waktu === w}
                className={`min-h-[44px] rounded-xl border px-2 py-3 text-[13px] font-semibold capitalize ${
                  waktu === w
                    ? "border-night bg-leaf-soft text-night"
                    : "border-black/15 bg-white text-ink-soft"
                }`}
              >
                {w}
              </button>
            ))}
          </div>
          {/* Arti medan ini BERUBAH di C1 (spec J2): dulu ia satu-satunya
              keterangan waktu, sekarang ia alternatif bila jam yang diminta
              tidak bisa. Kalimat di bawah ada supaya klien tidak mengira ia
              sedang memilih waktunya dua kali. */}
          <span className="mt-2 block text-[11.5px] text-ink-soft">
            Tim PADMA memakai ini saat menawarkan jam pengganti — jadwal Anda tetap jam yang
            dipilih di atas.
          </span>
        </fieldset>

        <h2 className="mb-3 mt-7 text-sm font-semibold text-ink-soft">Ke mana</h2>

        <label className="mb-4 block text-sm">
          <span className="font-semibold text-ink-soft">Alamat kunjungan</span>
          {/* `defaultValue`, bukan `value` terkendali: sekali diisi dari
              profil, klien tetap mengetik bebas di atasnya — apa pun yang ada
              di medan ini saat submit itulah yang tersimpan (lihat komentar
              prop `alamatDefault`). */}
          <textarea
            name="alamat"
            required
            minLength={10}
            rows={2}
            defaultValue={alamatDefault}
            placeholder="Alamat lengkap tempat mitra datang"
            className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5"
          />
          <span className="mt-1 block text-xs text-ink-soft">
            {alamatDefault
              ? "Diisi otomatis dari alamat profil Anda — boleh diganti khusus untuk kunjungan ini."
              : "Belum ada alamat tersimpan di profil Anda — isi alamat tempat mitra datang untuk kunjungan ini."}
          </span>
        </label>

        <label className="mb-4 block text-sm">
          <span className="font-semibold text-ink-soft">Catatan (opsional)</span>
          <textarea
            name="catatan"
            rows={2}
            maxLength={300}
            placeholder="mis. tolong dengan Bidan Sri seperti biasa"
            className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5"
          />
        </label>

        {/* Ringkasan berdiri TEPAT di atas tombol kirim: ia jawaban terakhir
            atas "berapa" sebelum klien menekan kirim, dan di situlah orang
            mencarinya. */}
        <div className="mb-4">
          <Ringkasan
            hargaLayanan={varianTerpilih?.hargaKlien ?? null}
            namaTerpilih={namaTerpilih}
          />
        </div>

        {pesan && <p className="mb-3 text-sm text-clay">{pesan}</p>}

        <button
          type="submit"
          disabled={pending}
          className="min-h-[44px] w-full rounded-xl bg-gold py-3.5 font-bold text-[#FFF8EA] disabled:opacity-60"
        >
          {pending ? "Mengirim…" : "Kirim Permintaan Jadwal"}
        </button>
        <p className="mt-3 text-center text-xs text-ink-soft">
          Ini permintaan, bukan booking final — jadwal pasti dikonfirmasi tim PADMA
          bersama Anda via WhatsApp.
        </p>
        </div>
      </form>
    </section>
  );
}
