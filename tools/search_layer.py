import sys
import json
from qgis.core import (
    QgsApplication,
    QgsProject,
    QgsExpression,
    QgsFeatureRequest
)

# Initialize QGIS Application
QgsApplication.setPrefixPath("/path/to/qgis", True)
qgs = QgsApplication([], False)
qgs.initQgis()

# Load arguments
layer_name = sys.argv[1]
expression_str = sys.argv[2]

# Load QGIS project
project = QgsProject.instance()
project_path = "/path/to/your/project.qgz"  # Update with the actual project path
project.read(project_path)

# Find the layer
layer = project.mapLayersByName(layer_name)
if not layer:
    print(json.dumps({"error": f"Layer '{layer_name}' not found."}))
    qgs.exitQgis()
    sys.exit(1)

layer = layer[0]

# Prepare the expression
expression = QgsExpression(expression_str)
if not expression.isValid():
    print(json.dumps({"error": "Invalid expression."}))
    qgs.exitQgis()
    sys.exit(1)

# Execute the query
results = []
request = QgsFeatureRequest(expression)
for feature in layer.getFeatures(request):
    results.append({
        "geometry": feature.geometry().asWkt(),
        **feature.attributes()
    })

# Output results as JSON
print(json.dumps(results))

# Exit QGIS
qgs.exitQgis()