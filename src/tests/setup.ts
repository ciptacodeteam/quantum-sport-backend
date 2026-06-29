// Minimal env for unit tests (no real DB or secrets required).
process.env.DATABASE_URL ??=
  'postgresql://ci:ci@localhost:5432/ci?schema=public'
process.env.JWT_SECRET ??= 'test-jwt-secret-minimum-32-characters-long'
process.env.JWT_REFRESH_SECRET ??=
  'test-jwt-refresh-secret-minimum-32-chars'
