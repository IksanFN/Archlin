// Every user-facing string lives here (spec N10). Sentence case, no em dashes.
export const messages = {
  appName: 'Archlin',
  common: {
    loading: 'Memuat',
    retry: 'Coba lagi',
    cancel: 'Batal',
    skipToContent: 'Lewati ke konten',
  },
  nav: {
    label: 'Navigasi utama',
    today: 'Hari ini',
    settings: 'Pengaturan',
    spaces: 'Space',
    noSpaces: 'Belum ada space.',
    openNavigation: 'Buka navigasi',
    hideSidebar: 'Sembunyikan sidebar',
    showSidebar: 'Tampilkan sidebar',
  },
  account: {
    menuLabel: 'Menu akun',
    theme: 'Tema',
    themeSystem: 'Ikuti sistem',
    themeLight: 'Terang',
    themeDark: 'Gelap',
    signOut: 'Keluar',
  },
  today: {
    emptyTitle: 'Belum ada yang perlu dilihat hari ini',
    emptyBody: 'Pengingat, review, dan isi Inbox akan tampil di sini setelah fitur catatan tersedia.',
    privacyFooter: 'Semua diproses di server ini.',
    greeting: (greeting: string, name: string) => `${greeting}, ${name}.`,
  },
  errors: {
    pageTitle: 'Halaman ini gagal dimuat',
    pageBody: (requestId: string | null) =>
      requestId === null
        ? 'Coba muat ulang. Jika masih gagal, periksa log server.'
        : `Coba muat ulang. Jika masih gagal, catat ID ini: ${requestId}.`,
    reload: 'Muat ulang',
    notFoundTitle: 'Halaman tidak ditemukan',
    notFoundBody: 'Alamat ini tidak ada di Archlin.',
    backToToday: 'Ke Hari ini',
    tooManyAttempts: (minutes: number) => `Terlalu banyak percobaan. Coba lagi dalam ${minutes} menit.`,
    internal: (requestId: string | null) => (requestId === null ? 'Terjadi kesalahan.' : `Terjadi kesalahan (ID: ${requestId})`),
    offline: 'Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.',
  },
} as const;
