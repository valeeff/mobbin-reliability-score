#!/bin/bash
# Replaces commit message if it matches the target
grep -q "stuff to publish extension" "$1" && echo "Chore: Add release assets and privacy policy" > "$1" || true
