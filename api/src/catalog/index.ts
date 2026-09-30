import { Catalog, DbCatalog, DbCatalogOptions, JsonCatalog } from './catalog';
import { CatalogConfig } from './config';
import { SqliteCatalogReader } from './sqlite-reader';
import { SqlServerCatalogReader } from './sqlserver-reader';

export * from './catalog';
export * from './config';

/** Builds the catalog the configuration asks for. Only read-only readers exist. */
export function createCatalog(config: CatalogConfig, options?: DbCatalogOptions): Catalog {
  switch (config.source) {
    case 'json':
      return new JsonCatalog(config);
    case 'sqlite':
      return new DbCatalog(new SqliteCatalogReader(config.sqlitePath), options);
    case 'sqlserver':
      return new DbCatalog(new SqlServerCatalogReader(config.sqlServer), options);
  }
}
