# Albion Market Intel (EU)

Classement en temps quasi réel des meilleures opérations de **raffinage** et de **craft** du serveur Europe d'Albion Online, par **profit net × quantité réellement vendable**, avec la route achat → production → vente.

Site : https://albion-market-intel.netlify.app

> Non affilié à Sandbox Interactive. Données : [Albion Online Data Project](https://www.albion-online-data.com/) (participatif) et [ao-bin-dumps](https://github.com/ao-data/ao-bin-dumps). Le site lit et analyse uniquement : il n'interagit jamais avec le jeu.

## Comment ça marche

```
GitHub Actions (gratuit)                    Netlify (plan Free)            Navigateur
 ├─ prices.yml   toutes les 15 min ─┐
 ├─ volumes.yml  toutes les 6 h  ───┼─► branche `data` ─► /data/* (proxy) ─► moteur de calcul
 └─ recipes.yml  chaque lundi    ───┘    market.json           site statique      + classements
                                         recipes.json
```

- **Aucun secret** : les workflows publient sur la branche orpheline `data` avec le `GITHUB_TOKEN` éphémère (un seul commit, forcé, pour ne pas gonfler le dépôt).
- **Aucun calcul serveur payant** : Netlify sert le site statique et réécrit `/data/*` vers `raw.githubusercontent.com/NashNQ/albion-market-intel/data/*`.
- **Calcul dans le navigateur** : les classements dépendent des réglages de chacun (premium, focus, bonus du jour…), stockés en `localStorage`.

## Formules

- RRR = bonus / (1 + bonus) ; bonus = 0,18 + 0,40 (ville de raffinage spécialisée) ou + 0,15 (ville de craft spécialisée, d'après `craftingmodifiers.json`) + 0,59 (focus) + bonus du jour.
- Coût / unité = (Σ qté × prix d'achat × (1 − RRR si l'ingrédient est remboursable) + valeur × 0,1125 × tarif / 100) / quantité produite.
- Revenu / unité = prix de vente × (1 − taxe − frais d'ordre) ; taxe 4 % (premium) ou 8 % ; frais d'ordre 2,5 % en mode « ordres ».
- Q = min(médiane des ventes/jour sur 7 j × part de marché, plafond) ; C = confiance 0,5–1 selon l'âge des prix et l'historique.
- **Score = profit × Q × C.** Le Black Market est classé à part (par profit, avec au moins une vente sur 7 j).

Périmètre (générateur v4) : raffinage, équipement @0–@4, consommables de **cuisine** et d'**alchimie** @0–@3 (bonus Caerleon / Brecilien, quantités produites 5–10 par craft), poids des objets dans `meta`.

Règles de données : prix à 0 ou daté `0001-01-01` = absent ; prix plus vieux que 6 h exclus (réglable) ; prix > 3× la moyenne 7 j (vente) ou < 1/3 (achat) = suspect, exclu.

## Développement

```bash
pnpm install
pnpm dev          # proxy /data vers la branche data publiée
pnpm test         # Vitest
pnpm typecheck
pnpm build
```

Collecte en local (l'API AODP doit être joignable) :

```bash
pnpm collect:recipes                 # → out/recipes.json
pnpm collect:prices -- --prev prev   # → out/prices-latest.json
pnpm collect:volumes -- --prev prev  # → out/volumes-latest.json
```

## Exploitation

| Symptôme | Cause probable | Action |
| --- | --- | --- |
| Bandeau rouge « collecte en retard » | Cron GitHub retardé ou workflow en échec | Onglet Actions du dépôt → relancer « Collect prices » (`Run workflow`) |
| Écran « Première collecte en cours » | La branche `data` n'existe pas encore | Lancer « Collect prices » à la main |
| Recettes fausses après un patch du jeu | `recipes.json` périmé | Lancer « Regenerate recipes » |
| Classements vides | Données toutes plus vieilles que l'âge maximum | Augmenter « Âge max des prix » dans Réglages |

Limites de l'API respectées : 150 requêtes/min et 250 par 5 min (plafonds officiels 180 et 300), gzip, User-Agent identifiant le projet.

## Structure

```
collector/   collecte (aodp.ts, prices.ts, volumes.ts, recipes.ts, store.ts, publish.sh)
src/engine/  calcul pur (RRR, coûts, routes, filtres, classement)
src/ui/      interface React (pages, composants, hooks de données)
tests/       Vitest (moteur, collecteur, recettes réelles, interface)
```
