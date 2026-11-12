"use client";

import { LayarGalat } from "@/app/_shell/layar-galat";

/**
 * Error boundary panel owner, di bawah layout-nya: navigasi panel tetap tampil.
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
      tema="panel"
      kode={error.digest}
      pulang={{ href: "/owner", label: "Ke dasbor" }}
      onCobaLagi={() => retry()}
    />
  );
}
