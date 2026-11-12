# Archlin Cortex

Platform pribadi self-hosted untuk satu pengguna: inti platform (akun, sesi, verifikasi dua langkah, outbox, worker) dan, di milestone berikutnya, modul Knowledge Base sebagai pengganti Docmost. Semua data tinggal di server sendiri: tanpa telemetri, tanpa CDN, tanpa API AI di cloud.

## Prasyarat (Windows)

- Node 24 (`.node-version`) dan pnpm 12.18.0 (`npm install -g pnpm@12.18.0`)
- Docker Desktop yang sedang berjalan (database dev, test integrasi, E2E, stack lokal)
- Git Bash untuk skrip `docker/*.sh`
- Opsional: `gitleaks` (`winget install Gitleaks.Gitleaks`). Tanpa itu, hook pre-commit memakai image `ghcr.io/gitleaks/gitleaks` lewat Docker.

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
| `pnpm test:unit` | Test unit, tanpa Docker |
| `pnpm test:int` | Test integrasi dengan Testcontainers (`pgvector/pgvector:pg17`), butuh Docker |
| `pnpm test:e2e` | Build web dan migrate, buat ulang database `cortex_e2e`, jalankan Playwright (chromium, firefox, mobile) di port 3100. Pertama kali: `pnpm --filter @archlin/web exec playwright install chromium firefox` |
| `pnpm db:up` / `pnpm db:down` | Postgres dev |
| `pnpm stack:up` / `stack:down` / `stack:logs` | Stack lokal (lihat di bawah) |
| `pnpm hooks:install` | Mengarahkan Git ke `.githooks` |
| `bash docker/restore.sh <backup> <identity>` | Memulihkan backup |
| `bash docker/verify-restore.sh <identity> --confirm-destroy` | Uji backup dan restore ke volume kosong |

Tidak ada workflow CI di repo ini. Pemeriksaan dijalankan lokal dengan `pnpm verify`, lalu `pnpm test:int` dan `pnpm test:e2e` sebelum merge.

## Stack lokal

```bash
node scripts/generate-env.mjs
pnpm stack:up                       # http://localhost:8080
```

Stack berisi Postgres (tanpa port yang dibuka ke host), `migrate` (sekali jalan), `web` (hanya di `127.0.0.1`), `worker` (tanpa jalur keluar), dan `backup`. Layanan `backup` menolak start sebelum `BACKUP_AGE_RECIPIENT` terisi; langkahnya ada di bagian berikut. Cek kesehatan: `curl http://localhost:8080/health` menjawab `{"db":"ok","migrations":"ok"}`.

## Backup dan restore

Backup harian jam 02:00 (`BACKUP_TZ`) disimpan 14 hari di volume `backups` sebagai `archlin-<waktu>.tar.age`: dump database, file unggahan, dan manifest dengan checksum, dienkripsi dengan kunci publik `age`. Kunci privatnya tidak pernah ada di server.

1. Buat pasangan kunci sekali saja, di luar repo:
   ```bash
   docker compose -f docker/compose.yml --env-file .env build backup
   docker compose -f docker/compose.yml --env-file .env run --rm --no-deps --entrypoint age-keygen backup > "$USERPROFILE/archlin-backup.agekey"
   ```
2. Salin baris `# public key: age1...` ke `BACKUP_AGE_RECIPIENT` di `.env`, lalu `pnpm stack:up`.
3. **Simpan kunci privat (`archlin-backup.agekey`) dan `TOTP_ENC_KEY` di luar server**, misalnya di password manager. Tanpa kunci privat backup tidak bisa dibuka. Tanpa `TOTP_ENC_KEY` rahasia TOTP di dalam backup tidak bisa dibaca, sehingga login dengan 2FA gagal setelah restore.
4. Restore: `bash docker/restore.sh <file-backup> <file-identity>`. Skrip menghentikan web, worker, dan backup, memeriksa checksum sebelum menyentuh database, memulihkan database dan file, lalu menyalakan semuanya lagi. Backup yang rusak atau dimanipulasi ditolak dan database lama tetap utuh.
5. Verifikasi berkala: `bash docker/verify-restore.sh "$USERPROFILE/archlin-backup.agekey" --confirm-destroy`. Skrip ini **menghapus** volume `archlin_pgdata` dan `archlin_files` lalu memulihkannya dari backup baru, jadi jalankan hanya di stack lokal. Setelah selesai, uji login dengan TOTP secara manual.

## Keamanan dan privasi

- Isi catatan, kueri pencarian, dan embedding tidak keluar dari server; tidak ada telemetri dan tidak ada CDN. Log tidak mencatat isi catatan.
- Sesi memakai cookie `__Host-archlin_session`, CSP tetap tanpa `unsafe-eval`, dan CSRF diperiksa untuk setiap server function.
- Aplikasi berjalan sebagai role `cortex_app` (tanpa DDL) dengan RLS aktif. Migrasi memakai `cortex_migrator`, backup memakai `cortex_backup`.
- Jangan memasang proxy pihak ketiga yang mengakhiri TLS di depan aplikasi: itu bertentangan dengan keputusan D20 di spec.
- File `.env`, `.env.migrate`, dan kunci privat backup tidak pernah masuk Git. Hook pre-commit dan `gitleaks git --redact --config .gitleaks.toml` memindai secret; kredensial lokal yang sengaja ada di repo (database sekali pakai di `127.0.0.1`) dikecualikan di `.gitleaks.toml`.

## Status M0

Selesai: workspace dan batas modul, skema identitas dengan RLS, autentikasi (password, TOTP, kode cadangan, sesi), UI inti (setup, login, Hari ini, Profil & keamanan), outbox dan worker pg-boss, image Docker dan stack lokal, backup terenkripsi dengan restore terverifikasi.

Ditunda ke tahap deploy: akses lewat Tailscale, Caddy dan HTTPS, firewall egress untuk host. Inbox, pencarian, dan modul Knowledge Base datang di milestone berikutnya.
