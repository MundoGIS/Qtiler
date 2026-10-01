# QtilerAuth

Copyright (c) 2026 MundoGIS. All rights reserved.

QtilerAuth is Qtiler's commercial authentication, authorization, and secure database-gateway plugin. It provides the identity and access-control layer used by Qtiler services, the QGIS Connector, and protected project resources.

QtilerAuth is proprietary software. Use is governed by [LICENSE_QtilerAuth.txt](LICENSE_QtilerAuth.txt). This repository copy and its documentation do not grant permission to redistribute, modify, sublicense, or remove proprietary notices from QtilerAuth.

## What QtilerAuth Does

- Manages users, roles, account status, passwords, API keys, and project access rules.
- Supports browser sessions, bearer tokens, HTTP Basic authentication, and API keys.
- Protects Qtiler WMS, WFS, WMTS, project, and portal resources.
- Adds login rate limiting, audit records, token revocation, and optional proof-of-work CAPTCHA.
- Provides a secure HTTPS database gateway for PostGIS and Microsoft SQL Server.
- Lets QGIS users browse authorized schemas and layers and open stored QGIS projects without a VPN or direct database connection.

## Security Model

Only the Qtiler server connects to PostgreSQL or SQL Server. Database ports must remain private and must not be exposed to QGIS clients or the public internet.

The QGIS Connector communicates only with Qtiler's HTTPS endpoint. Its API key is kept by the QGIS Authentication Manager and is sent as HTTP Basic authentication over TLS. The key is not stored in plugin settings and is not placed in service URLs.

Every database-gateway request follows this sequence:

1. QtilerAuth validates the API key and applies API-key rate limiting.
2. QtilerAuth verifies that the user has `database:read` or `database:read:<connection-id>`.
3. Qtiler selects the default configured database connection and decrypts its service-account password in memory.
4. Qtiler queries the private database and returns only the requested catalog, project, or GeoJSON resource through HTTPS.
5. Database errors are logged on the server; implementation details are not returned to remote clients.

Users never receive the database host, port, service-account password, or a direct PostgreSQL/SQL Server connection string.

## Database Connection Logic

Administrators configure one or more database gateway connections in **QtilerAuth Administration > Database gateway connections**. Each connection has a name, engine, host, port, database name, service account, and encrypted password. Mark one connection as the default gateway connection. A QtilerAuth user automatically receives that connection when its username matches the configured database username. Shared gateway connections require global `database:read` access or connection-specific `database:read:<connection-id>` access; the QGIS Connector lists only authorized connections.

Before saving a connection, set `QTILER_DATABASE_CREDENTIALS_KEY`. It must be either a 64-character hexadecimal key or a base64 encoding of 32 bytes. QtilerAuth uses AES-256-GCM to encrypt database service-account passwords in its SQLite database. Existing legacy connections must be opened and saved again after this variable is configured.

### PostGIS

For PostGIS, Qtiler connects as the configured gateway service account and executes `SET LOCAL ROLE` using the authenticated Qtiler username. PostgreSQL privileges therefore remain the authoritative data-level restriction. Create matching PostgreSQL roles and grant only the required schema and table permissions. The gateway service account must be allowed to switch to those roles.

When Qtiler and PostgreSQL run on the same server, use `127.0.0.1` or `localhost` as the database host. QGIS clients still connect only to Qtiler's public HTTPS DNS name. If a connection is configured directly with database user `rk-opendata`, the QtilerAuth user must also be named `rk-opendata`; that name match authorizes discovery of the connection, and inherited PostgreSQL memberships such as `RK-USERS` determine which schemas and tables are readable.

### Microsoft SQL Server

For SQL Server, Qtiler connects as the configured gateway service account and sets `SESSION_CONTEXT(N'qtiler_username')` for each request. Implement SQL Server Row-Level Security predicates using this context value when different users require different row or layer visibility. The service account should have only the permissions required by the gateway.

### Project Storage

QGIS project files are stored in the database table `qgis_projects`. Tables are deliberately not created at runtime: production gateway accounts should not require DDL permissions. Run the least-privilege setup SQL in [the QGIS Connector database guide](../../public/QGIS-plugins/qtiler_connector/DATABASE_SETUP.md) once with a database administrator account.

The gateway exposes only spatial-layer catalog data and bounded GeoJSON feature responses. GeoJSON requests support `limit` and `offset`; the server bounds a request to a maximum of 10,000 features.

## QGIS Connector

The reusable QGIS client plugin is located at:

`public/QGIS-plugins/qtiler_connector`

It is distributed separately under GPL-2.0-or-later so that it can be published through the QGIS plugin ecosystem. GPL permits reuse and redistribution under its terms; copyright ownership remains with MundoGIS, but a GPL plugin cannot be made non-copyable. QtilerAuth remains proprietary and is not covered by the connector's GPL license.

### Install on Windows

Build the distributable ZIP from the Qtiler root:

```powershell
npm run build:qtiler-connector
```

In QGIS, use **Plugins > Manage and Install Plugins > Install from ZIP**, then select `dist/qtiler_connector-<version>.zip`.

For a manual development installation, copy the entire `qtiler_connector` folder to:

```text
%APPDATA%\QGIS\QGIS3\profiles\default\python\plugins\qtiler_connector
```

Restart QGIS, enable **Qtiler Connector** in the Plugin Manager, then open **Web > Qtiler Connector**. Enter the public HTTPS Qtiler URL and a user API key. QGIS may prompt the user to unlock or configure its Authentication Manager before storing the key.

## Required Permissions

- `admin`: full access to projects, portal administration, and database gateway resources.
- `database:read`: access to the active database gateway connection.
- `database:read:<connection-id>`: access to one specific gateway connection.
- Project view permissions: required to discover and open protected QGIS projects.
- Project edit permissions: required to save or replace stored projects.

Assign **Database gateway** in the QtilerAuth user permissions interface to grant `database:read`.

## Production Configuration

Set these values in Qtiler's `.env` before enabling production database connections:

```dotenv
PUBLIC_BASE_URL=https://gis.example.org
QTILER_TRUST_PROXY=loopback
QTILER_ENABLE_HSTS=1
AUTH_STORE_PLAINTEXT_API_KEYS=0
AUTH_API_RATE_LIMIT_PER_MINUTE=600
QTILER_DATABASE_CREDENTIALS_KEY=<32-byte-base64-or-64-hex-character-key>
```

Generate a base64 encryption key in PowerShell:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Use a reverse proxy with a valid TLS certificate. Preserve the original host and forward `X-Forwarded-Proto`, `X-Forwarded-Host`, and `X-Forwarded-For`. Block inbound PostgreSQL and SQL Server ports at the firewall; only Qtiler should reach them.

## Production Checklist

1. Change the default Qtiler administrator password.
2. Use HTTPS only and verify the public base URL.
3. Set `QTILER_DATABASE_CREDENTIALS_KEY` before saving database passwords.
4. Run the database setup SQL with an administrator account.
5. Configure a least-privilege gateway account.
6. Configure PostGIS role switching or SQL Server Row-Level Security where user-level data restrictions are required.
7. Assign project access and **Database gateway** permissions in QtilerAuth.
8. Set a finite API-key rate limit and disable plaintext API-key storage.
9. Back up `data/auth.db` and database project storage using your normal backup policy.
10. Test with a non-administrator account before granting broad access.

## Operational Notes

- Restart Qtiler after changing environment variables.
- Revoke and regenerate a user's API key when a device is lost or a key is exposed.
- Use QtilerAuth audit records to investigate failed login attempts.
- Delete or disable unused database connections rather than leaving dormant service accounts active.
- The QGIS Connector package contains its own README, changelog, license, and database setup guide.

## Support

For licensing, deployment, and support, contact MundoGIS at support@mundogis.se.