"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ajukanJadwal } from "@/lib/passport/aksi";
import { formatJam } from "@/lib/jadwal/jam";
import { formatTanggalID } from "@/lib/passport/waktu";
import { IkonFase, Katalog, type LayananKatalogAjukan } from "./katalog";
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
  waLink,
  namaKlien,
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
  // Nomor WhatsApp PADMA dari `app_settings`, sudah lewat `nomorWaTerpakai()`.
  waLink: string;
  // Nama klien ikut ke dalam pesan: yang menerima adalah admin yang membaca
  // puluhan chat, dan pesan tanpa nama memaksanya menebak dari nomor.
  namaKlien: string;
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

  // Panel sukses yang dulu berdiri di sini SUDAH PINDAH ke rute sendiri,
  // `/passport/ajukan/terkirim` — alasannya tertulis panjang di berkas itu.

  // Kartu halaman tetap PUTIH seperti seluruh halaman passport lain. Yang
  // beralas kertas hanyalah katalog di langkah 1 — panelnya sendiri di bawah —
  // karena di sanalah kartu putih per layanan butuh sesuatu untuk berdiri di
  // atasnya. Sempat seluruh kartu ini dijadikan kertas demi katalog itu, dan
  // akibatnya halaman ini menjadi satu-satunya layar passport yang berbeda
  // warna dari saudara-saudaranya.
  //
  // Padding mengecil di layar sempit karena lebar itu dipakai nama layanan:
  // dengan p-6 nama seperti "Garbha Couple Yoga" pecah jadi dua baris.
  return (
    <section className="rounded-2xl border border-black/10 bg-white p-4 sm:p-6">
      <h1 className="mb-5 font-serif text-xl leading-tight text-night">
        Ajukan Jadwal
        {/* Keterangan turun ke barisnya sendiri. Sebagai ekor di baris yang
            sama ia membungkus di tengah frasa dan tajuknya jadi dua baris
            berantakan di ponsel. */}
        <span className="mt-1 block font-sans text-xs font-semibold text-ink-soft">
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
              // NOTIFIKASI KE WHATSAPP PADMA.
              //
              // Pengajuan sudah TERSIMPAN sebelum baris ini — WhatsApp adalah
              // kabar, bukan pengirimannya. Kalau langkah di bawah gagal atau
              // dibatalkan klien, jadwalnya tetap ada di antrean admin; yang
              // hilang hanya kecepatan kabarnya.
              const teks = [
                `Halo PADMA, saya ${namaKlien} baru mengajukan jadwal:`,
                ``,
                `Layanan: ${namaTerpilih}`,
                `Tanggal: ${formatTanggalID(String(fd.get("tanggal") ?? ""))}`,
                `Jam: ${formatJam(jam)}`,
                `Kalau penuh, saya lebih suka: ${waktu}`,
                `Alamat: ${String(fd.get("alamat") ?? "")}`,
                ``,
                `Mohon dikonfirmasi ya, terima kasih.`,
              ].join("\n");
              const tautan = `https://wa.me/${waLink}?text=${encodeURIComponent(teks)}`;

              // `window.open` di sini berjalan SESUDAH `await`, jadi peramban
              // tidak lagi menganggapnya buah ketukan klien dan sebagian
              // pemblokir pop-up menolaknya — diam-diam, memulangkan null.
              // Kalau itu terjadi, halaman TIDAK berpindah: klien ditahan di
              // panel sukses yang memuat tautannya sebagai tombol, dan ketukan
              // pada tombol itu adalah gerakan pemakai yang tak bisa diblokir.
              // Nilai baliknya sengaja diabaikan. Pemblokir pop-up menolak
              // jendela yang lahir sesudah `await` dan memulangkan null —
              // dan itu tidak apa-apa: halaman tujuan di bawah memuat tombol
              // WhatsApp-nya sendiri, yang tak bisa diblokir karena lahir dari
              // ketukan.
              window.open(tautan, "_blank", "noopener");
              // BERPINDAH KE HALAMAN TERKIRIM, bukan menampilkan panel sukses
              // di sini.
              //
              // Sebabnya bukan selera: begitu pengajuan berhasil, skrining yang
              // menopangnya HANGUS (spec J3) — dan halaman ini, yang dirender
              // ulang sesudah `revalidatePath`, sah berubah menjadi "Isi
              // skrining keselamatan dulu". Panel sukses lalu tertimpa oleh
              // kalimat yang berbohong: klien baru saja memesan dan disuruh
              // mengulang skrining. Ditemukan lewat E2E yang gagal
              // berselang-seling.
              //
              // Tujuannya `/passport/ajukan/terkirim` dan bukan lagi beranda:
              // rute itu tidak berdiri di atas skrining, jadi tidak ada yang
              // bisa menggantikannya, DAN ia menyebutkan apa yang barusan
              // dipesan — yang hilang ketika klien dilempar ke beranda.
              router.replace("/passport/ajukan/terkirim");
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

        {/* Panel kertas — alas bagi kartu putih tiap layanan. Padding-nya 4 di
            semua ukuran karena bilah cari yang menempel di dalam katalog
            memakai margin negatif sebesar itu untuk menyamakan lebarnya dengan
            tepi panel. */}
        <div hidden={langkah !== 1} className="rounded-2xl bg-paper p-4">
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
          <div className="sticky bottom-[76px] z-40 mt-5 flex items-center gap-3 rounded-2xl border border-black/10 bg-white/95 px-4 py-3 shadow-[0_8px_24px_-16px_rgba(10,43,31,0.6)] backdrop-blur sm:bottom-3">
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
          {/* Ikon fase yang sama dengan tajuk fase di langkah 1: penanda yang
              sama untuk layanan yang sama. */}
          <IkonFase
            faseId={layananTerpilih?.faseId ?? ""}
            className="h-5 w-5 shrink-0 text-gold"
          />
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
