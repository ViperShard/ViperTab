#!/usr/bin/env bash
# ViperTab release — bump per-edition versions, build all edition zips, push,
# and create a GitHub release.
#
# Usage:
#   ./release.sh                                     # patch bump ALL editions
#   ./release.sh patch "Notes"                       # patch bump ALL, with notes
#   ./release.sh minor "Notes"                       # minor bump ALL
#   ./release.sh major "Notes"                       # major bump ALL
#   ./release.sh 1.5.0 "Notes"                       # specific version, ALL
#   ./release.sh patch "Notes" main                  # patch bump ONLY ViperTab
#   ./release.sh patch "Notes" dev                   # patch bump ONLY ViperTab Dev
#   ./release.sh patch "Notes" student               # patch bump ONLY ViperTab Student
#   ./release.sh patch "Notes" main,dev              # bump multiple editions (comma-separated)
#
# Rules:
#   - Editions NOT in the bump list keep their current version (no auto-bump).
#   - A brand-new edition (no version yet in version.json) starts at 1.0.0
#     regardless of bump type.
#   - Every release uploads ALL THREE edition zips at their current versions,
#     so the "/releases/latest/download/<X>.zip" URL works for every edition.
#
# After the release, banner fires on installed copies on the next new tab.

set -euo pipefail
cd "$(dirname "$0")"

bump_arg="${1:-patch}"
notes="${2:-Update}"
edition_arg="${3:-all}"

PAGE_URL="https://vipershard.github.io/ViperTab/"
MAIN_ZIP_URL="https://github.com/ViperShard/ViperTab/releases/latest/download/ViperTab.zip"
DEV_ZIP_URL="https://github.com/ViperShard/ViperTab/releases/latest/download/ViperTabDev.zip"
STUDENT_ZIP_URL="https://github.com/ViperShard/ViperTab/releases/latest/download/ViperTabStudent.zip"
ZEN_ZIP_URL="https://github.com/ViperShard/ViperTab/releases/latest/download/ViperTabZen.zip"

ALL_EDITIONS=(main dev student zen)

# Parse edition arg into an array
declare -A BUMP_SET
case "$edition_arg" in
    all)
        for e in "${ALL_EDITIONS[@]}"; do BUMP_SET[$e]=1; done
        ;;
    *)
        IFS=',' read -r -a parts <<< "$edition_arg"
        for p in "${parts[@]}"; do
            p="${p// /}"
            if [[ ! " ${ALL_EDITIONS[*]} " =~ " ${p} " ]]; then
                echo "Unknown edition '$p'. Valid: ${ALL_EDITIONS[*]}, all, or comma-separated." >&2
                exit 1
            fi
            BUMP_SET[$p]=1
        done
        ;;
esac

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

# Read current version per edition. Missing edition -> empty string -> first release.
read_ver() {
    local ed="$1"
    local v
    v=$(jq -r ".editions.${ed}.version // \"\"" version.json 2>/dev/null || echo "")
    echo "$v"
}

declare -A CURRENT NEW
for ed in "${ALL_EDITIONS[@]}"; do
    CURRENT[$ed]=$(read_ver "$ed")
    if [[ -n "${BUMP_SET[$ed]:-}" ]]; then
        if [[ -z "${CURRENT[$ed]}" ]]; then
            # Brand-new edition: start at 1.0.0
            NEW[$ed]="1.0.0"
        else
            NEW[$ed]=$(bump_version "${CURRENT[$ed]}" "$bump_arg")
        fi
    else
        # Edition not being bumped — keep its current version (or fall back if
        # somehow missing in version.json, which shouldn't happen).
        NEW[$ed]="${CURRENT[$ed]:-1.0.0}"
    fi
done

echo "▶ Releasing"
for ed in "${ALL_EDITIONS[@]}"; do
    star=""
    [[ -n "${BUMP_SET[$ed]:-}" ]] && star=" *"
    printf "  %-8s %-7s → %-7s%s\n" "$ed" "${CURRENT[$ed]:-—}" "${NEW[$ed]}" "$star"
done
echo "  Notes: $notes"
read -r -p "  Proceed? [y/N] " ok
[[ "$ok" =~ ^[Yy]$ ]] || { echo "  Cancelled."; exit 1; }

# ---------- 1. Write version.json ----------
notes_json=$(jq -Rs . <<<"$notes")
cat > version.json <<EOF
{
  "version": "${NEW[main]}",
  "url": "$PAGE_URL",
  "notes": $notes_json,
  "editions": {
    "main": {
      "version": "${NEW[main]}",
      "url": "$MAIN_ZIP_URL",
      "notes": $notes_json
    },
    "dev": {
      "version": "${NEW[dev]}",
      "url": "$DEV_ZIP_URL",
      "notes": $notes_json
    },
    "student": {
      "version": "${NEW[student]}",
      "url": "$STUDENT_ZIP_URL",
      "notes": $notes_json
    },
    "zen": {
      "version": "${NEW[zen]}",
      "url": "$ZEN_ZIP_URL",
      "notes": $notes_json
    }
  }
}
EOF

# ---------- 2. Update manifest.json (main edition's version) ----------
if [[ -n "${BUMP_SET[main]:-}" ]]; then
    tmp=$(mktemp)
    jq --arg v "${NEW[main]}" '.version = $v' manifest.json > "$tmp" && mv "$tmp" manifest.json
fi

# ---------- 3. Build zips for ALL editions every release ----------
build_zip_with_patched_manifest() {
    local out_zip="$1" name="$2" desc="$3" version="$4"
    rm -f "$out_zip"
    local TMPDIR
    TMPDIR=$(mktemp -d)
    cp -r manifest.json newtab.html style.css script.js README.md version.json icons "$TMPDIR/"
    jq --arg n "$name" --arg d "$desc" --arg v "$version" \
       '.name = $n | .description = $d | .version = $v' \
       "$TMPDIR/manifest.json" > "$TMPDIR/manifest.json.new" \
       && mv "$TMPDIR/manifest.json.new" "$TMPDIR/manifest.json"
    ( cd "$TMPDIR" && zip -r "$OLDPWD/$out_zip" manifest.json newtab.html style.css script.js README.md version.json icons/ -q )
    rm -rf "$TMPDIR"
}

# Main: uses manifest.json directly (already patched above when main was bumped)
rm -f ViperTab.zip
zip -r ViperTab.zip manifest.json newtab.html style.css script.js README.md version.json icons/ -q

# Dev
build_zip_with_patched_manifest "ViperTabDev.zip" \
    "ViperTab Dev" \
    "Developer new tab. JWT decoder, hash generator, regex, JSON formatter, diff viewer, UUID, and Hacker News. Terminal aesthetic." \
    "${NEW[dev]}"

# Student
build_zip_with_patched_manifest "ViperTabStudent.zip" \
    "ViperTab Student" \
    "Student new tab page. Markdown notebook, school links, due dates calendar, GPA calculator, Pixabay search, Pomodoro timer and todo." \
    "${NEW[student]}"

# Zen
build_zip_with_patched_manifest "ViperTabZen.zip" \
    "ViperTab Zen" \
    "Minimalist new tab page. Giant centered clock, auto-hiding UI, black/white/gold palette with a customizable accent color." \
    "${NEW[zen]}"

# ---------- 4. Determine git tag ----------
bumped_count=${#BUMP_SET[@]}
if [[ "$bumped_count" -eq ${#ALL_EDITIONS[@]} ]]; then
    tag="v${NEW[main]}"  # all editions bumped together — typical "shared" release
elif [[ "$bumped_count" -eq 1 ]]; then
    only_ed=$(echo "${!BUMP_SET[@]}" | tr ' ' '\n' | head -n1)
    tag="v${NEW[$only_ed]}-${only_ed}"
else
    # Mixed bump — use main's version + suffix listing the bumped editions
    sorted=$(echo "${!BUMP_SET[@]}" | tr ' ' '\n' | sort | paste -sd-)
    tag="v${NEW[main]}-${sorted}"
fi

# ---------- 5. Commit, tag, push ----------
git add manifest.json version.json
git commit -m "Release $tag" || true
git tag "$tag"
git push origin main
git push origin "$tag"

# ---------- 6. Create GitHub release with all 4 edition zips ----------
gh release create "$tag" \
    ViperTab.zip ViperTabDev.zip ViperTabStudent.zip ViperTabZen.zip \
    --title "$tag" --notes "$notes"

echo ""
echo "✓ Released $tag"
for ed in "${ALL_EDITIONS[@]}"; do
    star=""
    [[ -n "${BUMP_SET[$ed]:-}" ]] && star=" (bumped)"
    printf "  %-8s v%s%s\n" "$ed" "${NEW[$ed]}" "$star"
done
echo ""
echo "  ViperTab:         $MAIN_ZIP_URL"
echo "  ViperTab Dev:     $DEV_ZIP_URL"
echo "  ViperTab Student: $STUDENT_ZIP_URL"
echo "  ViperTab Zen:     $ZEN_ZIP_URL"
echo "  Page:             $PAGE_URL"
