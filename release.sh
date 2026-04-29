#!/usr/bin/env bash
# ViperTab release — bump version, zip, push, and create a GitHub release in one go.
#
# Usage:
#   ./release.sh                       # patch bump, generic notes
#   ./release.sh patch "Bug fix"
#   ./release.sh minor "New feature"
#   ./release.sh major "Big rework"
#   ./release.sh 1.5.0 "Specific version"
#
# After this completes, every installed copy will see the update banner on
# their next new tab.

set -euo pipefail
cd "$(dirname "$0")"

bump_arg="${1:-patch}"
notes="${2:-Update}"

current=$(jq -r .version manifest.json)

if [[ "$bump_arg" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    new="$bump_arg"
else
    IFS=. read -r MAJ MIN PAT <<< "$current"
    case "$bump_arg" in
        major) new="$((MAJ+1)).0.0" ;;
        minor) new="$MAJ.$((MIN+1)).0" ;;
        patch|*) new="$MAJ.$MIN.$((PAT+1))" ;;
    esac
fi

echo "▶ Releasing v$current → v$new"
echo "  Notes: $notes"
read -r -p "  Proceed? [y/N] " ok
[[ "$ok" =~ ^[Yy]$ ]] || { echo "  Cancelled."; exit 1; }

# 1. Bump versions in-place
tmp=$(mktemp)
jq --arg v "$new" '.version = $v' manifest.json > "$tmp" && mv "$tmp" manifest.json

cat > version.json <<EOF
{
  "version": "$new",
  "url": "https://vipershard.github.io/ViperTab/",
  "notes": $(jq -Rs . <<<"$notes")
}
EOF

# 2. Build zip (excludes dev files, just the loadable extension)
rm -f ViperTab.zip
zip -r ViperTab.zip manifest.json newtab.html style.css script.js README.md version.json icons/ -q

# 3. Commit, tag, push
git add manifest.json version.json
git commit -m "Release v$new" || true
git tag "v$new"
git push origin main
git push origin "v$new"

# 4. GitHub release with the zip attached
gh release create "v$new" ViperTab.zip --title "v$new" --notes "$notes"

echo ""
echo "✓ Released v$new"
echo "  Download: https://github.com/ViperShard/ViperTab/releases/latest/download/ViperTab.zip"
echo "  Page:     https://vipershard.github.io/ViperTab/"
echo "  Banner will appear on installed copies within seconds."
