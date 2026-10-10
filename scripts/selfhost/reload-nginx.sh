#!/usr/bin/env bash
set -euo pipefail
/usr/bin/nginx -t
/usr/bin/nginx -s reload
