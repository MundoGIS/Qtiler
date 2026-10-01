# Database Gateway Setup

Run the relevant script once with a database administrator account. Do not grant `CREATE`, `ALTER`, or ownership rights to the Qtiler gateway service account after setup.

## PostgreSQL / PostGIS

```sql
CREATE TABLE public.qgis_projects (
  name text PRIMARY KEY,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT USAGE ON SCHEMA public TO qtiler_gateway;
GRANT SELECT, INSERT, UPDATE ON public.qgis_projects TO qtiler_gateway;
```

The Qtiler gateway service account must be allowed to `SET ROLE` to the PostgreSQL roles that mirror Qtiler users. Grant those roles only the required `USAGE` and `SELECT` privileges on schemas and spatial tables.

## Microsoft SQL Server

```sql
CREATE TABLE dbo.qgis_projects (
  name nvarchar(255) NOT NULL PRIMARY KEY,
  metadata nvarchar(max) NOT NULL DEFAULT N'{}',
  content varbinary(max) NOT NULL,
  created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
);

GRANT SELECT, INSERT, UPDATE ON dbo.qgis_projects TO qtiler_gateway;
```

For per-user SQL Server data restrictions, implement row-level security predicates that use `SESSION_CONTEXT(N'qtiler_username')`. Qtiler sets that value for every database gateway request.