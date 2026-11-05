/**
 * Contrats de l'étape 4 — Ventes de véhicules neufs et d'occasion (VN/VO), reprise, financement,
 * frais annexes, livraison.
 *
 * Point d'entrée unique du domaine, même règle que `contrats/atelier/index.ts`,
 * `contrats/facturation/index.ts` et `contrats/pieces/index.ts` : tout ce qui est exporté ici est
 * GELÉ au nom près et à la signature près une fois validé par le mainteneur. Un écart nécessaire
 * se remonte, il ne se code pas « en attendant ».
 *
 * NOTE DE PÉRIMÈTRE — ce qui N'EST PAS dans ce fichier, volontairement :
 *  - **Les frais annexes** (plaques, MFK, garantie étendue, préparation, immatriculation) — pas un
 *    objet de données à part (§8.5 de la spécification, littéral) : ce sont des `ligne_document`
 *    typées sur le document de vente existant. Un futur `type_ligne_document` étendu pour les
 *    distinguer dans les rapports (`RV-46`) appartient au propriétaire de
 *    `contrats/facturation/enums.ts`, pas à ce domaine.
 *  - **Le paramétrage tenant** (`PV-01` → `PV-08` : seuil de jours de stock, acompte par défaut,
 *    check-list de livraison, ventilation des frais annexes…) — aucun fichier `parametrage.ts` de
 *    ce domaine n'a encore été écrit, contrairement à `pieces/parametrage.ts`. Priorité fixée par
 *    le mainteneur à véhicule en stock / dossier de vente / reprise / recherche ; le paramétrage
 *    reste un gap connu, pas un oubli silencieux.
 *
 * Règle de compatibilité opposable à toute revue future, reprise à l'identique des autres
 * domaines : un client de cette API doit ignorer les champs qu'il ne connaît pas et ne doit jamais
 * échouer sur une valeur d'enum inconnue.
 */

export * from './enums';
export * from './vehicule-stock';
export * from './reprise';
export * from './financement';
export * from './dossier-vente';
export * from './suivi';
