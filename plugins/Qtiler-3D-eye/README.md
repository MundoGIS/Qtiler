# Qtiler 3D Eye

## Cesium Ion tokens

Set `QTILER3DEYE_ION_TOKEN_KEY` before starting Qtiler. It must be a stable 32-byte key encoded as base64 or a 64-character hexadecimal string. Generate a base64 key with:

```powershell
openssl rand -base64 32
```

Keep this key in the server's secret environment configuration and include it in secure backups. Losing or changing it makes previously encrypted Ion tokens unreadable. `QTILER_DATABASE_CREDENTIALS_KEY` is accepted as a fallback when the dedicated key is not set.

Existing plaintext tokens remain readable for migration but are encrypted the next time settings or a map containing a token is saved. The settings and map-editing APIs return only whether a token is configured, never the token value.

Cesium Ion tokens used by the viewer are necessarily sent to the browser so CesiumJS can access Ion directly. Use a public/browser token with the minimum required permissions and configure any available URL restrictions in Cesium Ion; do not use an account-wide or administrative token. The server uses the saved global token to fetch the selectable 3D Tiles assets in the map editor.

The map editor uses OpenStreetMap as the opening background by default. Selecting another included background explicitly makes that layer the opening background instead. The Initial view tab previews the current, unpublished map configuration; preview again after changing settings to refresh it.

## Model uploads

GLB is recommended because it can package geometry and textures in one file. A `.gltf` upload must be self-contained (for example, use embedded data URIs); external buffer and texture files are not uploaded as a linked folder.

## Viewer layer controls

The published viewer keeps the layer launcher at the top of the left tool rail and places the 2D, 3D and side-by-side view selector below the camera controls on the right. Operational layers show a legend, a transparency slider and a zoom-to-layer action. Editors can create shared layer groups and one level of subgroups from the Layers panel, assign layers to them, and save that structure to the published map for all visitors.

If an asset upload fails, the admin status now includes the server's safe diagnostic message. Catalog conflicts, full storage and storage permission failures are reported distinctly; check the Qtiler server log for the underlying cause of other processing errors.
