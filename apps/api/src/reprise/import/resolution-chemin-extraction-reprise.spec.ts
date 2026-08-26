import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { rebaserCheminFichierExtractionReprise } from './resolution-chemin-extraction-reprise';

/**
 * Preuve du rebasage — défaut réel du 26.08.2026 (§ tête de fichier) : `fichierChemin` persisté
 * par l'analyse pointe un répertoire d'extraction déjà purgé ; l'import doit le rattacher à SON
 * PROPRE répertoire d'extraction, fraîchement créé, avant tout `lireLignes`.
 */
describe('rebaserCheminFichierExtractionReprise', () => {
  const racine = join(sep, 'app', 'uploads', 'reprise-extraction');

  it('retranche l’ancien sous-répertoire d’extraction et recolle sous le nouveau', () => {
    const ancien = join(racine, 'extrait-abc123', 'KUNDEN.dbf');
    const nouveauRepertoire = join(racine, 'extrait-xyz789');

    const resultat = rebaserCheminFichierExtractionReprise(ancien, nouveauRepertoire);

    expect(resultat).toBe(join(nouveauRepertoire, 'KUNDEN.dbf'));
  });

  it('préserve les sous-dossiers internes à l’archive (structure imbriquée)', () => {
    const ancien = join(racine, 'extrait-abc123', 'DATA', 'KUNDEN.dbf');
    const nouveauRepertoire = join(racine, 'extrait-xyz789');

    const resultat = rebaserCheminFichierExtractionReprise(ancien, nouveauRepertoire);

    expect(resultat).toBe(join(nouveauRepertoire, 'DATA', 'KUNDEN.dbf'));
  });

  it('fonctionne pour un chemin persisté il y a longtemps — ne dépend que de la racine partagée, jamais d’un suffixe précis', () => {
    const ancienDeSemaines = join(racine, 'extrait-tresvieux', 'sous', 'FACTURES.DBF');
    const nouveauRepertoire = join(racine, 'extrait-tout-frais');

    const resultat = rebaserCheminFichierExtractionReprise(ancienDeSemaines, nouveauRepertoire);

    expect(resultat).toBe(join(nouveauRepertoire, 'sous', 'FACTURES.DBF'));
  });

  it('rend null si le chemin persisté est hors de la racine partagée du répertoire courant', () => {
    const ailleurs = join(sep, 'autre', 'racine', 'extrait-abc123', 'KUNDEN.dbf');
    const nouveauRepertoire = join(racine, 'extrait-xyz789');

    expect(rebaserCheminFichierExtractionReprise(ailleurs, nouveauRepertoire)).toBeNull();
  });

  it('rend null si le chemin persisté est la racine partagée elle-même (aucun fichier)', () => {
    expect(
      rebaserCheminFichierExtractionReprise(racine, join(racine, 'extrait-xyz789')),
    ).toBeNull();
  });

  it('rend null si le chemin persisté est le sous-répertoire d’extraction lui-même, sans fichier', () => {
    const ancienRepertoireSeul = join(racine, 'extrait-abc123');
    expect(
      rebaserCheminFichierExtractionReprise(ancienRepertoireSeul, join(racine, 'extrait-xyz789')),
    ).toBeNull();
  });

  it('deux fichiers différents du même ancien répertoire rebasent vers deux fichiers différents du nouveau', () => {
    const nouveauRepertoire = join(racine, 'extrait-xyz789');
    const a = rebaserCheminFichierExtractionReprise(
      join(racine, 'extrait-abc123', 'KUNDEN.dbf'),
      nouveauRepertoire,
    );
    const b = rebaserCheminFichierExtractionReprise(
      join(racine, 'extrait-abc123', 'FAHRZEUG.dbf'),
      nouveauRepertoire,
    );

    expect(a).toBe(join(nouveauRepertoire, 'KUNDEN.dbf'));
    expect(b).toBe(join(nouveauRepertoire, 'FAHRZEUG.dbf'));
    expect(a).not.toBe(b);
  });
});
