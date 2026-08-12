/**
 * Contrats du domaine Véhicules — pour l'instant, uniquement le référentiel suisse ASTRA/TAS
 * (autocomplétion marque/modèle). Les contrats de la fiche véhicule elle-même
 * (`vehicule.creer`/`modifier`/etc.) vivent encore dans `atelier/vehicule.ts` et
 * `ventes/vehicule-stock.ts` (périmètres d'autres livraisons, non déplacés ici) — voir la note de
 * livraison de ce fichier pour le signalement.
 *
 * Point d'entrée unique du domaine, même règle que les autres `contrats/<domaine>/index.ts` :
 * tout ce qui est exporté ici est GELÉ au nom près et à la signature près une fois validé par
 * l'orchestrateur.
 */

export * from './referentiel-vehicules-ch';
