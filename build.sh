#!/bin/bash
set -e
echo "Building Meemz Cameo store..."
npm ci --omit=dev || npm install --omit=dev
echo "Build complete!"
