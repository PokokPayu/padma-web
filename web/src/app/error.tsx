"use client";

import { LayarGalat } from "@/app/_shell/layar-galat";

/**
 * Error boundary untuk situs publik, skrining, dan produk.
 *
 * Tombolnya memanggil `retry` (ambil ulang data server lalu render ulang),
 * BUKAN `reset`: galat baca server tidak pulih tanpa pengambilan ulang.
 * Pesan galat sengaja tidak diteruskan, hanya digest-nya.
 */
export default function Galat({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <LayarGalat
      tema="klien"
      kode={error.digest}
      pulang={{ href: "/", label: "Ke beranda" }}
      onCobaLagi={() => retry()}
    />
  );
}
