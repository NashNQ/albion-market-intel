#!/usr/bin/env bash
# Récupère le contenu actuel de la branche `data` dans le dossier donné (par défaut ./prev).
# Branche absente (premier run) → dossier vide. Erreur réseau → échec (exit 1), pour ne
# jamais republier des données vides par erreur.
set -euo pipefail
DEST="${1:-prev}"
mkdir -p "$DEST"
if ! REMOTE=$(git ls-remote --heads origin data); then
  echo "Erreur : impossible d'interroger origin (réseau ?)." >&2
  exit 1
fi
if [ -z "$REMOTE" ]; then
  echo "Branche data absente : premier run, $DEST vide."
  exit 0
fi
git fetch --depth=1 origin data
git archive FETCH_HEAD | tar -x -C "$DEST"
echo "Branche data récupérée dans $DEST : $(ls "$DEST" | tr '\n' ' ')"
