import { Bagian, Butir, TautanWa } from "./kerangka";
import { BAGIAN_PRIVASI } from "./bagian";

/**
 * ISI KEBIJAKAN PRIVASI — DRAF TEKNIS, BUKAN NASIHAT HUKUM.
 *
 * Setiap pernyataan diturunkan dari inventaris data 6 Okt 2026 (spec
 * 2026-10-06). JANGAN menambahkan janji yang tidak dijalankan sistem — dua
 * yang paling menggoda dan SALAH hari ini: "data dicadangkan setiap hari"
 * (jadwal backup masih dimatikan) dan "Anda dapat menghapus akun sendiri"
 * (tidak ada fitur itu; DB melarang hapus rekam klien).
 *
 * Wilayah Supabase ("Singapura") wajib dicek di dasbor sebelum rilis — spec
 * deploy menyebut Singapura, spec backup masih menyebut Seoul.
 */
const PEMROSES = [
  { nama: "Supabase", guna: "Basis data, autentikasi, dan penyimpanan berkas, termasuk bukti pembayaran" },
  { nama: "Vercel", guna: "Hosting situs dan aplikasi" },
  { nama: "Cloudflare R2", guna: "Penyimpanan video materi, produk, dan testimoni" },
  { nama: "Resend", guna: "Pengiriman email sistem dan tagihan" },
  { nama: "Google", guna: "Masuk dengan akun Google, bila Anda memilihnya" },
  { nama: "DOKU", guna: "Pemrosesan pembayaran produk digital dan tagihan sesi" },
  { nama: "OpenStreetMap (Nominatim)", guna: "Mengubah teks alamat menjadi titik koordinat" },
] as const;

export function IsiKebijakanPrivasi({ waHref, waTampilan }: { waHref: string; waTampilan: string }) {
  return (
    <>
      <Bagian daftar={BAGIAN_PRIVASI} id="pengendali">
        <p>
          Kebijakan Privasi ini menjelaskan bagaimana PADMA Wellness (&ldquo;PADMA&rdquo;,
          &ldquo;kami&rdquo;) mengumpulkan, memakai, menyimpan, dan melindungi data pribadi Anda, sesuai
          Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi. PADMA adalah pengendali
          data pribadi yang Anda berikan lewat situs dan Digital Passport.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="data-dikumpulkan">
        <Butir>
          <li>
            <strong>Data akun:</strong> nama, email, nomor WhatsApp, dan kata sandi (disimpan dalam
            bentuk tersandi yang tidak dapat kami baca). Bila Anda masuk dengan Google, kami menerima
            nama, email, dan foto profil dari Google.
          </li>
          <li>
            <strong>Alamat kunjungan</strong> beserta titik koordinatnya, untuk menghitung biaya
            transport dan menuju lokasi Anda.
          </li>
          <li id="data-kesehatan" className="scroll-mt-28">
            <strong>Data kesehatan (data pribadi spesifik):</strong> jawaban skrining atas pertanyaan
            keselamatan, termasuk tentang perdarahan, nyeri, infeksi, kehamilan, dan kesehatan mental;
            fase Anda (program kehamilan, hamil, nifas, atau menopause); usia kehamilan bila Anda
            mengisinya; serta hasil skrining. Setiap skrining baru hanya kami simpan dengan persetujuan
            eksplisit Anda; skrining yang dikirim sebelum kebijakan ini berlaku tetap kami simpan sebagai
            riwayat layanan.
          </li>
          <li>
            <strong>Catatan dan rekomendasi sesi</strong> yang ditulis tim PADMA, yang dapat Anda baca
            di Passport, serta penilaian dan komentar Anda atas sesi.
          </li>
          <li>
            <strong>Bukti pembayaran:</strong> gambar yang Anda unggah dapat memuat nama pemilik
            rekening, nomor rekening, dan saldo. Kami menyarankan Anda menutupi saldo sebelum
            mengunggah.
          </li>
          <li>
            <strong>Riwayat pesanan dan pembayaran</strong>, termasuk metode bayar dan nomor transaksi
            dari DOKU. Data kartu atau rekening yang Anda masukkan di halaman pembayaran DOKU
            tidak diterima PADMA.
          </li>
          <li>
            <strong>Pembelian produk digital:</strong> nama dan email Anda dicetak pada berkas yang Anda
            unduh.
          </li>
          <li>
            <strong>Testimoni</strong> (nama, keterangan, kutipan, dan video), hanya bila Anda
            mengizinkannya.
          </li>
          <li>
            <strong>Data teknis:</strong> cookie yang diperlukan untuk sesi masuk. Aplikasi kami
            memakai alamat IP sesaat untuk membatasi percobaan berulang; penyedia autentikasi dan
            hosting kami mencatatnya di log keamanan mereka. Kami tidak memakainya untuk pelacakan.
          </li>
        </Butir>
        <p>Kami tidak mengumpulkan data bayi, seperti nama atau tanggal lahir bayi.</p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="tujuan">
        <Butir>
          <li>Menilai keselamatan dan kelayakan layanan, berdasarkan persetujuan eksplisit Anda.</li>
          <li>
            Menjadwalkan dan menjalankan kunjungan, serta menyediakan Digital Passport dan produk
            digital, untuk melaksanakan layanan yang Anda pesan.
          </li>
          <li>
            Memproses pembayaran dan mencatat transaksi, untuk melaksanakan layanan dan memenuhi
            kewajiban hukum, termasuk pembukuan.
          </li>
          <li>Menghubungi Anda tentang layanan, tagihan, dan jadwal.</li>
        </Butir>
        <p>Kami tidak memakai data Anda untuk iklan dan tidak menjualnya kepada siapa pun.</p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="akses">
        <Butir>
          <li>Admin dan pemilik PADMA, sesuai tugasnya.</li>
          <li>
            Bidan atau mitra yang ditugaskan untuk sesi Anda, sebatas yang diperlukan untuk menjalankan
            kunjungan, misalnya nama, alamat, jadwal, dan catatan kondisi yang relevan. Mitra tidak
            memiliki akun di aplikasi PADMA.
          </li>
          <li>Pemroses pihak ketiga pada bagian berikut, sebatas fungsinya.</li>
          <li>Pihak berwenang, bila diwajibkan oleh hukum.</li>
        </Butir>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="pihak-ketiga">
        <p>Kami memakai penyedia layanan berikut untuk menjalankan PADMA:</p>
        <div className="overflow-x-auto rounded-xl border border-situs-garis">
          <table className="w-full min-w-[480px] border-collapse text-left text-[15px] leading-relaxed">
            <thead className="bg-situs-kartu text-situs-judul">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Penyedia</th>
                <th scope="col" className="px-4 py-3 font-semibold">Gunanya</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-situs-garis">
              {PEMROSES.map((p) => (
                <tr key={p.nama}>
                  <td className="px-4 py-3 align-top font-semibold">{p.nama}</td>
                  <td className="px-4 py-3 align-top">{p.guna}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Sebagian penyedia tersebut menyimpan atau memproses data di luar Indonesia; basis data kami
          berada di Singapura. Kami memilih penyedia yang menerapkan standar keamanan yang memadai.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="whatsapp">
        <p>
          Beberapa tombol di situs dan Passport membuka WhatsApp dengan pesan yang sudah terisi, misalnya
          ringkasan skrining (termasuk hasil HIJAU atau MERAH) atau rincian pemesanan. Pesan itu baru
          terkirim bila Anda menekan kirim, dan Anda dapat menyuntingnya lebih dulu. Pesan WhatsApp
          diproses oleh layanan WhatsApp milik Meta. Admin PADMA juga mengirim undangan aktivasi dan
          tagihan lewat WhatsApp.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="keamanan">
        <Butir>
          <li>Koneksi ke situs dan aplikasi terenkripsi (HTTPS).</li>
          <li>
            Akses dibatasi menurut peran: klien hanya dapat membaca datanya sendiri, dan aturan ini
            ditegakkan langsung di basis data.
          </li>
          <li>
            Berkas seperti bukti pembayaran dan sertifikat disimpan di penyimpanan privat, dan tautan
            unduhnya berlaku untuk waktu terbatas.
          </li>
        </Butir>
        <p>
          Tidak ada sistem yang sepenuhnya kebal. Bila terjadi insiden, kami bertindak sesuai bagian
          Kebocoran Data di bawah.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="penyimpanan">
        <p>
          Riwayat layanan, hasil skrining, catatan sesi, dan transaksi kami simpan selama Anda memakai
          layanan PADMA dan sesudahnya selama diperlukan untuk keselamatan layanan lanjutan serta
          kewajiban pembukuan.
        </p>
        <p>
          Anda dapat meminta penghapusan data lewat WhatsApp admin. Setiap permintaan kami tinjau per
          kasus, dan data yang tidak wajib kami simpan akan dihapus. Nama, nomor WhatsApp, dan alamat
          dapat Anda perbarui sendiri di Profil Passport.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="hak-anda">
        <p>Sesuai UU Pelindungan Data Pribadi, Anda berhak untuk:</p>
        <Butir>
          <li>mendapat informasi tentang pemrosesan data Anda;</li>
          <li>mengakses dan memperoleh salinan data pribadi Anda;</li>
          <li>membetulkan data yang tidak akurat;</li>
          <li>meminta penghapusan data, yang ditinjau sebagaimana di bagian Penyimpanan;</li>
          <li>
            menarik persetujuan. Penarikan tidak berlaku surut, dan layanan yang memerlukan data
            tersebut, termasuk sesi kunjungan, tidak dapat dilanjutkan;
          </li>
          <li>mengajukan keberatan atas pemrosesan data Anda.</li>
        </Butir>
        <p>
          Ajukan permintaan Anda lewat WhatsApp admin <TautanWa href={waHref} tampilan={waTampilan} />.
          Kami menanggapi paling lambat 3×24 jam.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="cookie">
        <p>
          Kami hanya memakai cookie yang diperlukan agar layanan berjalan: sesi masuk; penanda klaim
          skrining (2 jam); penanda undangan aktivasi (1 jam); tujuan setelah masuk (1 jam); dan penanda
          persetujuan dari formulir pendaftaran (1 hari). Kami tidak memakai cookie analitik atau
          pelacak. Halaman pembayaran DOKU dapat memasang cookie-nya sendiri.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="kebocoran">
        <p>
          Bila terjadi kegagalan pelindungan data pribadi yang berdampak pada Anda, kami memberi tahu
          Anda paling lambat 3×24 jam sejak mengetahuinya, beserta data yang terdampak dan langkah yang
          kami ambil.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_PRIVASI} id="perubahan-kontak">
        <p>
          Kami dapat memperbarui kebijakan ini. Versi terbaru dan tanggal berlakunya selalu tersedia di
          halaman ini. Bila ada perubahan, Anda akan diminta menyetujui versi baru sebelum memakai
          Digital Passport lagi.
        </p>
        <p>
          Pertanyaan dan permintaan terkait data pribadi: WhatsApp admin{" "}
          <TautanWa href={waHref} tampilan={waTampilan} />.
        </p>
      </Bagian>
    </>
  );
}
