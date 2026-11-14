// Server body cap for page saves (spec 13.4 K4); apps/web/src/server/limits.ts must equal it.
export const PAGE_SAVE_MAX_BYTES = 5_242_880;

// Leaves room for the server function envelope so the client refuses before the server has to.
export const PAGE_SAVE_CLIENT_MAX_BYTES = 5_000_000;
