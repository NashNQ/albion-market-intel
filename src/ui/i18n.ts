// Libellés français des catégories et sous-catégories de boutique (@shopcategory, @shopsubcategory1).
// Données générées à partir de l'audit des items (translations.json, 100 % des valeurs du périmètre).
// Repli : identifiant brut si une valeur inconnue apparaît.

export const CATEGORY_FR: Record<string, string> = {
  "armors": "Armures",
  "artefacts": "Artefacts",
  "bags": "Sacs",
  "capes": "Capes",
  "consumables": "Consommables",
  "crafting": "Artisanat",
  "gathering": "Équipement de récolte",
  "head": "Casques",
  "offhands": "Mains secondaires",
  "other": "Autres",
  "shoes": "Chaussures",
  "vanity": "Cosmétiques",
  "weapons": "Armes",
};

export const SUBCATEGORY_FR: Record<string, string> = {
  "accessoires_capes_avalon": "Capes avaloniennes",
  "accessoires_capes_brecilien": "Capes de Brecilien",
  "accessoires_capes_capes": "Capes",
  "arcanestaff": "Bâtons arcaniques",
  "armors": "Armures",
  "axe": "Haches",
  "bags": "Sacs",
  "booktype": "Tomes de sorts",
  "bow": "Arcs",
  "capes": "Capes",
  "cloth_armor": "Armures en tissu",
  "cloth_helmet": "Capuches en tissu",
  "cloth_shoes": "Sandales en tissu",
  "crossbow": "Arbalètes",
  "cursestaff": "Bâtons maudits",
  "dagger": "Dagues",
  "fiber": "Équipement de récolteur de fibres",
  "firestaff": "Bâtons de feu",
  "fish": "Équipement de pêcheur",
  "food": "Cuisine",
  "froststaff": "Bâtons de givre",
  "guilds": "Outils de guilde",
  "hammer": "Marteaux",
  "head": "Casques",
  "hide": "Équipement de dépeceur",
  "holystaff": "Bâtons sacrés",
  "knuckles": "Gantelets de combat",
  "leather_armor": "Armures en cuir",
  "leather_helmet": "Capuches en cuir",
  "leather_shoes": "Chaussures en cuir",
  "mace": "Masses",
  "naturestaff": "Bâtons de nature",
  "offhands": "Mains secondaires",
  "ore": "Équipement de mineur",
  "other": "Autres",
  "plate_armor": "Armures en plaques",
  "plate_helmet": "Casques en plaques",
  "plate_shoes": "Bottes en plaques",
  "potions": "Alchimie",
  "quarterstaff": "Bâtons de combat",
  "refinedresources": "Ressources raffinées",
  "resources": "Ressources brutes",
  "rock": "Équipement de tailleur de pierre",
  "satchels": "Sacoches",
  "shieldtype": "Boucliers",
  "shoes": "Chaussures",
  "spear": "Lances",
  "sword": "Épées",
  "tokens": "Jetons",
  "tomes": "Tomes",
  "torchtype": "Torches",
  "weapons": "Armes",
  "wood": "Équipement de bûcheron",
};

/** Libellé français d'une catégorie (@shopcategory), repli sur l'ID brut. */
export function categoryLabel(id: string | null | undefined): string {
  if (!id) return '—';
  return CATEGORY_FR[id] ?? CATEGORY_FR[id.toLowerCase()] ?? id;
}

/** Libellé français d'une sous-catégorie (@shopsubcategory1), repli sur l'ID brut. */
export function subcategoryLabel(id: string | null | undefined): string {
  if (!id) return '—';
  return SUBCATEGORY_FR[id] ?? SUBCATEGORY_FR[id.toLowerCase()] ?? id;
}
