# Changelog

## 1.3.4

- Preserves the database layer source CRS in paginated GeoJSON and assigns it explicitly in QGIS.
- Uses a percent-encoded WMTS GetCapabilities URL in the QGIS provider URI.
- Makes the dock movable, floatable, resizable, and dockable in every QGIS dock area.

## 1.3.3

- Fixed QGIS WMTS provider URIs by using `type=wmts` and a clean project endpoint.
- Supports automatic database discovery when the QtilerAuth username matches the configured database username.

## 1.3.2

- Added QGIS provider error details to the activity log for rejected layers.

## 1.3.1

- Fixed WFS discovery and provider URLs to use Qtiler's `project` KVP contract.
- Improved the empty database state when an API user has no gateway permission.

## 1.3.0

- Added Connect, Disconnect, and Clear API key session controls.
- Added selectable WMS, WFS, and WMTS layer catalogs per authorized project.
- Added authorized database connection selection, schema browsing, and selectable spatial layers.
- Added stored QGIS project browsing per database connection.
- Added a visible activity and error log.
- Database gateway layers are downloaded with authenticated requests and loaded without exposing API keys.
- Added paginated database-layer downloads and gateway error correlation IDs.

## 1.2.0

- Added authenticated WMS, WFS, and WMTS access.
- Added secure PostGIS gateway layers, stored project access, and schema browsing.
- Stores API keys with the QGIS Authentication Manager.
- Removed direct database connections from client machines.
- Added QtilerAuth database gateway authorization and request limits.

## 1.0.0

- Initial Qtiler Connector release.