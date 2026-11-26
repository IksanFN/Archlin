# Archlin Cortex

Platform pribadi self-hosted untuk satu pengguna: inti platform (akun, sesi, verifikasi dua langkah, outbox, worker) dan, di milestone berikutnya, modul Knowledge Base sebagai pengganti Docmost. Semua data tinggal di server sendiri: tanpa telemetri, tanpa CDN, tanpa API AI di cloud.

## Prasyarat (Windows)

- Node 24 (`.node-version`) dan pnpm 12.18.0 (`npm install -g pnpm@12.18.0`)
- Podman dengan mesin yang sedang berjalan (`podman machine start`), untuk database dev, test integrasi, E2E, dan stack lokal
- Penyedia compose untuk `podman compose`: di Podman Desktop buka Settings → Resources → Compose → Setup. Cek dengan `podman compose version`
- Git Bash untuk skrip `docker/*.sh` (nama folder `docker/` tetap, isinya dijalankan dengan Podman)
- Opsional: `gitleaks` (`winget install Gitleaks.Gitleaks`). Tanpa itu, hook pre-commit memakai image `ghcr.io/gitleaks/gitleaks` lewat Podman.

Setelah memasang Podman, buka ulang terminal dan editor agar perintah `podman` dikenali.

## Setup untuk pengembangan

```bash
pnpm install
pnpm hooks:install                 # pasang hook pre-commit pemindai secret
node scripts/generate-env.mjs      # membuat .env dan .env.migrate dengan secret baru; nilai tidak ditampilkan
pnpm db:up                         # Postgres dev di 127.0.0.1:54329
pnpm --filter @archlin/migrate build && pnpm --filter @archlin/migrate start
pnpm --filter @archlin/web dev     # http://localhost:3000
pnpm --filter @archlin/worker build && pnpm --filter @archlin/worker start   # di terminal lain
```

Kunjungan pertama ke aplikasi membuka halaman setup untuk membuat satu-satunya akun. Halaman itu meminta kode setup, yaitu nilai `ARCHLIN_SETUP_TOKEN` di `.env`. Tampilkan dengan:

```powershell
Select-String -Path .env -Pattern '^ARCHLIN_SETUP_TOKEN='
```

Hanya proses `apps/migrate` yang boleh memegang `MIGRATOR_DATABASE_URL`. Web dan worker menolak start bila variabel itu ada di lingkungannya.

## Perintah

Jalankan dari folder `cortex/`.

| Perintah | Fungsi |
|---|---|
| `pnpm verify` | Lint, typecheck, test unit, dan `pnpm audit --prod --audit-level high` |
| `pnpm lint` / `pnpm typecheck` | ESLint (termasuk aturan batas modul) dan TypeScript |
| `pnpm test:unit` | Test unit, tanpa Podman |
| `pnpm test:int` | Test integrasi dengan Testcontainers (`pgvector/pgvector:pg17`), butuh Podman |
| `pnpm test:e2e` | Build web dan migrate, buat ulang database `cortex_e2e`, jalankan Playwright (chromium, firefox, mobile) di port 3100. Pertama kali: `pnpm --filter @archlin/web exec playwright install chromium firefox` |
| `pnpm db:up` / `pnpm db:down` | Postgres dev |
| `pnpm stack:up` / `stack:down` / `stack:logs` | Stack lokal (lihat di bawah) |
| `pnpm hooks:install` | Mengarahkan Git ke `.githooks` |
| `bash docker/restore.sh <backup> <identity>` | Memulihkan backup |
| `bash docker/verify-restore.sh <identity> --confirm-destroy` | Uji backup dan restore ke volume kosong |

Tidak ada workflow CI di repo ini. Pemeriksaan dijalankan lokal dengan `pnpm verify`, lalu `pnpm test:int` dan `pnpm test:e2e` sebelum merge.

Di Windows, `exec` lewat API Podman (named pipe) tidak pernah menutup aliran output untuk klien Node, sehingga `container.exec()` dan cek port bawaan Testcontainers macet. Karena itu helper test menunggu health check saja dan menjalankan `psql` lewat `podman exec`. Pakai pola yang sama untuk test baru. `podman compose` tidak terdampak.

## Stack lokal

```bash
node scripts/generate-env.mjs
pnpm stack:up                       # http://localhost:8080
```

Stack berisi Postgres (tanpa port yang dibuka ke host), `migrate` (sekali jalan), `web` (hanya di `127.0.0.1`), `worker` (tanpa jalur keluar), dan `backup`. Layanan `backup` menolak start sebelum `BACKUP_AGE_RECIPIENT` terisi; langkahnya ada di bagian berikut. Cek kesehatan: `curl http://localhost:8080/health` menjawab `{"db":"ok","migrations":"ok"}`.

Di server Linux, Podman tidak punya daemon yang menyalakan ulang container setelah reboot. Aktifkan `sudo systemctl enable podman-restart.service` agar kebijakan `restart: unless-stopped` berlaku sejak boot (untuk Podman rootful; rootless belum diuji).

## Backup dan restore

Backup harian jam 02:00 (`BACKUP_TZ`) disimpan 14 hari di volume `backups` sebagai `archlin-<waktu>.tar.age`: dump database, file unggahan, dan manifest dengan checksum, dienkripsi dengan kunci publik `age`. Kunci privatnya tidak pernah ada di server.

1. Buat pasangan kunci sekali saja, di luar repo:
   ```bash
   podman compose -f docker/compose.yml --env-file .env build backup
   podman compose -f docker/compose.yml --env-file .env run --rm --no-deps --entrypoint age-keygen backup > "$USERPROFILE/archlin-backup.agekey"
   ```
2. Salin baris `# public key: age1...` ke `BACKUP_AGE_RECIPIENT` di `.env`, lalu `pnpm stack:up`.
3. **Simpan kunci privat (`archlin-backup.agekey`) dan `TOTP_ENC_KEY` di luar server**, misalnya di password manager. Tanpa kunci privat backup tidak bisa dibuka. Tanpa `TOTP_ENC_KEY` rahasia TOTP di dalam backup tidak bisa dibaca, sehingga login dengan 2FA gagal setelah restore.
4. Restore: `bash docker/restore.sh <file-backup> <file-identity>`. Skrip menghentikan web, worker, dan backup, memeriksa checksum sebelum menyentuh database, memulihkan database dan file, lalu menyalakan semuanya lagi. Backup yang rusak atau dimanipulasi ditolak dan database lama tetap utuh.
5. Verifikasi berkala: `bash docker/verify-restore.sh "$USERPROFILE/archlin-backup.agekey" --confirm-destroy`. Skrip ini **menghapus** volume `archlin_pgdata` dan `archlin_files` lalu memulihkannya dari backup baru, jadi jalankan hanya di stack lokal. Setelah selesai, uji login dengan TOTP secara manual.

## Lampiran dan backup

- Lampiran disimpan di volume `files` sebagai blob yang tidak pernah diubah: `blobs/<owner>/<aa>/<sha256>`. Nama file adalah hash isinya, jadi file yang sama di dua halaman memakai satu blob.
- Pembersih (GC) menghapus blob hanya setelah tidak dirujuk selama 24 jam sejak ditandai. Karena itu backup yang selesai kurang dari 24 jam selalu memuat setiap blob yang dirujuk dump-nya. File staging (`.staging`) tidak ikut backup; worker membersihkan yang tertinggal setelah 24 jam.
- `verify-restore.sh` membandingkan jumlah dan daftar hash blob sebelum dan sesudah restore, lalu menjalankan `check-blobs.sh` yang menghitung ulang hash setiap file di volume dan memastikan setiap blob yang dikenal database ada. File yatim dari unggahan yang batal (belum disapu worker) ikut diperiksa hash-nya, tetapi tidak dianggap gagal.
- Backup tetap jalan bila ada unggahan atau GC saat `tar` membaca volume: blob tidak pernah diubah di tempat, jadi status 1 dari `tar` (file muncul, berubah, atau hilang di tengah) diterima; status 2 ke atas menggagalkan backup.
- Ekstraksi teks PDF dan DOCX berjalan di proses anak dengan batas heap 512 MB dan timeout 60 detik. Memori native proses itu tidak dibatasi oleh flag heap. Bila perlu batas keras, beri container `worker` `mem_limit` di `docker/compose.yml` (opsional, spec 13.5). Risiko ini belum ditutup.
- Ekstraksi memerlukan hasil build worker (`pnpm --filter @archlin/worker build`) karena proses anaknya adalah `dist/extract-child.mjs`; image `worker` sudah memuatnya.

## Keamanan dan privasi

- Isi catatan, kueri pencarian, dan embedding tidak keluar dari server; tidak ada telemetri dan tidak ada CDN. Log tidak mencatat isi catatan.
- Sesi memakai cookie `__Host-archlin_session`, CSP tetap tanpa `unsafe-eval`, dan CSRF diperiksa untuk setiap server function.
- Aplikasi berjalan sebagai role `cortex_app` (tanpa DDL) dengan RLS aktif. Migrasi memakai `cortex_migrator`, backup memakai `cortex_backup`.
- Jangan memasang proxy pihak ketiga yang mengakhiri TLS di depan aplikasi: itu bertentangan dengan keputusan D20 di spec.
- File `.env`, `.env.migrate`, dan kunci privat backup tidak pernah masuk Git. Hook pre-commit dan `gitleaks git --redact --config .gitleaks.toml` memindai secret; kredensial lokal yang sengaja ada di repo (database sekali pakai di `127.0.0.1`) dikecualikan di `.gitleaks.toml`.

## Status M0

Selesai: workspace dan batas modul, skema identitas dengan RLS, autentikasi (password, TOTP, kode cadangan, sesi), UI inti (setup, login, Hari ini, Profil & keamanan), outbox dan worker pg-boss, image container dan stack lokal, backup terenkripsi dengan restore terverifikasi.

Ditunda ke tahap deploy: akses lewat Tailscale, Caddy dan HTTPS, firewall egress untuk host. Inbox, pencarian, dan modul Knowledge Base datang di milestone berikutnya.
