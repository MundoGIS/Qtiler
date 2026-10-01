# -*- coding: utf-8 -*-
# Qtiler Connector
# Copyright (C) 2026 MundoGIS
# SPDX-License-Identifier: GPL-2.0-or-later

def classFactory(iface):
    from .qtiler_connector import QtilerConnector
    return QtilerConnector(iface)