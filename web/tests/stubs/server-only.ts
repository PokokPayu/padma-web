// Stub Vitest untuk paket "server-only".
//
// Paket asli melempar Error tanpa syarat kecuali bundler (webpack/Turbopack
// Next.js) menukarnya ke export kondisional "react-server" — pertukaran itu
// terjadi di level bundler, sesuatu yang TIDAK dilakukan Vitest. Tanpa alias
// ini, setiap berkas yang mengimpor `@/lib/r2` gagal di test dengan
// "This module cannot be imported from a Client Component module", padahal
// r2.ts memang hanya pernah dipanggil dari server action/route (Task 5 & 7).
export {};
