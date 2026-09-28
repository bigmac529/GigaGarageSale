// Local development: run the API in database mode against the SQLite catalog
// (api/data/catalog.sqlite unless GGS_SQLITE_PATH is set). Create it first with
// `npm run dev:db`. Equivalent to setting GGS_DB_ENABLED=true and GGS_DB_PROVIDER=sqlite.
process.env.GGS_DB_ENABLED = 'true';
process.env.GGS_DB_PROVIDER = 'sqlite';
require('../src/index');
