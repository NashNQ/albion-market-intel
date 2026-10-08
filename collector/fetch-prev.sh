#!/usr/bin/env bash
# Récupère le contenu actuel de la branche `data` dans le dossier donné (par défaut ./prev).
# Tolère l'absence de la branche (premier run) : le dossier est alors créé vide.
set -uo pipefail
DEST="${1:-prev}"
mkdir -p "$DEST"
if git fetch --depth=1 origin data 2>/dev/null; then
  git archive FETCH_HEAD | tar -x -C "$DEST"
  echo "Branche data récupérée dans $DEST : $(ls "$DEST" | tr '\n' ' ')"
else
  echo "Branche data absente : premier run, $DEST vide."
fi
