#!/bin/bash

# Script to validate Rootstock YAML files
# Usage: ./validate-rootstock.sh <yaml-file>

set -euo pipefail

if [ $# -eq 0 ]; then
    echo "Usage: $0 <yaml-file>"
    exit 1
fi

YAML_FILE="$1"

if [ ! -f "$YAML_FILE" ]; then
    echo "Error: File '$YAML_FILE' not found"
    exit 1
fi

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "Error: python3 is required but not installed"
    exit 1
fi

# Convert YAML to JSON using Python
echo "Converting YAML to JSON..."
JSON_DATA=$(python3 -c "
import sys
import json
import yaml
from datetime import date, datetime

class DateTimeEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (date, datetime)):
            return obj.isoformat()
        return super().default(obj)

try:
    with open('$YAML_FILE', 'r') as f:
        data = yaml.safe_load(f)
    print(json.dumps(data, cls=DateTimeEncoder))
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
")

# Validate the JSON is not empty
if [ -z "$JSON_DATA" ]; then
    echo "Error: Failed to convert YAML to JSON"
    exit 1
fi

# Send to validation endpoint
echo "Validating with Rootstock API..."
RESPONSE=$(curl -s -w "\n%{http_code}" \
  'https://rsk.precog.com/greenhouse/api/v1/validate' \
  -H 'Accept: */*' \
  -H 'Accept-Language: en-US,en;q=0.9' \
  -H 'Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IlljYkgzMWlrX05la2g4MlVkUnJURSJ9.eyJodHRwczovL3ByZWNvZy5jb20vdGVuYW50IjoiZDVkMDExYmEtOTA3YS00MmQwLTkxZGItMGIyMDVjZWM4YzQzIiwiaHR0cHM6Ly9wcmVjb2cuY29tL2VtYWlsIjoiZGJhcnRob2xvbWV3QHByZWNvZy5jb20iLCJpc3MiOiJodHRwczovL2Rldi15cWN1bHVwOS51cy5hdXRoMC5jb20vIiwic3ViIjoiZ29vZ2xlLW9hdXRoMnwxMTYyODQwNjA5OTU4NjUxNzEyMjciLCJhdWQiOiJodHRwczovL3Jzay5wcmVjb2cuY29tIiwiaWF0IjoxNzY3MTMwMDU0LCJleHAiOjE3NjcyMTY0NTQsInNjb3BlIjoicnNrOnJlYWQgcnNrOndyaXRlIiwiYXpwIjoic3JrbTBvd0ZvM0I5alVyY09jUlRaQXVUa2lZYzZNUVQifQ.THeYZiZFhqXsfYOJlkvyjukY3rLvCGbXwtReuyYF6vEIShx8yTV_2x-3xTuHeZ1BdDLiBaJ39nECeOa9rA0w91SOFn1nEV6l1o74XhjTyerPK98tk9H3u9NvPeDARyhlnCHGt2Cny6PVDnBh8VuBk3gmBK-bjmzmC88GS9tGsdInDY9upbDdFbX-KJGRdzA6bFNOqmoMWgLhHyHGWr5vBPKhSTcP6iMZwUcYApzyONXj50Cz3hao-AzOfr-Lj0pnNyRf-QWwasAG-UQxT5goSY3_GrWTbh6B7llGNqv59xQPj_zL2Urm0PCRv6uG7FUnkr5r16px1rwC0ftjkRw_Cw' \
  -H 'Cache-Control: no-cache' \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://rsk.precog.com' \
  -H 'Pragma: no-cache' \
  --data-raw "$JSON_DATA")

# Extract status code and body
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo ""
echo "HTTP Status: $HTTP_CODE"
echo "Response:"
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"

# Exit with appropriate code
if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
    echo ""
    echo "✓ Validation successful"
    exit 0
else
    echo ""
    echo "✗ Validation failed"
    exit 1
fi
