-- GigaGarageSale catalog schema for SQL Server (2025 Express on the server).
-- Idempotent: every object is created only if it is missing, and nothing is dropped,
-- so it is safe to run again after every deploy.
--
-- The seed script (npm run db:seed in api/) runs this file itself before loading data.
-- To apply it by hand with the writer login (needs db_ddladmin), from the repo or deploy folder:
--   sqlcmd -S 127.0.0.1,1433 -U ggs_app -d GigaGarageSale -C -b -i db\schema.sql
-- (sqlcmd prompts for the password when -P is omitted; -C trusts the self-signed certificate.)
--
-- The running API only ever SELECTs from these tables (see docs/DATABASE.md). Its login
-- (ggs_reader, db/reader-login.sql) is db_datareader with INSERT/UPDATE/DELETE/ALTER/EXECUTE denied.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- One row per product. Column names map 1:1 to the IProduct JSON (shared/i-product.ts).
IF OBJECT_ID(N'dbo.Products', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Products (
        Id         int            NOT NULL CONSTRAINT PK_Products PRIMARY KEY,
        Name       nvarchar(400)  NOT NULL,
        Title      nvarchar(200)  NOT NULL,
        Brand      nvarchar(100)  NOT NULL,
        Price      decimal(10, 2) NOT NULL CONSTRAINT CK_Products_Price CHECK (Price >= 0),
        ImageUrl   nvarchar(400)  NOT NULL,
        Category   nvarchar(100)  NOT NULL,
        Rating     decimal(3, 2)  NOT NULL CONSTRAINT CK_Products_Rating CHECK (Rating BETWEEN 0 AND 5),
        Merchant   nvarchar(100)  NOT NULL,
        Available  int            NOT NULL CONSTRAINT CK_Products_Available CHECK (Available >= 0)
    );
END;
GO

-- The product's "descriptions" array, one row per bullet, in order.
IF OBJECT_ID(N'dbo.ProductDescriptions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProductDescriptions (
        ProductId  int            NOT NULL,
        Ordinal    int            NOT NULL,
        Text       nvarchar(1000) NOT NULL,
        CONSTRAINT PK_ProductDescriptions PRIMARY KEY (ProductId, Ordinal),
        CONSTRAINT FK_ProductDescriptions_Products FOREIGN KEY (ProductId)
            REFERENCES dbo.Products (Id) ON DELETE CASCADE
    );
END;
GO

-- Image files served at /images/<Name> (e.g. Name = '12.jpg' for imageUrl '/images/12.jpg').
-- Sha256 is the hex digest of Content and doubles as the HTTP ETag.
IF OBJECT_ID(N'dbo.Images', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Images (
        Name         nvarchar(260)  NOT NULL CONSTRAINT PK_Images PRIMARY KEY,
        ContentType  varchar(100)   NOT NULL,
        ByteLength   int            NOT NULL,
        Sha256       char(64)       NOT NULL,
        Content      varbinary(max) NOT NULL,
        UpdatedUtc   datetime2(0)   NOT NULL
    );
END;
GO

-- Single row (Id = 1) describing the last seed. Version is a hash of the whole catalog;
-- the API reloads its in-memory copy when it changes.
IF OBJECT_ID(N'dbo.CatalogInfo', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CatalogInfo (
        Id            tinyint       NOT NULL CONSTRAINT PK_CatalogInfo PRIMARY KEY
                                             CONSTRAINT CK_CatalogInfo_SingleRow CHECK (Id = 1),
        Version       char(64)      NOT NULL,
        ProductCount  int           NOT NULL,
        ImageCount    int           NOT NULL,
        SeededUtc     datetime2(0)  NOT NULL,
        SeededBy      nvarchar(128) NOT NULL
    );
END;
GO
