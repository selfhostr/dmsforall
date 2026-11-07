/**
 * Hauteur partagée du bloc du garage (tête de la barre latérale) et de la rangée d'onglets du
 * domaine (tête de la zone principale) : 44 px de cible tactile + 1 px de filet. Les deux
 * composants lisent ce seul jeton : leurs filets horizontaux se prolongent. Classes littérales :
 * Tailwind ne les trouve que telles quelles dans les sources.
 */
export const HAUTEUR_ENTETE_COLONNE = 'h-[calc(var(--cible-tactile)+1px)]';
export const HAUTEUR_MIN_ENTETE_COLONNE = 'min-h-[calc(var(--cible-tactile)+1px)]';
