-- Creates the READ-ONLY SQL login the running GigaGarageSale API uses: ggs_reader.
-- Run once as a sysadmin (creating logins needs ALTER ANY LOGIN, which ggs_app does not have).
-- Re-running it is safe: it resets the password and re-applies the role/deny settings.
--
-- The password is a sqlcmd scripting variable and is never stored in the repo. sqlcmd also
-- reads scripting variables from environment variables, which keeps it off the command line:
--
--   $env:ReaderPassword = Read-Host "New password for ggs_reader"
--   sqlcmd -S 127.0.0.1,1433 -E -C -b -i db\reader-login.sql      # Windows login that is sysadmin
--   # or: sqlcmd -S 127.0.0.1,1433 -U sa -C -b -i db\reader-login.sql   (prompts for the sa password)
--   Remove-Item Env:\ReaderPassword
--
-- Don't use a single quote (') in the password; it is pasted into a string literal below.
-- The password must satisfy the Windows password policy (CHECK_POLICY = ON).

:on error exit

-- Stop unless ReaderPassword was supplied (some sqlcmd versions leave an undefined variable as literal text).
IF LEN(N'$(ReaderPassword)') = 0 OR N'$(ReaderPassword)' = N'$' + N'(ReaderPassword)'
    RAISERROR(N'Set the ReaderPassword scripting variable (environment variable or sqlcmd -v) first.', 16, 1);
GO

USE [master];
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'ggs_reader')
    CREATE LOGIN [ggs_reader]
        WITH PASSWORD = N'$(ReaderPassword)',
             DEFAULT_DATABASE = [GigaGarageSale],
             CHECK_POLICY = ON,
             CHECK_EXPIRATION = OFF;
ELSE
    ALTER LOGIN [ggs_reader] WITH PASSWORD = N'$(ReaderPassword)';
GO

USE [GigaGarageSale];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'ggs_reader')
    CREATE USER [ggs_reader] FOR LOGIN [ggs_reader] WITH DEFAULT_SCHEMA = [dbo];
GO

-- Read access to every table, and nothing else.
ALTER ROLE [db_datareader] ADD MEMBER [ggs_reader];

-- In case the user was ever given more, take it away again.
IF IS_ROLEMEMBER(N'db_datawriter', N'ggs_reader') = 1 ALTER ROLE [db_datawriter] DROP MEMBER [ggs_reader];
IF IS_ROLEMEMBER(N'db_ddladmin',   N'ggs_reader') = 1 ALTER ROLE [db_ddladmin]   DROP MEMBER [ggs_reader];
IF IS_ROLEMEMBER(N'db_owner',      N'ggs_reader') = 1 ALTER ROLE [db_owner]      DROP MEMBER [ggs_reader];

-- Explicit DENY at database scope wins over any grant or role membership added later.
DENY INSERT, UPDATE, DELETE, ALTER, EXECUTE TO [ggs_reader];
GO

-- Verification: effective permissions of ggs_reader (expect CanSelect = 1 and every other column 0).
EXECUTE AS USER = N'ggs_reader';
SELECT
    USER_NAME()                                                   AS DatabaseUser,
    HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'SELECT')          AS CanSelect,
    HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'INSERT')          AS CanInsert,
    HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'UPDATE')          AS CanUpdate,
    HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'DELETE')          AS CanDelete,
    HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'ALTER')           AS CanAlter,
    HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'EXECUTE')         AS CanExecute,
    HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'CREATE TABLE')    AS CanCreateTable;
REVERT;
GO
