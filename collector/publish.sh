#!/usr/bin/env bash
# Publie les 4 fichiers de données sur la branche orpheline `data` en UN SEUL commit (push --force).
# Usage : collector/publish.sh <dossier_source> <message>
# Variables requises : GITHUB_TOKEN (jeton éphémère du workflow), GITHUB_REPOSITORY (owner/repo).
# Aucun secret n'est écrit sur disque ni affiché.
set -euo pipefail

SRC="${1:-out}"
MSG="${2:-data: update}"
FILES=(market.json recipes.json volumes-latest.json prices-latest.json)

: "${GITHUB_TOKEN:?GITHUB_TOKEN manquant}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY manquant}"

PUB="$(mktemp -d)"
trap 'rm -rf "$PUB"' EXIT

for f in "${FILES[@]}"; do
  if [ -f "$SRC/$f" ]; then
    cp "$SRC/$f" "$PUB/$f"
  else
    echo "::warning::$f absent de $SRC, non publié"
  fi
done

if [ ! -f "$PUB/market.json" ] && [ ! -f "$PUB/recipes.json" ]; then
  echo "::error::Rien à publier (ni market.json ni recipes.json)"
  exit 1
fi

cd "$PUB"
git init -q -b data
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A
git commit -q -m "$MSG"
git push -q --force "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" data:data
echo "Publié sur la branche data : $(ls | tr '\n' ' ')"
