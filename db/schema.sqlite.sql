-- GigaGarageSale catalog schema for SQLite (local development and tests only).
-- Same tables and columns as db/schema.sql (SQL Server). Idempotent.
-- Applied by the seed script: cd api && npm run db:seed -- --provider sqlite

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS Products (
    Id         INTEGER NOT NULL PRIMARY KEY,
    Name       TEXT    NOT NULL,
    Title      TEXT    NOT NULL,
    Brand      TEXT    NOT NULL,
    Price      REAL    NOT NULL CHECK (Price >= 0),
    ImageUrl   TEXT    NOT NULL,
    Category   TEXT    NOT NULL,
    Rating     REAL    NOT NULL CHECK (Rating BETWEEN 0 AND 5),
    Merchant   TEXT    NOT NULL,
    Available  INTEGER NOT NULL CHECK (Available >= 0)
);

CREATE TABLE IF NOT EXISTS ProductDescriptions (
    ProductId  INTEGER NOT NULL REFERENCES Products (Id) ON DELETE CASCADE,
    Ordinal    INTEGER NOT NULL,
    Text       TEXT    NOT NULL,
    PRIMARY KEY (ProductId, Ordinal)
);

CREATE TABLE IF NOT EXISTS Images (
    Name         TEXT    NOT NULL PRIMARY KEY,
    ContentType  TEXT    NOT NULL,
    ByteLength   INTEGER NOT NULL,
    Sha256       TEXT    NOT NULL,
    Content      BLOB    NOT NULL,
    UpdatedUtc   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS CatalogInfo (
    Id            INTEGER NOT NULL PRIMARY KEY CHECK (Id = 1),
    Version       TEXT    NOT NULL,
    ProductCount  INTEGER NOT NULL,
    ImageCount    INTEGER NOT NULL,
    SeededUtc     TEXT    NOT NULL,
    SeededBy      TEXT    NOT NULL
);
