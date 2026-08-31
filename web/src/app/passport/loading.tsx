import { HalamanSkeleton } from "@/app/_shell/skeleton";

// Passport dibuka klien di ponsel, sering lewat koneksi seluler — justru di
// sinilah kerangka muat paling terasa gunanya.
export default function Memuat() {
  return <HalamanSkeleton label="Memuat passport…" kartu={2} baris={4} />;
}
