# -*- coding: utf-8 -*-
# Qtiler Connector
# Copyright (C) 2026 MundoGIS
# SPDX-License-Identifier: GPL-2.0-or-later

import os
import tempfile
import urllib.parse
from datetime import datetime

from qgis.PyQt.QtCore import Qt, QSettings
from qgis.PyQt.QtWidgets import (
    QComboBox, QDockWidget, QFormLayout, QGroupBox, QHBoxLayout, QLabel,
    QLineEdit, QListWidget, QListWidgetItem, QMessageBox, QPushButton,
    QSplitter, QTabWidget, QTextEdit, QTreeWidget, QTreeWidgetItem, QVBoxLayout, QWidget
)
from qgis.core import QgsApplication, QgsAuthMethodConfig, QgsProject, QgsRasterLayer, QgsVectorLayer

from .api_client import QtilerApiClient


class QtilerConnectorDock(QDockWidget):
    def __init__(self, iface, parent=None):
        super().__init__('Qtiler Connector', parent)
        self.iface = iface
        self.settings = QSettings('MundoGIS', 'QtilerConnector')
        self.api_client = None
        self.auth_config_id = ''
        self.current_project_name = None
        self.current_project_schema = None
        self.service_tabs = {}
        self.init_ui()
        self.load_saved_settings()
        self._set_connected(False)

    def init_ui(self):
        self.setAllowedAreas(Qt.AllDockWidgetAreas)
        self.setFeatures(QDockWidget.DockWidgetClosable | QDockWidget.DockWidgetMovable | QDockWidget.DockWidgetFloatable)
        self.setMinimumWidth(340)
        self.setMinimumHeight(500)
        root = QWidget()
        layout = QVBoxLayout(root)
        layout.addWidget(self._create_connection_group())

        self.tabs = QTabWidget()
        for service in ('WMS', 'WFS', 'WMTS'):
            self.tabs.addTab(self._create_service_page(service), service)
        self.tabs.addTab(self._create_database_page(), 'Databases')
        layout.addWidget(self.tabs, 1)

        log_group = QGroupBox('Activity log')
        log_layout = QVBoxLayout(log_group)
        self.log_output = QTextEdit()
        self.log_output.setReadOnly(True)
        self.log_output.setMaximumHeight(130)
        clear_log = QPushButton('Clear log')
        clear_log.clicked.connect(self.log_output.clear)
        log_layout.addWidget(self.log_output)
        log_layout.addWidget(clear_log)
        layout.addWidget(log_group)

        self.status_label = QLabel('Not connected')
        layout.addWidget(self.status_label)
        self.setWidget(root)

    def _create_connection_group(self):
        group = QGroupBox('Qtiler connection')
        layout = QVBoxLayout(group)
        form = QFormLayout()
        self.url_input = QLineEdit()
        self.url_input.setPlaceholderText('https://qtiler.example.org')
        self.key_input = QLineEdit()
        self.key_input.setPlaceholderText('qk_...')
        self.key_input.setEchoMode(QLineEdit.Password)
        form.addRow('URL', self.url_input)
        form.addRow('API key', self.key_input)
        layout.addLayout(form)

        actions = QHBoxLayout()
        self.connect_button = QPushButton('Connect')
        self.connect_button.clicked.connect(self.on_connect_clicked)
        self.disconnect_button = QPushButton('Disconnect')
        self.disconnect_button.clicked.connect(self.disconnect)
        self.clear_key_button = QPushButton('Clear API key')
        self.clear_key_button.clicked.connect(self.clear_api_key)
        actions.addWidget(self.connect_button)
        actions.addWidget(self.disconnect_button)
        actions.addWidget(self.clear_key_button)
        layout.addLayout(actions)
        return group

    def _create_service_page(self, service):
        page = QWidget()
        layout = QVBoxLayout(page)
        project_combo = QComboBox()
        project_combo.currentIndexChanged.connect(lambda _index, name=service: self.refresh_service_layers(name))
        layer_tree = QTreeWidget()
        layer_tree.setHeaderLabels(['Layer', 'Name', 'CRS / Matrix set'])
        layer_tree.setRootIsDecorated(False)

        actions = QHBoxLayout()
        refresh = QPushButton('Refresh layers')
        refresh.clicked.connect(lambda _checked=False, name=service: self.refresh_service_layers(name))
        select_all = QPushButton('Select all')
        select_all.clicked.connect(lambda _checked=False, tree=layer_tree: self._set_all_checked(tree, True))
        clear_all = QPushButton('Clear')
        clear_all.clicked.connect(lambda _checked=False, tree=layer_tree: self._set_all_checked(tree, False))
        add_selected = QPushButton('Add selected layers')
        add_selected.clicked.connect(lambda _checked=False, name=service: self.add_selected_service_layers(name))
        for button in (refresh, select_all, clear_all, add_selected):
            actions.addWidget(button)

        layout.addWidget(QLabel('Authorized Qtiler project'))
        layout.addWidget(project_combo)
        layout.addWidget(QLabel('Available layers'))
        layout.addWidget(layer_tree, 1)
        layout.addLayout(actions)
        self.service_tabs[service] = {'project': project_combo, 'layers': layer_tree}
        return page

    def _create_database_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.addWidget(QLabel('Database traffic is proxied through Qtiler HTTPS. No VPN or database password is required.'))

        connection_row = QHBoxLayout()
        self.database_combo = QComboBox()
        self.database_combo.currentIndexChanged.connect(self.on_database_changed)
        refresh_connections = QPushButton('Refresh databases')
        refresh_connections.clicked.connect(self.refresh_database_connections)
        connection_row.addWidget(QLabel('Database'))
        connection_row.addWidget(self.database_combo, 1)
        connection_row.addWidget(refresh_connections)
        layout.addLayout(connection_row)

        schema_row = QHBoxLayout()
        self.schema_combo = QComboBox()
        self.schema_combo.currentIndexChanged.connect(lambda _index: self.refresh_schema_layers())
        refresh_schemas = QPushButton('Refresh schemas')
        refresh_schemas.clicked.connect(self.refresh_schemas)
        schema_row.addWidget(QLabel('Schema'))
        schema_row.addWidget(self.schema_combo, 1)
        schema_row.addWidget(refresh_schemas)
        layout.addLayout(schema_row)

        self.database_layer_tree = QTreeWidget()
        self.database_layer_tree.setHeaderLabels(['Layer', 'Geometry', 'SRID'])
        self.database_layer_tree.setRootIsDecorated(False)
        self.database_layer_tree.itemDoubleClicked.connect(lambda _item, _column: self.add_selected_database_layers())
        self.database_layer_tree.setMinimumHeight(220)

        layer_actions = QHBoxLayout()
        select_all = QPushButton('Select all')
        select_all.clicked.connect(lambda: self._set_all_checked(self.database_layer_tree, True))
        clear_all = QPushButton('Clear')
        clear_all.clicked.connect(lambda: self._set_all_checked(self.database_layer_tree, False))
        add_layers = QPushButton('Add selected layers')
        add_layers.clicked.connect(self.add_selected_database_layers)
        layer_actions.addWidget(select_all)
        layer_actions.addWidget(clear_all)
        layer_actions.addWidget(add_layers)
        layer_panel = QGroupBox('Spatial layers')
        layer_panel_layout = QVBoxLayout(layer_panel)
        layer_panel_layout.addWidget(self.database_layer_tree)
        layer_panel_layout.addLayout(layer_actions)

        self.project_list = QListWidget()
        self.project_list.itemDoubleClicked.connect(lambda _item: self.on_open_project_clicked())
        self.project_list.setMinimumHeight(100)

        project_actions = QHBoxLayout()
        refresh_projects = QPushButton('Refresh projects')
        refresh_projects.clicked.connect(self.refresh_project_list)
        open_project = QPushButton('Open project')
        open_project.clicked.connect(self.on_open_project_clicked)
        save_project = QPushButton('Save project')
        save_project.clicked.connect(self.on_save_project_clicked)
        save_as = QPushButton('Save as...')
        save_as.clicked.connect(self.on_save_as_clicked)
        for button in (refresh_projects, open_project, save_project, save_as):
            project_actions.addWidget(button)
        project_panel = QGroupBox('Stored QGIS projects')
        project_panel_layout = QVBoxLayout(project_panel)
        project_panel_layout.addWidget(self.project_list)
        project_panel_layout.addLayout(project_actions)

        database_splitter = QSplitter(Qt.Vertical)
        database_splitter.addWidget(layer_panel)
        database_splitter.addWidget(project_panel)
        database_splitter.setStretchFactor(0, 4)
        database_splitter.setStretchFactor(1, 1)
        database_splitter.setSizes([520, 160])
        layout.addWidget(database_splitter, 1)
        return page

    def _log(self, message, level='INFO'):
        stamp = datetime.now().strftime('%H:%M:%S')
        self.log_output.append('[{}] {}: {}'.format(stamp, level, message))

    def _set_connected(self, connected):
        self.tabs.setEnabled(connected)
        self.disconnect_button.setEnabled(connected)
        self.connect_button.setEnabled(not connected)
        if not connected:
            self.status_label.setText('Not connected')

    def load_saved_settings(self):
        self.url_input.setText(self.settings.value('server_url', ''))
        self.auth_config_id = self.settings.value('auth_config_id', '')
        if self.auth_config_id:
            self.key_input.setPlaceholderText('Stored securely in QGIS Authentication Manager')

    def save_settings(self):
        self.settings.setValue('server_url', self.url_input.text().strip())
        self.settings.setValue('auth_config_id', self.auth_config_id)

    def _read_stored_api_key(self):
        if not self.auth_config_id:
            return ''
        config = QgsAuthMethodConfig()
        if not QgsApplication.authManager().loadAuthenticationConfig(self.auth_config_id, config, True):
            return ''
        return config.config('username', '')

    def _store_api_key(self, api_key):
        manager = QgsApplication.authManager()
        config = QgsAuthMethodConfig()
        existing = bool(self.auth_config_id and manager.loadAuthenticationConfig(self.auth_config_id, config, True))
        config.setName('Qtiler Connector API key')
        config.setMethod('Basic')
        config.setConfig('username', api_key)
        config.setConfig('password', 'x')
        stored = manager.updateAuthenticationConfig(config) if existing else manager.storeAuthenticationConfig(config)
        if not stored:
            raise RuntimeError('QGIS could not store the API key in Authentication Manager.')
        self.auth_config_id = config.id()

    def on_connect_clicked(self):
        url = self.url_input.text().strip()
        api_key = self.key_input.text().strip() or self._read_stored_api_key()
        if not url or not api_key:
            QMessageBox.warning(self, 'Connection', 'Enter the Qtiler URL and API key.')
            return
        self._log('Connecting to {}'.format(url))
        client = QtilerApiClient(url, api_key, self.auth_config_id)
        ok, user = client.test_connection()
        if not ok:
            self._log(str(user), 'ERROR')
            QMessageBox.critical(self, 'Connection error', str(user))
            return
        try:
            self._store_api_key(api_key)
        except RuntimeError as error:
            self._log(str(error), 'ERROR')
            QMessageBox.critical(self, 'Authentication storage error', str(error))
            return
        self.api_client = client
        self.api_client.auth_config_id = self.auth_config_id
        self.key_input.clear()
        self.save_settings()
        username = user.get('username', 'user')
        self.status_label.setText('Connected as {}'.format(username))
        self._set_connected(True)
        self._log('Connected as {}'.format(username), 'SUCCESS')
        self.refresh_service_projects()
        self.refresh_database_connections()

    def disconnect(self):
        self.api_client = None
        self.current_project_name = None
        self.current_project_schema = None
        for controls in self.service_tabs.values():
            controls['project'].clear()
            controls['layers'].clear()
        self.database_combo.clear()
        self.schema_combo.clear()
        self.database_layer_tree.clear()
        self.project_list.clear()
        self._set_connected(False)
        self._log('Disconnected')

    def clear_api_key(self):
        self.disconnect()
        if self.auth_config_id:
            QgsApplication.authManager().removeAuthenticationConfig(self.auth_config_id)
        self.auth_config_id = ''
        self.settings.remove('auth_config_id')
        self.key_input.clear()
        self.key_input.setPlaceholderText('qk_...')
        self._log('Stored API key removed', 'SUCCESS')

    @staticmethod
    def _set_all_checked(tree, checked):
        state = Qt.Checked if checked else Qt.Unchecked
        for index in range(tree.topLevelItemCount()):
            tree.topLevelItem(index).setCheckState(0, state)

    @staticmethod
    def _checked_items(tree):
        return [
            tree.topLevelItem(index)
            for index in range(tree.topLevelItemCount())
            if tree.topLevelItem(index).checkState(0) == Qt.Checked
        ]

    def refresh_service_projects(self):
        if not self.api_client:
            return
        ok, projects = self.api_client.list_service_projects()
        if not ok:
            self._log('Could not load OGC projects: {}'.format(projects), 'ERROR')
            return
        for controls in self.service_tabs.values():
            combo = controls['project']
            combo.blockSignals(True)
            combo.clear()
            for project in projects:
                project_id = project.get('id', project.get('projectId', '')) if isinstance(project, dict) else str(project)
                title = project.get('name', project_id) if isinstance(project, dict) else project_id
                if project_id:
                    combo.addItem(str(title), str(project_id))
            combo.blockSignals(False)
        self._log('Loaded {} authorized Qtiler projects'.format(len(projects)))
        for service in self.service_tabs:
            self.refresh_service_layers(service)

    def refresh_service_layers(self, service):
        if not self.api_client:
            return
        controls = self.service_tabs[service]
        project_id = controls['project'].currentData()
        tree = controls['layers']
        tree.clear()
        if not project_id:
            return
        self._log('Loading {} layers for {}'.format(service, project_id))
        ok, layers = self.api_client.list_service_layers(service, project_id)
        if not ok:
            self._log(str(layers), 'ERROR')
            return
        for layer in layers:
            detail = layer.get('matrixSet') or layer.get('crs', '')
            item = QTreeWidgetItem([str(layer.get('title') or layer.get('name')), str(layer.get('name', '')), str(detail)])
            item.setCheckState(0, Qt.Unchecked)
            item.setData(0, Qt.UserRole, layer)
            tree.addTopLevelItem(item)
        self._log('Loaded {} {} layers'.format(len(layers), service))

    def add_selected_service_layers(self, service):
        if not self.api_client:
            return
        controls = self.service_tabs[service]
        project_id = controls['project'].currentData()
        selected = self._checked_items(controls['layers'])
        if not selected:
            QMessageBox.warning(self, service, 'Select at least one layer.')
            return
        service_url = self.api_client.get_service_url(service, project_id)
        provider_url = self.api_client.get_capabilities_url(service, project_id) if service == 'WMTS' else service_url
        encoded_url = urllib.parse.quote(provider_url, safe=':/')
        added = 0
        for item in selected:
            layer_info = item.data(0, Qt.UserRole) or {}
            name = str(layer_info.get('name', ''))
            title = str(layer_info.get('title') or name)
            crs = str(layer_info.get('crs') or 'EPSG:3857')
            if service == 'WFS':
                source = "url='{}' typename='{}' srsname='{}' authcfg='{}'".format(service_url, name, crs, self.auth_config_id)
                layer = QgsVectorLayer(source, title, 'WFS')
            else:
                params = [
                    'type={}'.format('wmts' if service == 'WMTS' else 'wms'),
                    'url={}'.format(encoded_url),
                    'layers={}'.format(urllib.parse.quote(name, safe=':._-')),
                    'styles={}'.format(urllib.parse.quote(str(layer_info.get('style', '')), safe=':._-')),
                    'format=image/png',
                    'crs={}'.format(urllib.parse.quote(crs, safe=':')),
                    'authcfg={}'.format(self.auth_config_id)
                ]
                if service == 'WMTS' and layer_info.get('matrixSet'):
                    params.append('tileMatrixSet={}'.format(urllib.parse.quote(str(layer_info['matrixSet']), safe=':._-')))
                layer = QgsRasterLayer('&'.join(params), title, 'wms')
            if layer.isValid():
                QgsProject.instance().addMapLayer(layer)
                added += 1
                self._log('Added {} layer {}'.format(service, title), 'SUCCESS')
            else:
                provider_error = layer.error().message() if layer.error() else 'Unknown provider error'
                self._log('QGIS rejected {} layer {}: {}'.format(service, title, provider_error), 'ERROR')
        if added:
            self.iface.messageBar().pushSuccess('Qtiler', 'Added {} {} layer(s).'.format(added, service))

    def current_connection_id(self):
        return self.database_combo.currentData()

    def refresh_database_connections(self):
        if not self.api_client:
            return
        ok, connections = self.api_client.list_database_connections()
        if not ok:
            self._log('Could not load databases: {}'.format(connections), 'ERROR')
            return
        self.database_combo.blockSignals(True)
        self.database_combo.clear()
        for connection in connections:
            label = '{} ({})'.format(connection.get('name', 'Database'), connection.get('engine', ''))
            self.database_combo.addItem(label, connection.get('id'))
            if connection.get('isDefault'):
                self.database_combo.setCurrentIndex(self.database_combo.count() - 1)
        self.database_combo.blockSignals(False)
        if not connections:
            self.schema_combo.clear()
            self.database_layer_tree.clear()
            self.project_list.clear()
            self._log('No authorized databases. Ask a Qtiler administrator to grant Database gateway or Database: <name>.', 'WARNING')
            return
        self._log('Loaded {} authorized database connection(s)'.format(len(connections)))
        self.on_database_changed()

    def on_database_changed(self, _index=None):
        if not self.api_client or not self.current_connection_id():
            return
        self.refresh_schemas()
        self.refresh_project_list()

    def refresh_schemas(self):
        if not self.api_client:
            return
        ok, schemas = self.api_client.list_schemas(self.current_connection_id())
        if not ok:
            self._log('Could not load schemas: {}'.format(schemas), 'ERROR')
            return
        self.schema_combo.blockSignals(True)
        self.schema_combo.clear()
        self.schema_combo.addItems([str(schema) for schema in schemas])
        self.schema_combo.blockSignals(False)
        self._log('Loaded {} schema(s)'.format(len(schemas)))
        self.refresh_schema_layers()

    def refresh_schema_layers(self):
        self.database_layer_tree.clear()
        if not self.api_client or not self.schema_combo.currentText():
            return
        schema = self.schema_combo.currentText()
        ok, layers = self.api_client.list_schema_layers(schema, self.current_connection_id())
        if not ok:
            self._log('Could not load database layers: {}'.format(layers), 'ERROR')
            return
        for layer in layers:
            item = QTreeWidgetItem([
                str(layer.get('table_name', '')),
                str(layer.get('geometry_type', '')),
                str(layer.get('srid', '') or '')
            ])
            item.setCheckState(0, Qt.Unchecked)
            item.setData(0, Qt.UserRole, layer)
            self.database_layer_tree.addTopLevelItem(item)
        self._log('Loaded {} spatial layer(s) from {}'.format(len(layers), schema))

    def add_selected_database_layers(self):
        selected = self._checked_items(self.database_layer_tree)
        if not selected:
            current = self.database_layer_tree.currentItem()
            selected = [current] if current else []
        if not selected:
            QMessageBox.warning(self, 'Database gateway', 'Select at least one layer.')
            return
        schema = self.schema_combo.currentText()
        added = 0
        for item in selected:
            data = item.data(0, Qt.UserRole) or {}
            table = str(data.get('table_name', ''))
            title = '{}.{}'.format(schema, table)
            url = self.api_client.get_database_wfs_url(schema, table, self.current_connection_id())
            type_name = 'qtiler:{}.{}'.format(schema, table)
            source = "url='{}' typename='{}' authcfg='{}' pagingEnabled='true' pageSize='10000'".format(
                url, type_name, self.auth_config_id
            )
            layer = QgsVectorLayer(source, title, 'WFS')
            if layer.isValid():
                QgsProject.instance().addMapLayer(layer)
                added += 1
                self._log('Added database layer {}'.format(title), 'SUCCESS')
            else:
                provider_error = layer.error().message() if layer.error() else 'Unknown provider error'
                self._log('QGIS rejected database layer {}: {}'.format(title, provider_error), 'ERROR')
        if added:
            self.iface.messageBar().pushSuccess('Qtiler', 'Added {} database layer(s).'.format(added))

    def refresh_project_list(self):
        if not self.api_client:
            return
        ok, projects = self.api_client.list_projects(self.current_connection_id())
        self.project_list.clear()
        if not ok:
            self._log('Could not load stored projects: {}'.format(projects), 'ERROR')
            return
        for project in projects:
            project_name = str(project.get('name', project))
            project_schema = str(project.get('schema', ''))
            item = QListWidgetItem('{}.{}'.format(project_schema, project_name) if project_schema else project_name)
            item.setData(Qt.UserRole, project)
            self.project_list.addItem(item)
        self._log('Loaded {} stored QGIS project(s)'.format(len(projects)))

    def on_open_project_clicked(self):
        item = self.project_list.currentItem()
        if not item:
            QMessageBox.warning(self, 'Projects', 'Select a project.')
            return
        project_data = item.data(Qt.UserRole) or {}
        project_name = str(project_data.get('name') or item.text())
        project_schema = str(project_data.get('schema') or '')
        self._log('Downloading project {}'.format(project_name))
        ok, content = self.api_client.download_project(project_name, self.current_connection_id(), project_schema)
        if not ok or not content:
            self._log(str(content), 'ERROR')
            QMessageBox.critical(self, 'Projects', 'Could not download {}.'.format(project_name))
            return
        file_handle, file_path = tempfile.mkstemp(prefix='qtiler_project_', suffix='.qgz')
        os.close(file_handle)
        with open(file_path, 'wb') as project_file:
            project_file.write(content)
        if not QgsProject.instance().read(file_path):
            self._log('QGIS could not open {}'.format(project_name), 'ERROR')
            QMessageBox.critical(self, 'Projects', 'QGIS could not open the downloaded project.')
            return
        self.current_project_name = project_name
        self.current_project_schema = project_schema
        self.status_label.setText('Connected - active project: {}'.format(project_name))
        self._log('Opened project {}'.format(project_name), 'SUCCESS')

    def on_save_project_clicked(self):
        if not self.current_project_name:
            QMessageBox.warning(self, 'Projects', 'Open a Qtiler project or use Save as.')
            return
        self._upload_current_project(self.current_project_name)

    def on_save_as_clicked(self):
        from qgis.PyQt.QtWidgets import QInputDialog
        name, accepted = QInputDialog.getText(self, 'Save project as', 'Project name:')
        if accepted and name.strip():
            self._upload_current_project(name.strip())

    def _upload_current_project(self, project_name):
        if not self.api_client:
            return
        file_handle, file_path = tempfile.mkstemp(prefix='qtiler_upload_', suffix='.qgz')
        os.close(file_handle)
        try:
            if not QgsProject.instance().write(file_path):
                raise RuntimeError('Could not prepare the project for upload.')
            with open(file_path, 'rb') as project_file:
                ok, message = self.api_client.save_project(
                    project_name,
                    project_file.read(),
                    self.current_connection_id(),
                    self.current_project_schema
                )
        except Exception as error:
            ok, message = False, str(error)
        finally:
            try:
                os.remove(file_path)
            except OSError:
                pass
        if ok:
            self.current_project_name = project_name
            self.refresh_project_list()
            self._log(str(message), 'SUCCESS')
            self.iface.messageBar().pushSuccess('Qtiler', str(message))
        else:
            self._log(str(message), 'ERROR')
            QMessageBox.critical(self, 'Projects', str(message))
