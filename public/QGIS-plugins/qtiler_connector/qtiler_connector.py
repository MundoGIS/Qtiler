# -*- coding: utf-8 -*-
# Qtiler Connector
# Copyright (C) 2026 MundoGIS
# SPDX-License-Identifier: GPL-2.0-or-later

import os
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QIcon
from qgis.PyQt.QtWidgets import QAction
from .dock_widget import QtilerConnectorDock

class QtilerConnector:
    def __init__(self, iface):
        self.iface = iface
        self.plugin_dir = os.path.dirname(__file__)
        self.dock_widget = None
        self.action = None

    def initGui(self):
        icon_path = os.path.join(self.plugin_dir, 'icon.svg')
        if not os.path.exists(icon_path):
            icon = QIcon()
        else:
            icon = QIcon(icon_path)

        self.action = QAction(icon, "Qtiler Connector", self.iface.mainWindow())
        self.action.triggered.connect(self.run)

        self.iface.addWebToolBarIcon(self.action)
        self.iface.addPluginToWebMenu("Qtiler Connector", self.action)

    def unload(self):
        self.iface.removePluginWebMenu("Qtiler Connector", self.action)
        self.iface.removeWebToolBarIcon(self.action)
        if self.dock_widget:
            self.iface.removeDockWidget(self.dock_widget)
            self.dock_widget.deleteLater()

    def run(self):
        if not self.dock_widget:
            self.dock_widget = QtilerConnectorDock(self.iface)
            self.iface.addDockWidget(Qt.RightDockWidgetArea, self.dock_widget)
        
        self.dock_widget.show()