#!/bin/bash
set -e

ZIP_FILE="mobbin-reliability-score.zip"

# Remove existing zip
rm -f "$ZIP_FILE"

echo "Creating extension package: $ZIP_FILE"

# Optional: clean macOS junk in repo (won't fail build if none found)
find . -name ".DS_Store" -delete 2>/dev/null || true
find . -name "__MACOSX" -type d -prune -exec rm -rf {} + 2>/dev/null || true

# Zip ONLY the files/folders strictly required for the extension (allowlist)
# + Exclude macOS junk and non-runtime marketing assets
zip -r "$ZIP_FILE" \
  manifest.json \
  background \
  content \
  icons \
  images \
  popup \
  utils \
  -x "**/.DS_Store" \
  -x "**/__MACOSX/*" \
  -x "images/*.mp4" \
  -x "images/promotional_*" \
  -x "images/screenshot_*" \
  -x "images/cover_*"

echo "Package created successfully: $ZIP_FILE"
echo "Done. Quick check:"
unzip -l "$ZIP_FILE" | grep -E "DS_Store|__MACOSX|tests/|google_play_sample|\.mp4" || echo "✅ Clean package"
