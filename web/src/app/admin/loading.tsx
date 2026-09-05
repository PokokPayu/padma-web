import { HalamanSkeleton } from "@/app/_shell/skeleton";

// Panel admin didominasi tabel panjang (klien, sesi, pembayaran), jadi kartu
// pertamanya diberi baris paling banyak.
export default function Memuat() {
  return (
    <HalamanSkeleton label="Memuat panel admin…" kartu={3} baris={5} varian="panel" />
  );
}
