/**
 * Vérification que les namespaces sont correctement enregistrés dans `index.ts`
 * et réellement chargeable via l'instance i18n.
 *
 * Le piège documenté en CONTRIBUTING.md : un namespace entier peut exister sur disque (fichiers .json
 * à parité stricte FR/DE/IT, 0 défaut selon `pnpm i18n:check`) et RESTER TOTALEMENT
 * INUTILISABLE à l'exécution parce que les trois étapes d'enregistrement manquent dans `index.ts` :
 *  1. imports du fichier ;
 *  2. ajout à NAMESPACES[] ;
 *  3. ajout aux ressources pour chaque langue.
 *
 * `pnpm i18n:check` ne détecte JAMAIS ce défaut : il compare les ensembles de clés entre langues
 * (la parité est parfaite puisqu'un namespace entier manque), donc il passe au vert alors qu'aucune
 * clé n'est chargeable. Seule la CHARGE RÉELLE via i18next le révèle — c'est ce que ce test fait.
 *
 * Si ce test rougit, c'est que l'enregistrement a échoué quelque part. Les trois fichiers JSON
 * sont bien formés, mais le test de charge prouve que l'i18n ne peut pas les servir à l'exécution.
 */
import { describe, it, expect } from 'vitest';
import i18next from './index';

/**
 * `returnNull: false` (config d'`index.ts`) retourne la clé elle-même si non trouvée.
 * Ce test cherche UNE CLÉ RÉELLEMENT EXISTANTE et s'attend à ce qu'elle soit
 * traduite (chaîne != clé demandée). Pas de piège sur des clés qui n'existent pas
 * — on teste la charge RÉELLE des clés VALIDES.
 */
describe('Enregistrement des namespaces dans i18next', () => {
  it('le namespace "pieces" est chargeable et traduit en FR', () => {
    const cle = 'pieces:titre';
    const resultat = i18next.t(cle, { lng: 'fr' });
    expect(resultat).toBe('Pièces');
    expect(resultat).not.toBe(cle);
  });

  it('le namespace "pieces" est chargeable et traduit en DE', () => {
    const cle = 'pieces:titre';
    const resultat = i18next.t(cle, { lng: 'de' });
    expect(resultat).toBe('Teile');
    expect(resultat).not.toBe(cle);
  });

  it('le namespace "pieces" est chargeable et traduit en IT', () => {
    const cle = 'pieces:titre';
    const resultat = i18next.t(cle, { lng: 'it' });
    expect(resultat).toBe('Ricambi');
    expect(resultat).not.toBe(cle);
  });

  it('le namespace "pointage" est chargeable et traduit en FR', () => {
    const cle = 'pointage:titre';
    const resultat = i18next.t(cle, { lng: 'fr' });
    expect(resultat).toBe('Pointage');
    expect(resultat).not.toBe(cle);
  });

  it('le namespace "pointage" est chargeable et traduit en DE', () => {
    const cle = 'pointage:titre';
    const resultat = i18next.t(cle, { lng: 'de' });
    expect(resultat).toBe('Zeiterfassung');
    expect(resultat).not.toBe(cle);
  });

  it('le namespace "pointage" est chargeable et traduit en IT', () => {
    const cle = 'pointage:titre';
    const resultat = i18next.t(cle, { lng: 'it' });
    expect(resultat).toBe('Timbratura');
    expect(resultat).not.toBe(cle);
  });

  /**
   * Clés spécifiques ajoutées durant cette vague :
   * `anomalies.motifs.deriveHorloge` pour le pointage (lot 2).
   */
  it('anomalies.motifs.deriveHorloge existe en FR', () => {
    const cle = 'pointage:anomalies.motifs.deriveHorloge';
    const resultat = i18next.t(cle, { lng: 'fr' });
    expect(resultat).toBe('Horloge décalée');
    expect(resultat).not.toBe(cle);
  });

  it('anomalies.motifs.deriveHorloge existe en DE', () => {
    const cle = 'pointage:anomalies.motifs.deriveHorloge';
    const resultat = i18next.t(cle, { lng: 'de' });
    expect(resultat).toBe('Uhr abweichend');
    expect(resultat).not.toBe(cle);
  });

  it('anomalies.motifs.deriveHorloge existe en IT', () => {
    const cle = 'pointage:anomalies.motifs.deriveHorloge';
    const resultat = i18next.t(cle, { lng: 'it' });
    expect(resultat).toBe('Orologio disallineato');
    expect(resultat).not.toBe(cle);
  });

  /**
   * Quelques clés du namespace "pieces" pour vérifier la couverture complète.
   */
  it('pieces.articles.statuts.actif est traduit en FR', () => {
    const cle = 'pieces:articles.statuts.actif';
    const resultat = i18next.t(cle, { lng: 'fr' });
    expect(resultat).toBe('Actif');
  });

  it('pieces.articles.statuts.actif est traduit en DE', () => {
    const cle = 'pieces:articles.statuts.actif';
    const resultat = i18next.t(cle, { lng: 'de' });
    expect(resultat).toBe('Aktiv');
  });

  it('pieces.articles.statuts.actif est traduit en IT', () => {
    const cle = 'pieces:articles.statuts.actif';
    const resultat = i18next.t(cle, { lng: 'it' });
    expect(resultat).toBe('Attivo');
  });

  it('pieces.categories.piece_mecanique est traduit en FR', () => {
    const cle = 'pieces:articles.categories.piece_mecanique';
    const resultat = i18next.t(cle, { lng: 'fr' });
    expect(resultat).toBe('Pièce mécanique');
  });

  it('pieces.categories.piece_mecanique est traduit en DE', () => {
    const cle = 'pieces:articles.categories.piece_mecanique';
    const resultat = i18next.t(cle, { lng: 'de' });
    expect(resultat).toBe('Motorenteil');
  });

  it('pieces.categories.piece_mecanique est traduit en IT', () => {
    const cle = 'pieces:articles.categories.piece_mecanique';
    const resultat = i18next.t(cle, { lng: 'it' });
    expect(resultat).toBe('Ricambio motore');
  });
});
