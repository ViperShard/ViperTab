#!/usr/bin/env bash
# ViperTab release — bump per-edition versions, build zip(s), push, and create a GitHub release.
#
# Usage:
#   ./release.sh                                   # patch bump BOTH editions, generic notes
#   ./release.sh patch "Notes"                     # patch bump BOTH, with notes
#   ./release.sh minor "Notes"                     # minor bump BOTH
#   ./release.sh major "Notes"                     # major bump BOTH
#   ./release.sh 1.5.0 "Notes"                     # specific version, BOTH
#   ./release.sh patch "Notes" dev                 # patch bump ONLY ViperTab Dev
#   ./release.sh patch "Notes" main                # patch bump ONLY ViperTab (main)
#   ./release.sh patch "Notes" both                # explicit "both" (same as default)
#
# After this completes, every installed copy will see a banner on the next new tab.
# The banner is edition-aware:
#   - if YOUR edition was bumped: "ViperTab[ Dev] vX.Y.Z available"
#   - if only the OTHER edition was bumped: "New ViperTab[ Dev] vX.Y.Z dropped — try it"

set -euo pipefail
cd "$(dirname "$0")"

bump_arg="${1:-patch}"
notes="${2:-Update}"
edition_arg="${3:-both}"

if [[ "$edition_arg" != "main" && "$edition_arg" != "dev" && "$edition_arg" != "both" ]]; then
    echo "Edition must be: main | dev | both" >&2
    exit 1
fi

PAGE_URL="https://vipershard.github.io/ViperTab/"
MAIN_ZIP_URL="https://github.com/ViperShard/ViperTab/releases/latest/download/ViperTab.zip"
DEV_ZIP_URL="https://github.com/ViperShard/ViperTab/releases/latest/download/ViperTabDev.zip"

# Read current per-edition versions, falling back to legacy flat schema
currentMain=$(jq -r '.editions.main.version // .version // "0.0.0"' version.json)
currentDev=$(jq -r '.editions.dev.version  // .version // "0.0.0"' version.json)

bump_version() {
    local current="$1" bump="$2"
    if [[ "$bump" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then echo "$bump"; return; fi
    IFS=. read -r MAJ MIN PAT <<< "$current"
    case "$bump" in
        major) echo "$((MAJ+1)).0.0" ;;
        minor) echo "$MAJ.$((MIN+1)).0" ;;
        patch|*) echo "$MAJ.$MIN.$((PAT+1))" ;;
    esac
}

newMain="$currentMain"
newDev="$currentDev"
[[ "$edition_arg" == "main" || "$edition_arg" == "both" ]] && newMain=$(bump_version "$currentMain" "$bump_arg")
[[ "$edition_arg" == "dev"  || "$edition_arg" == "both" ]] && newDev=$(bump_version  "$currentDev"  "$bump_arg")

echo "▶ Releasing (edition: $edition_arg)"
echo "  Main: $currentMain → $newMain"
echo "  Dev:  $currentDev → $newDev"
echo "  Notes: $notes"
read -r -p "  Proceed? [y/N] " ok
[[ "$ok" =~ ^[Yy]$ ]] || { echo "  Cancelled."; exit 1; }

# 1. Write version.json with per-edition fields (and a legacy top-level mirror of main for older clients)
notes_json=$(jq -Rs . <<<"$notes")
cat > version.json <<EOF
{
  "version": "$newMain",
  "url": "$PAGE_URL",
  "notes": $notes_json,
  "editions": {
    "main": {
      "version": "$newMain",
      "url": "$MAIN_ZIP_URL",
      "notes": $notes_json
    },
    "dev": {
      "version": "$newDev",
      "url": "$DEV_ZIP_URL",
      "notes": $notes_json
    }
  }
}
EOF

# 2. Update manifest.json (only when main is being bumped — that's the file the main edition loads)
if [[ "$edition_arg" == "main" || "$edition_arg" == "both" ]]; then
    tmp=$(mktemp)
    jq --arg v "$newMain" '.version = $v' manifest.json > "$tmp" && mv "$tmp" manifest.json
fi

# 3. Build main edition zip when main is bumped
if [[ "$edition_arg" == "main" || "$edition_arg" == "both" ]]; then
    rm -f ViperTab.zip
    zip -r ViperTab.zip manifest.json newtab.html style.css script.js README.md version.json icons/ -q
fi

# 4. Build dev edition zip when dev is bumped (patches manifest with dev name + dev version)
if [[ "$edition_arg" == "dev" || "$edition_arg" == "both" ]]; then
    rm -f ViperTabDev.zip
    TMPDIR=$(mktemp -d)
    cp -r manifest.json newtab.html style.css script.js README.md version.json icons "$TMPDIR/"
    jq --arg v "$newDev" \
       '.name = "ViperTab Dev" |
        .description = "ViperTab — Dev edition. Multi-tab scratchpad code editor, JWT decoder, hash generator (SHA-1/256/384/512), line-by-line diff viewer, regex tester, JSON formatter, encoders, timestamps, UUID, Hacker News — every essential dev utility one new tab away." |
        .version = $v' \
       "$TMPDIR/manifest.json" > "$TMPDIR/manifest.json.new" && mv "$TMPDIR/manifest.json.new" "$TMPDIR/manifest.json"
    ( cd "$TMPDIR" && zip -r "$OLDPWD/ViperTabDev.zip" manifest.json newtab.html style.css script.js README.md version.json icons/ -q )
    rm -rf "$TMPDIR"
fi

# 5. Determine git tag
case "$edition_arg" in
    both) tag="v$newMain" ;;
    main) tag="v$newMain-main" ;;
    dev)  tag="v$newDev-dev" ;;
esac

# 6. Commit, tag, push
git add manifest.json version.json
git commit -m "Release $tag" || true
git tag "$tag"
git push origin main
git push origin "$tag"

# 7. Build asset list and create GitHub release
assets=()
[[ "$edition_arg" == "main" || "$edition_arg" == "both" ]] && assets+=(ViperTab.zip)
[[ "$edition_arg" == "dev"  || "$edition_arg" == "both" ]] && assets+=(ViperTabDev.zip)

gh release create "$tag" "${assets[@]}" --title "$tag" --notes "$notes"

echo ""
echo "✓ Released $tag (edition: $edition_arg)"
echo "  Main: $newMain"
echo "  Dev:  $newDev"
echo "  Banner will fire on installed copies within seconds."
echo ""
echo "  ViperTab:     $MAIN_ZIP_URL"
echo "  ViperTab Dev: $DEV_ZIP_URL"
echo "  Page:         $PAGE_URL"
