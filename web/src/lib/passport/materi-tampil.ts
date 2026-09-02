import type { MateriRingkas } from "./data";

/**
 * Aturan M10 — materi mana yang boleh muncul di daftar klien.
 *
 * Kartu terkunci ada untuk menggoda: "jalani layanan ini dan materinya
 * terbuka". Untuk materi TANPA layanan, janji itu bohong — tidak ada layanan
 * yang bisa dijalani untuk membukanya. Materi semacam itu hanya muncul bila
 * memang sudah di-assign kepada klien tersebut.
 *
 * Efek sampingnya sehat: judul materi yang belum diperuntukkan bagi siapa pun
 * tidak ikut terpampang ke seluruh klien.
 */
export function saringDaftarMateri(daftar: MateriRingkas[]): MateriRingkas[] {
  return daftar.filter((m) => m.punyaLayanan || m.terbuka);
}
