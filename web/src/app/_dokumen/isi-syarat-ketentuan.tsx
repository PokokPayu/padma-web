import Link from "next/link";
import { Bagian, Butir, TautanWa } from "./kerangka";
import { BAGIAN_SK } from "./bagian";

/**
 * ISI SYARAT & KETENTUAN — DRAF TEKNIS, BUKAN NASIHAT HUKUM.
 *
 * Wajib dibaca konsultan hukum dan disetujui klien PADMA sebelum rilis (spec
 * 2026-10-06, "Prasyarat rilis"). Setiap fakta di sini dirujuk dari spec
 * "isi wajib per bagian"; mengubahnya tanpa menaikkan VERSI_DOKUMEN berarti
 * klien terikat pada teks yang tidak pernah mereka setujui.
 *
 * Tabel pembatalan DISALIN UTUH dari
 * docs/superpowers/2026-09-08-kebijakan-pembatalan-klien.md. Jangan meringkas
 * dari ingatan — baca dari sana.
 */
export function IsiSyaratKetentuan({
  waHref,
  waTampilan,
  area,
}: {
  waHref: string;
  waTampilan: string;
  area: string;
}) {
  return (
    <>
      <Bagian daftar={BAGIAN_SK} id="penerimaan">
        <p>
          Syarat & Ketentuan ini mengatur pemakaian situs, Digital Passport, skrining, layanan
          kunjungan, dan produk digital PADMA Wellness (&ldquo;PADMA&rdquo;, &ldquo;kami&rdquo;). Anda
          menyatakan setuju dengan mencentang kotak persetujuan di formulir pendaftaran, skrining, atau
          layar persetujuan. Bila Anda tidak setuju, mohon tidak memakai layanan kami.
        </p>
        <p>
          Ketentuan ini dibaca bersama{" "}
          <Link href="/kebijakan-privasi" className="font-semibold text-situs-emas underline underline-offset-2 hover:text-situs-emas-tua">
            Kebijakan Privasi
          </Link>{" "}
          PADMA.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="tentang-layanan">
        <p>
          PADMA adalah layanan wellness dan edukasi bagi perempuan dan keluarga, dari program kehamilan,
          kehamilan, masa nifas, hingga menopause. PADMA bukan layanan medis: kami tidak memberikan
          diagnosis, terapi medis, maupun resep. Bila diperlukan asesmen individual, diagnosis, atau
          terapi medis, kami mengarahkan Anda ke tenaga medis yang sesuai.
        </p>
        <p>
          Materi edukasi dan artikel PADMA bukan pengganti saran dokter atau bidan yang merawat Anda.
          Dalam keadaan darurat, segera hubungi <strong>119</strong> atau fasilitas kesehatan terdekat.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="akun">
        <Butir>
          <li>Anda harus berusia minimal 18 tahun untuk membuat akun.</li>
          <li>
            Data yang Anda isi harus benar dan terbaru. Nama, nomor WhatsApp, dan alamat dapat Anda
            perbarui sendiri di Profil Passport.
          </li>
          <li>
            Satu akun untuk satu orang. Jaga kerahasiaan kata sandi Anda; aktivitas melalui akun Anda
            dianggap dilakukan oleh Anda.
          </li>
          <li>Segera kabari kami bila Anda menduga akun Anda dipakai orang lain.</li>
        </Butir>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="skrining">
        <Butir>
          <li>Skrining wajib diisi sebelum layanan kunjungan dijadwalkan.</li>
          <li>
            Isi skrining dengan jujur sesuai kondisi Anda saat itu. Informasi yang tidak lengkap atau
            tidak benar dapat membahayakan keselamatan Anda.
          </li>
          <li>
            Hasil skrining adalah pra-skrining keselamatan, bukan diagnosis dan bukan izin medis. Tim
            PADMA tetap memverifikasi kondisi Anda sebelum layanan.
          </li>
          <li>
            PADMA berhak menunda, menyesuaikan, atau menolak layanan bila skrining atau pengamatan di
            lokasi menunjukkan tanda bahaya, dan dapat menyarankan Anda menemui dokter lebih dulu.
          </li>
        </Butir>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="pemesanan">
        <Butir>
          <li>
            Pemesanan diajukan lewat Digital Passport dan baru pasti setelah dikonfirmasi admin PADMA.
          </li>
          <li>Wilayah layanan kunjungan rumah: {area}.</li>
          <li>Biaya transport mengikuti alamat kunjungan dan tercantum di tagihan Anda.</li>
          <li>Bidan atau mitra yang bertugas ditentukan oleh PADMA.</li>
          <li>Pastikan alamat kunjungan benar dan Anda dapat dihubungi pada hari layanan.</li>
        </Butir>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="pembayaran">
        <Butir>
          <li>
            Sesi kunjungan dibayar lewat QRIS PADMA, lalu bukti pembayarannya diunggah di Digital
            Passport.
          </li>
          <li>
            Tagihan sesi harus dibayar dalam 24 jam sejak terbit. Lewat dari itu, pengajuan batal dan
            slotnya dilepas untuk klien lain.
          </li>
          <li>
            Produk digital dibayar lewat Midtrans. Pesanan yang tidak dibayar dalam 24 jam kedaluwarsa
            dengan sendirinya.
          </li>
          <li>Harga yang berlaku adalah harga yang tertera saat tagihan atau pesanan dibuat.</li>
        </Butir>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="pembatalan">
        <p>Kebijakan pembatalan dan jadwal ulang sesi kunjungan:</p>
        <div className="overflow-x-auto rounded-xl border border-situs-garis">
          <table className="w-full min-w-[520px] border-collapse text-left text-[15px] leading-relaxed">
            <thead className="bg-situs-kartu text-situs-judul">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Keadaan</th>
                <th scope="col" className="px-4 py-3 font-semibold">Yang berlaku</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-situs-garis">
              <tr>
                <td className="px-4 py-3 align-top"><strong>≥ 24 jam</strong> sebelum sesi</td>
                <td className="px-4 py-3 align-top"><strong>Refund 100%</strong> ATAU <strong>reschedule gratis</strong></td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top"><strong>2–24 jam</strong> sebelum sesi</td>
                <td className="px-4 py-3 align-top">
                  <strong>Reschedule gratis 1×.</strong> Bila memilih batal: dana menjadi{" "}
                  <strong>kredit layanan, berlaku 30 hari</strong>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top">
                  <strong>{"< 2 jam"}</strong>, ATAU <strong>mitra sudah berangkat</strong>, ATAU{" "}
                  <strong>no-show</strong>
                </td>
                <td className="px-4 py-3 align-top">
                  <strong>Dana tidak dapat dikembalikan.</strong> Jadwal ulang dihitung sebagai{" "}
                  <strong>pemesanan baru</strong>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top"><strong>PADMA yang membatalkan</strong></td>
                <td className="px-4 py-3 align-top">
                  <strong>Refund 100%</strong> ATAU <strong>reschedule prioritas tanpa biaya tambahan</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <strong>Pengecualian, keadaan darurat medis:</strong> Persalinan dan rawat inap ditinjau untuk
          reschedule tanpa penalti.
        </p>
        <Butir>
          <li>
            Reschedule gratis pada jendela 2–24 jam berlaku 1× per pemesanan. Setelah jatah itu terpakai,
            permintaan jadwal ulang berikutnya pada jendela yang sama diperlakukan sebagai pembatalan:
            dana menjadi kredit layanan.
          </li>
          <li>
            Kredit layanan berupa hak satu sesi untuk layanan yang sama, tidak dapat dipindahkan ke
            layanan lain, dan berlaku sampai 30 hari setelah tanggal sesi yang dibatalkan.
          </li>
          <li>
            Seluruh batas waktu dihitung dari tanggal dan jam mulai sesi dalam Waktu Indonesia Barat
            (WIB).
          </li>
          <li>Refund diproses manual oleh admin PADMA melalui transfer bank.</li>
        </Butir>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="produk-digital">
        <Butir>
          <li>
            Pembelian produk digital memberi Anda lisensi pribadi yang tidak dapat dialihkan untuk
            memakai materi tersebut bagi diri sendiri.
          </li>
          <li>
            Anda tidak boleh membagikan, mengunggah ulang, menggandakan untuk orang lain, atau menjual
            ulang materi PADMA.
          </li>
          <li>
            Halaman PDF yang dibaca di Passport ditandai nama dan PADMA ID Anda; berkas PDF yang diunduh
            dicap nama dan email Anda di setiap halaman.
          </li>
          <li>Produk digital dikirim seketika sesudah pembayaran dan tidak dapat dikembalikan.</li>
          <li>PADMA dapat mencabut akses bila ketentuan ini dilanggar.</li>
          <li>Bila produk tidak dapat dibuka karena kendala teknis, hubungi admin lewat WhatsApp.</li>
        </Butir>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="testimoni">
        <p>
          PADMA hanya menayangkan testimoni, termasuk video, dengan izin pemiliknya. Anda dapat meminta
          testimoni Anda diturunkan lewat WhatsApp admin.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="batasan-tanggung-jawab">
        <p>
          Sepanjang diizinkan hukum, PADMA tidak bertanggung jawab atas kerugian yang timbul dari kondisi
          yang tidak diungkapkan atau diungkapkan tidak benar saat skrining maupun sesi, dari pemakaian
          materi edukasi sebagai pengganti nasihat dokter atau bidan, atau dari gangguan layanan pihak
          ketiga di luar kendali kami. Ketentuan ini tidak mengurangi hak Anda sebagai konsumen menurut
          peraturan perundang-undangan.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="perubahan">
        <p>
          Kami dapat memperbarui Syarat & Ketentuan ini. Versi terbaru selalu tersedia di halaman ini
          beserta tanggal berlakunya. Bila ada perubahan, Anda akan diminta menyetujui versi baru sebelum
          memakai Digital Passport lagi.
        </p>
      </Bagian>

      <Bagian daftar={BAGIAN_SK} id="hukum-kontak">
        <p>
          Syarat & Ketentuan ini tunduk pada hukum Republik Indonesia. Perselisihan diupayakan selesai
          lebih dulu secara musyawarah.
        </p>
        <p>
          Pertanyaan tentang ketentuan ini dapat disampaikan ke WhatsApp admin PADMA:{" "}
          <TautanWa href={waHref} tampilan={waTampilan} />.
        </p>
      </Bagian>
    </>
  );
}
