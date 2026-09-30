/**
 * Creates / upgrades the catalog schema and loads products.json + images into the database.
 *
 * ADMIN TOOL. Run it by hand with a login that may write (ggs_app); the running API never
 * runs it and never writes to the database. Safe to re-run: the schema script only creates
 * what is missing, and the data is replaced in one transaction only when it changed.
 *
 *   npm run db:seed                              # SQL Server (GGS_SEED_* / GGS_DB_* settings)
 *   npm run db:seed -- --provider sqlite         # local dev: api/data/catalog.sqlite
 *   npm run db:seed -- --help
 *
 * See docs/DATABASE.md.
 */
import path from 'path';
import readline from 'readline';
import { Writable } from 'stream';
import {
  ConfigError, DEFAULT_IMAGES_DIR, DEFAULT_PRODUCTS_FILE, DEFAULT_SQLITE_PATH,
  SqlServerSettings, parseProvider, readSqlServerSettings
} from '../src/catalog/config';
import { loadSeedData } from './seed/seed-data';
import { CatalogWriter, SqlServerCatalogWriter, SqliteCatalogWriter } from './seed/writers';

const HELP = `Usage: npm run db:seed -- [options]

Creates the catalog tables if needed (db/schema.sql or db/schema.sqlite.sql) and loads
products.json and the image files into the database. Re-running it is safe.

Options:
  --provider <sqlserver|sqlite>  Default: GGS_SEED_PROVIDER, then GGS_DB_PROVIDER, then sqlserver.
  --sqlite-path <file>           SQLite file. Default: GGS_SEED_SQLITE_PATH, then GGS_SQLITE_PATH,
                                 then api/data/catalog.sqlite.
  --products <file>              Default: api/src/products.json
  --images <dir>                 Default: api/public/images
  --schema-only                  Create/upgrade the tables, load no data.
  --force                        Reload the data even if the catalog version is unchanged.
  --dry-run                      Validate the seed files and print a summary; no database access.
  --help                         Show this help.

SQL Server connection (writer login, e.g. ggs_app). Each GGS_SEED_* variable falls back to
the matching GGS_DB_* variable, so an admin can use ggs_app while the service keeps ggs_reader:
  GGS_SEED_SERVER (localhost)   GGS_SEED_PORT (1433)       GGS_SEED_NAME (GigaGarageSale)
  GGS_SEED_USER                 GGS_SEED_PASSWORD          GGS_SEED_ENCRYPT (true)
  GGS_SEED_TRUST_CERT (false)
If no password is set and the terminal is interactive, you are prompted for it (not echoed).
`;

interface Args {
  provider?: string;
  sqlitePath?: string;
  products?: string;
  images?: string;
  schemaOnly: boolean;
  force: boolean;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { schemaOnly: false, force: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new ConfigError(`${a} needs a value.`);
      return v;
    };
    switch (a) {
      case '--provider': args.provider = next(); break;
      case '--sqlite-path': args.sqlitePath = next(); break;
      case '--products': args.products = next(); break;
      case '--images': args.images = next(); break;
      case '--schema-only': args.schemaOnly = true; break;
      case '--force': args.force = true; break;
      case '--dry-run': args.dryRun = true; break;
      case '--help': case '-h': case '/?': args.help = true; break;
      default: throw new ConfigError(`Unknown option ${a}. See --help.`);
    }
  }
  return args;
}

/** Reads a line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  return new Promise(resolve => {
    let muted = false;
    const output = new Writable({
      write(chunk, _enc, cb) {
        if (!muted) process.stdout.write(chunk);
        cb();
      }
    });
    const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
    rl.question(question, answer => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function sqlServerSettings(): Promise<SqlServerSettings> {
  const env = { ...process.env };
  const user = env['GGS_SEED_USER'] || env['GGS_DB_USER'];
  if (!env['GGS_SEED_PASSWORD'] && !env['GGS_DB_PASSWORD'] && user && process.stdin.isTTY) {
    env['GGS_SEED_PASSWORD'] = await promptHidden(`Password for SQL login ${user}: `);
  }
  return readSqlServerSettings(env, 'GGS_SEED_', 'GGS_DB_');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  const productsFile = path.resolve(args.products || DEFAULT_PRODUCTS_FILE);
  const imagesDir = path.resolve(args.images || DEFAULT_IMAGES_DIR);
  const provider = parseProvider('--provider / GGS_SEED_PROVIDER / GGS_DB_PROVIDER',
    args.provider || process.env['GGS_SEED_PROVIDER'] || process.env['GGS_DB_PROVIDER']);

  const data = args.schemaOnly ? null : loadSeedData(productsFile, imagesDir);
  if (data) {
    const bytes = data.images.reduce((n, i) => n + i.byteLength, 0);
    console.log(`Seed input: ${data.products.length} products from ${productsFile}`);
    console.log(`            ${data.images.length} images (${(bytes / 1048576).toFixed(1)} MB) from ${imagesDir}`);
    console.log(`            catalog version ${data.version}`);
    for (const w of data.warnings) console.warn(`WARNING: ${w}`);
  }
  if (args.dryRun) {
    console.log('Dry run: nothing written.');
    return;
  }

  let writer: CatalogWriter;
  if (provider === 'sqlite') {
    const file = path.resolve(args.sqlitePath || process.env['GGS_SEED_SQLITE_PATH'] || process.env['GGS_SQLITE_PATH'] || DEFAULT_SQLITE_PATH);
    writer = new SqliteCatalogWriter(file);
  } else {
    writer = new SqlServerCatalogWriter(await sqlServerSettings());
  }
  console.log(`Target: ${writer.description}`);
  try {
    await writer.applySchema();
    console.log('Schema: up to date (missing tables created).');
    if (!data) {
      return;
    }
    const r = await writer.replaceCatalog(data, args.force);
    if (!r.changed) {
      console.log(`Data: already at version ${r.version.slice(0, 12)}; nothing to do (use --force to reload anyway).`);
    } else {
      console.log(`Data: loaded ${r.products} products and ${r.descriptions} description lines; images ` +
        `${r.imagesInserted} added, ${r.imagesUpdated} updated, ${r.imagesDeleted} removed, ${r.imagesUnchanged} unchanged.`);
      console.log(`      version ${r.previousVersion ? r.previousVersion.slice(0, 12) : '(none)'} -> ${r.version.slice(0, 12)}`);
    }
    const c = await writer.counts();
    console.log(`Database now has ${c.products} products, ${c.descriptions} description lines, ${c.images} images.`);
    if (r.changed) {
      console.log('A running API picks up the new version on the next POST /api/products/reset (every UI page load) or restart.');
    }
  } finally {
    await writer.close();
  }
}

main().catch(err => {
  console.error(`db:seed failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
