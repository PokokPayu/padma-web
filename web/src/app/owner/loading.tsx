import { HalamanSkeleton } from "@/app/_shell/skeleton";

// Panel owner lebih ringkas: ringkasan pekan lalu satu-dua kartu angka.
export default function Memuat() {
  return (
    <HalamanSkeleton label="Memuat panel owner…" kartu={2} baris={4} varian="panel" />
  );
}
