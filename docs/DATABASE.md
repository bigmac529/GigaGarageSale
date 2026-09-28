# Catalog database

The product catalog (everything in `api/src/products.json`) and the product images
(`api/public/images/<name>`) can be served from a database instead of the files:

- **Production:** SQL Server 2025 Express on the web server (default instance, TCP `127.0.0.1:1433`, SQL authentication).
- **Local development and tests:** SQLite, on any OS.

The API only ever **reads** the database. Loading data into it is a separate admin step (`npm run db:seed`).

Database mode is **off until `GGS_DB_ENABLED=true`** is set on the service. Until then the app
serves `products.json` and `api/public/images` exactly as before. That way a deploy can't break
the site before the database is seeded, and switching over is a deliberate step.

## How it works

```
                      admin, by hand (writer login ggs_app)
products.json ─┐      npm run db:seed ──────────────────────┐
images/*.jpg  ─┴──────────────────────────────────────────► SQL Server: GigaGarageSale
                                                             Products, ProductDescriptions,
                                                             Images (varbinary), CatalogInfo
                                                                  │  SELECT only
                                                                  ▼  (reader login ggs_reader)
browser ──► IIS/ARR ──► Node API (GigaGarageSaleNode, localhost:3106)
                          in-memory catalog snapshot ──► /api/products, /facets, /:id
                          image LRU cache (64 MB)    ──► /images/<name>
```

- At startup the API reads the whole catalog (about 1,100 products) into memory. Search, filters,
  sorting and paging run on that snapshot with the same code as JSON mode
  (`api/src/product-query.ts`), so every response is byte-for-byte the same as in JSON mode.
  The tests check this.
- `/images/<name>` is served from the `Images` table with the stored `Content-Type`, a strong
  `ETag` (the SHA-256 of the bytes), `Last-Modified`, and `Cache-Control: public, max-age=604800`
  (7 days). A revalidation (`If-None-Match`) is answered with 304 from memory, without touching
  the database. Image bytes are cached in memory (LRU, 64 MB; the whole seed set is about 20 MB).
  Unknown names return 404. In database mode the files still on disk are **never** served.
  Image URLs are unchanged (`/images/12.jpg`), so the UI needs no change.
- `POST /api/products/reset` (sent by the UI on every page load and by the footer's
  "reset inventory") reads the single `CatalogInfo` row and reloads the snapshot only if the
  catalog version changed. That is how a new seed goes live without a restart. The server keeps
  no stock or cart state: the cart and the `available` counters live in the browser, so there is
  nothing on the server to "reset", and nothing is ever written.
- `GET /api/health` answers **503** (`ok: false`, with `db.problems`) if the database can't be
  reached, has not been seeded, the catalog isn't loaded, or **the login can write**. While the
  database is unreachable the API keeps serving the last snapshot it loaded (and retries the
  first load every 15 s if it never got one). The deploy's health check therefore rolls back a
  deploy that can't read the database.

### Read-only guarantee

The owner's rule is that the backend must not be able to change database data. It is enforced
in several independent layers:

1. **Code.** The API's only database interface (`CatalogReader`, `api/src/catalog/reader.ts`)
   has read methods only, and every statement it runs is a fixed `SELECT`. No route inserts,
   updates or deletes anything. All writing code (schema + seed) lives in `api/scripts/`, which
   the API never imports.
2. **Connection.** SQLite is opened with `readonly: true` (`SQLITE_OPEN_READONLY`) plus
   `PRAGMA query_only = ON`.
3. **Login.** On SQL Server the service uses `ggs_reader`: `db_datareader` only, with an explicit
   `DENY INSERT, UPDATE, DELETE, ALTER, EXECUTE` on the database (`db/reader-login.sql`).
4. **Health.** The API checks its own effective permissions (`HAS_PERMS_BY_NAME` on the database
   and every catalog table) and reports 503 if the login could write. Configuring the service
   with `ggs_app` by mistake fails the health check (and a deploy) instead of going unnoticed.
5. **Tests** (`api/src/catalog/db-mode.test.ts`, `sqlserver.test.ts`):
   - send `POST`/`PUT`/`PATCH`/`DELETE` with assorted bodies to every route and more, then check
     that the database is byte-for-byte unchanged
   - check that the app's only non-GET route is `POST /api/products/reset`, so any new write
     route has to be reviewed
   - record every SQL statement the API runs and check that each one is a `SELECT`
   - scan `api/src` for write SQL and for imports of the seed tooling
   - check that the read-only connection rejects `INSERT`/`UPDATE`/`DELETE`/`CREATE`/`DROP`
   - check that `ggs_reader` is denied every kind of write on a real SQL Server 2025 Express

## Configuration (environment variables)

The service already has the `GGS_DB_*` connection variables in its WinSW XML
(`C:\Tools\WinSW\GigaGarageSaleNode.xml`, outside the repo). Never commit passwords.

| Variable | Default | Notes |
|---|---|---|
| `GGS_DB_ENABLED` | *(unset = off)* | `true` switches the API to database mode. Anything else keeps JSON mode. |
| `GGS_DB_PROVIDER` | `sqlserver` | `sqlserver` or `sqlite` (local dev). |
| `GGS_DB_SERVER` | `localhost` | Resolved once, IPv4 first (SQL Server listens on `127.0.0.1` only; on Windows a refused `::1` attempt would cost ~2 s per new connection). Other addresses are tried if IPv4 fails. |
| `GGS_DB_PORT` | `1433` | |
| `GGS_DB_NAME` | `GigaGarageSale` | |
| `GGS_DB_USER` / `GGS_DB_PASSWORD` | *(required in sqlserver mode)* | The **read-only** login, `ggs_reader`. |
| `GGS_DB_ENCRYPT` | `true` | TLS to SQL Server. |
| `GGS_DB_TRUST_CERT` | `false` | `true` accepts SQL Server's self-signed certificate (set on the server; the connection never leaves the machine). |
| `GGS_SQLITE_PATH` | `api/data/catalog.sqlite` | SQLite mode only. `api/data/` is git-ignored. |
| `GGS_SEED_*` | falls back to `GGS_DB_*` | Seed script only: `GGS_SEED_SERVER`, `_PORT`, `_NAME`, `_USER`, `_PASSWORD`, `_ENCRYPT`, `_TRUST_CERT`, `_PROVIDER`, `_SQLITE_PATH`. Lets an admin seed with `ggs_app` while the service keeps `ggs_reader`. |
| `PRODUCTS_FILE` | `api/src/products.json` | JSON mode (and seed input), unchanged. |

If `GGS_DB_ENABLED=true` but the settings are incomplete or invalid (for example no
`GGS_DB_PASSWORD`, or `GGS_DB_PORT=abc`), the API logs `Catalog configuration error: ...` and
exits instead of falling back silently. WinSW restarts it, and a deploy rolls back.

The startup log always says which source is in use, for example:

```
Catalog source: SQL Server localhost:1433, database GigaGarageSale, login ggs_reader, encrypt=true, trustServerCertificate=true (GGS_DB_ENABLED=true, GGS_DB_PROVIDER=sqlserver)
Catalog loaded from sqlserver: 1089 products, 1089 images, version 18731f5f4a51 (seeded 2026-09-28T03:56:34.000Z)
```

or, while database mode is off:

```
Catalog source: JSON file C:\WebApps\GigaGarageSale\api\src\products.json + images from ... (GGS_DB_ENABLED is not "true")
```

## Local development (SQLite, any OS)

```bash
cd api
npm install
npm run dev:db        # creates/updates api/data/catalog.sqlite from products.json + public/images
npm run start:sqlite  # the API on :3106 in database mode (GGS_DB_ENABLED=true, GGS_DB_PROVIDER=sqlite)
```

`npm start` still runs JSON mode. The UI (`cd ui && npm start`) works the same with either.
`better-sqlite3` is an *optional* dependency (a native module with prebuilt binaries for Node 20,
22 and 24 on Windows, Linux and macOS). If it can't be installed, only SQLite mode is unavailable.
Production doesn't need it.

Tests: `npm test` in `api/`. It includes the SQLite database-mode tests. To also run the
SQL Server tests, point them at a SQL Server that has a writer and a reader login (see the top
of `api/src/catalog/sqlserver.test.ts`):

```bash
GGS_TEST_SQLSERVER_WRITER_USER=ggs_app GGS_TEST_SQLSERVER_WRITER_PASSWORD=... \
GGS_TEST_SQLSERVER_READER_USER=ggs_reader GGS_TEST_SQLSERVER_READER_PASSWORD=... npm test
```

## Server setup (admin, one time)

What exists already: SQL Server 2025 Express (default instance, mixed auth, TCP on
`127.0.0.1:1433` only), the `GigaGarageSale` database, the login `ggs_app` (db_datareader,
db_datawriter, db_ddladmin), and the `GGS_DB_*` variables in the service's WinSW XML.
`GGS_DB_ENABLED` is not set, so the site is still in JSON mode.

Do this after the deploy that contains this change (`C:\WebApps\GigaGarageSale\DEPLOYED_COMMIT`
shows the live commit, and `C:\WebApps\GigaGarageSale\api\scripts\db-seed.ts` exists). Use an
**elevated PowerShell** on the server.

### 1. Create the tables and load the catalog (as `ggs_app`)

```powershell
cd C:\WebApps\GigaGarageSale\api
$env:GGS_SEED_SERVER     = "localhost"
$env:GGS_SEED_PORT       = "1433"
$env:GGS_SEED_NAME       = "GigaGarageSale"
$env:GGS_SEED_USER       = "ggs_app"
$env:GGS_SEED_ENCRYPT    = "true"
$env:GGS_SEED_TRUST_CERT = "true"
& "C:\Program Files\nodejs\npm.cmd" run db:seed     # prompts for the ggs_app password (not echoed)
```

This runs `db\schema.sql` (creates only the missing tables, never drops anything) and loads
`api\src\products.json` and `api\public\images\*` in one transaction. Expected output:

```
Seed input: 1089 products from C:\WebApps\GigaGarageSale\api\src\products.json
            1089 images (19.5 MB) from C:\WebApps\GigaGarageSale\api\public\images
            catalog version 18731f5f4a51...
Target: SQL Server localhost:1433, database GigaGarageSale, login ggs_app
Schema: up to date (missing tables created).
Data: loaded 1089 products and 5584 description lines; images 1089 added, 0 updated, 0 removed, 0 unchanged.
Database now has 1089 products, 5584 description lines, 1089 images.
```

Running it again is safe. It prints `already at version ...; nothing to do`.
If you'd rather apply the schema with sqlcmd first (optional; the seed does it anyway):
`sqlcmd -S tcp:127.0.0.1,1433 -U ggs_app -d GigaGarageSale -C -b -i C:\WebApps\GigaGarageSale\db\schema.sql`.

### 2. Create the read-only login `ggs_reader` (as a sysadmin)

```powershell
cd C:\WebApps\GigaGarageSale
$env:ReaderPassword = Read-Host "New password for ggs_reader"
sqlcmd -S tcp:127.0.0.1,1433 -E -C -b -i db\reader-login.sql
# (if your Windows account is not a SQL sysadmin: sqlcmd -S tcp:127.0.0.1,1433 -U sa -C -b -i db\reader-login.sql)
Remove-Item Env:\ReaderPassword
```

Rules for the password: satisfy the Windows password policy, contain no single quote (`'`), and
preferably no `&`, `<`, `>` or `"`, which would need escaping in the WinSW XML.
The script creates the login and user `ggs_reader`, adds it to `db_datareader` only, and applies
`DENY INSERT, UPDATE, DELETE, ALTER, EXECUTE`. It ends with a verification row, which must read:

```
DatabaseUser CanSelect CanInsert CanUpdate CanDelete CanAlter CanExecute CanCreateTable
ggs_reader   1         0         0         0         0        0          0
```

Re-running the script resets the password and re-applies the grants and denies. It refuses to
run without `ReaderPassword`.

### 3. Point the service at `ggs_reader` and enable database mode

Edit `C:\Tools\WinSW\GigaGarageSaleNode.xml` (next to `GigaGarageSaleNode.exe`). Keep the
existing `GGS_DB_SERVER`, `GGS_DB_PORT`, `GGS_DB_NAME`, `GGS_DB_ENCRYPT` and `GGS_DB_TRUST_CERT`
lines. Change the user and password, and add `GGS_DB_ENABLED`:

```xml
  <env name="GGS_DB_USER" value="ggs_reader"/>
  <env name="GGS_DB_PASSWORD" value="THE-GGS_READER-PASSWORD"/>
  <env name="GGS_DB_ENABLED" value="true"/>
```

The file holds a password. Make sure only Administrators and SYSTEM can read it
(`icacls C:\Tools\WinSW\GigaGarageSaleNode.xml` to check). The deploy runner account doesn't need
access to it.

```powershell
Restart-Service GigaGarageSaleNode
```

### 4. Verify

```powershell
try { (Invoke-WebRequest http://localhost:3106/api/health -UseBasicParsing).Content }
catch { $_.ErrorDetails.Message }   # a 503 lands here, with the reason in db.problems
```

Expect HTTP 200 and:

```json
{"ok":true, ..., "catalog":{"source":"sqlserver","loaded":true,"products":1089,"images":1089, ...},
 "db":{"enabled":true,"provider":"sqlserver","connected":true,"readOnly":true,"login":"ggs_reader (user ggs_reader)"}}
```

Then check an image and the public site:

```powershell
$r = Invoke-WebRequest http://localhost:3106/images/12.jpg -UseBasicParsing
$r.StatusCode; $r.Headers["Content-Type"]; $r.Headers["Cache-Control"]; $r.Headers["ETag"]   # 200, image/jpeg, public, max-age=604800, "<sha256>"
Get-Content C:\WebApps\GigaGarageSale\logs\GigaGarageSaleNode.out.log -Tail 20           # "Catalog loaded from sqlserver: 1089 products ..."
```

and open https://gigagaragesale.socha3.com/.

**To back out:** set `GGS_DB_ENABLED` to `false` (or remove the line) and
`Restart-Service GigaGarageSaleNode`. The API goes back to `products.json` + `api\public\images`,
which every deploy still ships.

`ggs_app` is only needed for seeding. Keep its password out of the service configuration.

## Updating the catalog later

1. Change `api/src/products.json` and/or the files in `api/public/images/` in a pull request and
   merge it. The deploy ships them to the server. They stay in the repo as the **seed input** and
   as the JSON-mode fallback. The deploy does **not** touch the database.
2. On the server, re-run step 1 (`npm run db:seed` as `ggs_app`). It replaces the products in one
   transaction, and only adds, updates or removes the images whose SHA-256 changed.
3. The running API switches to the new version on the next `POST /api/products/reset` (the UI
   sends one on every page load) or on a service restart. No restart is needed. `/api/health`
   shows `catalog.version`. `npm run db:seed -- --dry-run` prints the version the files would
   produce, without touching the database.

Browsers may keep showing a changed image for up to 7 days (`max-age`), because image URLs are
not versioned. Give a changed image a new file name (and `imageUrl`) if it must show up at once.

## Reference

### Tables (`db/schema.sql`; SQLite: `db/schema.sqlite.sql`)

| Table | Contents |
|---|---|
| `Products` | One row per product; columns map 1:1 to `IProduct` (`Price decimal(10,2)`, `Rating decimal(3,2)`). |
| `ProductDescriptions` | `ProductId`, `Ordinal`, `Text`: the `descriptions` array in order. |
| `Images` | `Name` (e.g. `12.jpg`, served at `/images/12.jpg`), `ContentType`, `ByteLength`, `Sha256` (= ETag), `Content varbinary(max)` (BLOB in SQLite), `UpdatedUtc`. |
| `CatalogInfo` | Single row: `Version` (SHA-256 of all products and images), counts, `SeededUtc`, `SeededBy`. |

SQL Server 2025 Express caps each database at 50 GB. The images use about 20 MB.

### `npm run db:seed -- [options]`

| Option | |
|---|---|
| `--provider sqlserver\|sqlite` | Default `GGS_SEED_PROVIDER`, then `GGS_DB_PROVIDER`, then `sqlserver`. |
| `--sqlite-path <file>` | Default `GGS_SEED_SQLITE_PATH`, then `GGS_SQLITE_PATH`, then `api/data/catalog.sqlite`. |
| `--products <file>` / `--images <dir>` | Seed input (default `api/src/products.json`, `api/public/images`). |
| `--schema-only` | Create missing tables, load nothing. |
| `--force` | Reload even if the version is unchanged. |
| `--dry-run` | Validate the input and print the version; no database access. |

The password comes from `GGS_SEED_PASSWORD` (or `GGS_DB_PASSWORD`). If neither is set and the
terminal is interactive, the script prompts for it. It is never accepted as a command-line
argument.

### Driver choice

SQL Server is reached with [`mssql`](https://www.npmjs.com/package/mssql) over
[`tedious`](https://www.npmjs.com/package/tedious): pure JavaScript, with SQL authentication and
TLS. No native module, ODBC driver or build tools are needed on the server or in CI, so
`npm ci` behaves the same on the Ubuntu build job and the Windows runner. (Windows integrated
auth would have needed the native `msnodesqlv8` + ODBC driver. It's not needed with the SQL
logins the server uses.) SQLite uses `better-sqlite3` 12.9.0, pinned because it's the newest
release with prebuilt binaries for Node 20 (CI) as well as Node 24 (the server). It's an optional
dependency, so a failed native install never breaks `npm ci`.
