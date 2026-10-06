#!/bin/bash
set -e
pnpm install --frozen-lockfile
requirements=$(mktemp)
trap 'rm -f "$requirements"' EXIT
uv export --frozen --no-dev --no-emit-project --format requirements-txt --output-file "$requirements"
python_version=$(python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
uv pip install --python "$(command -v python)" --target ".pythonlibs/lib/python${python_version}/site-packages" --require-hashes -r "$requirements"
pnpm --filter @workspace/db run push
