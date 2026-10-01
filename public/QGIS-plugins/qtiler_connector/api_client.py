# -*- coding: utf-8 -*-
# Qtiler Connector
# Copyright (C) 2026 MundoGIS
# SPDX-License-Identifier: GPL-2.0-or-later

import base64
import json
import ssl
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

class QtilerApiClient:
    def __init__(self, server_url, api_key=None, auth_config_id=None):
        self.server_url = server_url.rstrip('/')
        self.api_key = api_key
        self.auth_config_id = auth_config_id
        self.ssl_context = ssl.create_default_context()

    def set_credentials(self, api_key=None, auth_config_id=None):
        self.api_key = api_key
        self.auth_config_id = auth_config_id

    def _get_headers(self, extra_headers=None):
        headers = {'User-Agent': 'QGIS-QtilerConnector/1.1'}
        if self.api_key:
            credentials = f"{self.api_key}:x".encode('utf-8')
            headers['Authorization'] = 'Basic ' + base64.b64encode(credentials).decode('ascii')
        if extra_headers:
            headers.update(extra_headers)
        return headers

    def _get_json(self, path, timeout=15):
        url = f"{self.server_url}{path}"
        request = urllib.request.Request(url, headers=self._get_headers())
        try:
            with urllib.request.urlopen(request, context=self.ssl_context, timeout=timeout) as response:
                if response.status != 200:
                    return False, f"Error HTTP {response.status}"
                return True, json.loads(response.read().decode('utf-8'))
        except urllib.error.HTTPError as error:
            body = error.read().decode('utf-8', errors='replace')
            return False, f"Error HTTP {error.code}: {body or error.reason}"
        except Exception as error:
            return False, str(error)

    def _get_bytes(self, url, timeout=30):
        request = urllib.request.Request(url, headers=self._get_headers())
        try:
            with urllib.request.urlopen(request, context=self.ssl_context, timeout=timeout) as response:
                return True, response.read()
        except urllib.error.HTTPError as error:
            body = error.read().decode('utf-8', errors='replace')
            return False, f"HTTP {error.code}: {body or error.reason}"
        except Exception as error:
            return False, str(error)

    @staticmethod
    def _local_name(element):
        return element.tag.rsplit('}', 1)[-1]

    @classmethod
    def _child_text(cls, element, child_name):
        for child in element:
            if cls._local_name(child) == child_name:
                return (child.text or '').strip()
        return ''

    def service_url(self, path, params=None):
        suffix = urllib.parse.urlencode(dict(params or {}), doseq=True)
        return f"{self.server_url}{path}" + (f"?{suffix}" if suffix else '')

    def test_connection(self):
        """Validate API credentials against Qtiler's /auth/me endpoint."""
        ok, data = self._get_json('/auth/me', timeout=10)
        return (True, data.get('user', {})) if ok else (False, data)

    def list_projects(self, connection_id=None):
        """Return stored QGIS projects available through Qtiler."""
        query = urllib.parse.urlencode(self._connection_query(connection_id))
        ok, data = self._get_json('/api/qgis/projects' + (f'?{query}' if query else ''))
        return (True, data.get('projects', [])) if ok else (False, data)

    def list_service_projects(self):
        ok, data = self._get_json('/projects')
        if not ok:
            return False, data
        projects = data.get('projects', data) if isinstance(data, dict) else data
        return True, projects if isinstance(projects, list) else []

    def list_project_layers(self, project_id):
        path = '/projects/{}/layers'.format(urllib.parse.quote(project_id, safe=''))
        ok, data = self._get_json(path, timeout=30)
        if not ok:
            return False, data
        return True, data.get('layers', []) if isinstance(data, dict) else []

    def list_database_connections(self):
        ok, data = self._get_json('/api/qgis/connections')
        return (True, data.get('connections', [])) if ok else (False, data)

    @staticmethod
    def _connection_query(connection_id):
        return {'connectionId': connection_id} if connection_id else {}

    def list_schemas(self, connection_id=None):
        path = '/api/qgis/schemas'
        query = urllib.parse.urlencode(self._connection_query(connection_id))
        ok, data = self._get_json(path + (f'?{query}' if query else ''))
        return (True, data.get('schemas', [])) if ok else (False, data)

    def list_schema_layers(self, schema, connection_id=None):
        path = '/api/qgis/schemas/{}/layers'.format(urllib.parse.quote(schema, safe=''))
        query = urllib.parse.urlencode(self._connection_query(connection_id))
        if query:
            path += f'?{query}'
        ok, data = self._get_json(path)
        return (True, data.get('layers', [])) if ok else (False, data)

    def get_gateway_layer_url(self, schema, table, connection_id=None):
        return self.service_url(
            '/api/qgis/gateway/schemas/{}/layers/{}/features'.format(
                urllib.parse.quote(schema, safe=''), urllib.parse.quote(table, safe='')
            ),
            self._connection_query(connection_id)
        )

    def get_database_wfs_url(self, schema, table, connection_id=None):
        params = self._connection_query(connection_id)
        params.update({'schema': schema, 'table': table, 'SERVICE': 'WFS'})
        return self.service_url('/api/qgis/database-wfs', params)

    def download_gateway_layer(self, schema, table, connection_id=None):
        features = []
        source_crs = None
        offset = 0
        page_size = 10000
        maximum_features = 200000
        while True:
            base_url = self.get_gateway_layer_url(schema, table, connection_id)
            separator = '&' if '?' in base_url else '?'
            url = '{}{}limit={}&offset={}'.format(base_url, separator, page_size, offset)
            ok, payload = self._get_bytes(url, timeout=60)
            if not ok:
                return False, payload
            try:
                page = json.loads(payload.decode('utf-8'))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                return False, f'Invalid GeoJSON response: {error}'
            page_features = page.get('features', []) if isinstance(page, dict) else []
            if source_crs is None and isinstance(page, dict):
                source_crs = page.get('sourceCrs')
            features.extend(page_features)
            next_offset = page.get('nextOffset') if isinstance(page, dict) else None
            if next_offset is None:
                break
            if len(features) >= maximum_features:
                return False, 'Layer exceeds the 200,000 feature safety limit. Apply a server-side filter or publish it as WFS.'
            offset = int(next_offset)
        collection = {'type': 'FeatureCollection', 'features': features}
        if source_crs:
            collection['sourceCrs'] = source_crs
            collection['crs'] = {'type': 'name', 'properties': {'name': source_crs}}
        return True, json.dumps(collection).encode('utf-8')

    def get_capabilities_url(self, service, project_id):
        service = service.upper()
        if service == 'WMS':
            return self.service_url('/wms', {'project': project_id, 'SERVICE': 'WMS', 'REQUEST': 'GetCapabilities'})
        if service == 'WFS':
            return self.service_url('/wfs', {'project': project_id, 'SERVICE': 'WFS', 'REQUEST': 'GetCapabilities'})
        return self.service_url('/wmts', {'project': project_id, 'SERVICE': 'WMTS', 'REQUEST': 'GetCapabilities'})

    def get_service_url(self, service, project_id):
        service = service.upper()
        if service == 'WFS':
            return self.service_url('/wfs', {'project': project_id, 'SERVICE': 'WFS'})
        if service == 'WMTS':
            return self.service_url('/wmts', {'project': project_id})
        return self.service_url('/{}'.format(service.lower()), {'project': project_id, 'SERVICE': service})

    def list_service_layers(self, service, project_id):
        service = service.upper()
        url = self.get_capabilities_url(service, project_id)
        ok, payload = self._get_bytes(url)
        if not ok:
            return False, payload
        try:
            root = ET.fromstring(payload)
        except ET.ParseError as error:
            return False, f'Invalid {service} capabilities: {error}'

        layers = []
        if service == 'WMS':
            for element in root.iter():
                if self._local_name(element) != 'Layer':
                    continue
                name = self._child_text(element, 'Name')
                if not name:
                    continue
                title = self._child_text(element, 'Title') or name
                crs = self._child_text(element, 'CRS') or self._child_text(element, 'SRS') or 'EPSG:3857'
                layers.append({'name': name, 'title': title, 'crs': crs})
        elif service == 'WFS':
            for element in root.iter():
                if self._local_name(element) != 'FeatureType':
                    continue
                name = self._child_text(element, 'Name')
                if not name:
                    continue
                layers.append({
                    'name': name,
                    'title': self._child_text(element, 'Title') or name,
                    'crs': self._child_text(element, 'DefaultCRS') or self._child_text(element, 'DefaultSRS') or 'EPSG:4326'
                })
        else:
            matrix_crs = {}
            for element in root.iter():
                if self._local_name(element) != 'TileMatrixSet':
                    continue
                identifier = self._child_text(element, 'Identifier')
                supported_crs = self._child_text(element, 'SupportedCRS')
                if identifier and supported_crs:
                    if 'EPSG' in supported_crs.upper():
                        code = supported_crs.rstrip('/').rsplit(':', 1)[-1].rsplit('/', 1)[-1]
                        supported_crs = 'EPSG:{}'.format(code)
                    matrix_crs[identifier] = supported_crs
            for element in root.iter():
                if self._local_name(element) != 'Layer':
                    continue
                identifier = self._child_text(element, 'Identifier')
                if not identifier:
                    continue
                matrix_set = ''
                for descendant in element.iter():
                    if self._local_name(descendant) == 'TileMatrixSet' and descendant.text:
                        matrix_set = descendant.text.strip()
                        break
                style = 'default'
                for child in element:
                    if self._local_name(child) == 'Style':
                        style = self._child_text(child, 'Identifier') or style
                        if child.attrib.get('isDefault', '').lower() == 'true':
                            break
                layers.append({
                    'name': identifier,
                    'title': self._child_text(element, 'Title') or identifier,
                    'crs': matrix_crs.get(matrix_set, 'EPSG:3857'),
                    'matrixSet': matrix_set,
                    'style': style
                })
        return True, layers

    def download_project(self, project_name, connection_id=None, project_schema=None):
        """Download the binary .qgz project content."""
        url = self.service_url(
            '/api/qgis/projects/{}'.format(urllib.parse.quote(project_name, safe='')),
            {**self._connection_query(connection_id), **({'projectSchema': project_schema} if project_schema else {})}
        )
        req = urllib.request.Request(url, headers=self._get_headers())
        try:
            with urllib.request.urlopen(req, context=self.ssl_context, timeout=30) as response:
                if response.status == 200:
                    return True, response.read()
                return False, None
        except Exception as e:
            return False, str(e)

    def save_project(self, project_name, project_bytes, connection_id=None, project_schema=None):
        """Upload a .qgz project to Qtiler storage."""
        params = self._connection_query(connection_id)
        if project_schema:
            params['projectSchema'] = project_schema
        url = self.service_url('/api/qgis/projects/save', params)
        headers = self._get_headers({
            'Content-Type': 'application/octet-stream',
            'X-QGIS-Project-Name': project_name
        })
        req = urllib.request.Request(url, data=project_bytes, headers=headers, method='POST')
        try:
            with urllib.request.urlopen(req, context=self.ssl_context, timeout=45) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode('utf-8'))
                    return True, data.get('message', 'Project saved successfully')
                return False, 'Project save failed'
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8')
            return False, f"HTTP {e.code}: {error_body}"
        except Exception as e:
            return False, str(e)