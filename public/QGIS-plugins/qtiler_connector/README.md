# Qtiler Connector

Copyright (C) 2026 MundoGIS. Licensed under GPL-2.0-or-later.

Qtiler Connector provides secure access to Qtiler services from QGIS.

## What it does

- Opens authorized WMS, WFS, and WMTS service capabilities using a Qtiler API key.
- Lists individual WMS, WFS, and WMTS layers for each authorized Qtiler project and adds only selected layers.
- Lists and opens QGIS projects stored through Qtiler.
- Lists authorized PostGIS and SQL Server connections, schemas, and selectable spatial layers through the Qtiler HTTPS gateway.
- Loads gateway layers without a direct PostgreSQL or SQL Server connection from the user's computer.
- Provides Disconnect, Clear API key, and an activity/error log for troubleshooting.

## User setup

1. Install the plugin in QGIS.
2. Open **Web > Qtiler Connector**.
3. Enter the HTTPS URL for your Qtiler installation and the API key issued by your administrator.
4. Select a WMS, WFS, or WMTS project, mark the layers to add, and choose **Add selected layers**.
5. In **Databases**, select an authorized connection and schema, then mark layers or open a stored QGIS project.

The plugin stores the server URL in the local QGIS user profile. Its API key is stored by QGIS Authentication Manager, not in plugin settings or service URLs. Treat the API key as a password and revoke it from QtilerAuth when a device is lost.

## Administrator setup

- Publish Qtiler through HTTPS with a trusted certificate.
- Keep PostgreSQL and SQL Server private: allow Qtiler to reach them, but do not expose their ports to the internet.
- Set `QTILER_DATABASE_CREDENTIALS_KEY` to a 32-byte base64 value or 64-character hexadecimal value before configuring a database connection. The database service-account password is encrypted in Qtiler's local database.
- Set `AUTH_API_RATE_LIMIT_PER_MINUTE` to a finite production value, such as `600`, to bound API-key traffic.
- Run the least-privilege scripts in [DATABASE_SETUP.md](DATABASE_SETUP.md) before adding database gateway connections.
- Create Qtiler users, grant their project access, and explicitly assign the **Database gateway** permission in QtilerAuth.

## Security model

Only Qtiler connects to the database network. The QGIS client communicates with Qtiler over HTTPS and presents an API key. Qtiler validates authentication, applies QtilerAuth permissions, and returns only the requested gateway resource. The plugin never receives a database host, database password, or service-account password.

## License

This plugin is distributed under the GNU General Public License version 2.0 or later. See [LICENSE](LICENSE).