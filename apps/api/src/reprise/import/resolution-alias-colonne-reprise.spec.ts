import { describe, expect, it } from 'vitest';

import type { LigneTable } from '../lecteurs/types';
import {
  dateIsoParAlias,
  indexerColonnesLigne,
  texteParAlias,
  valeurParAlias,
} from './resolution-alias-colonne-reprise';

function ligne(valeurs: LigneTable['valeurs']): LigneTable {
  return { index: 0, valeurs };
}

describe('indexerColonnesLigne', () => {
  it('normalise la casse des clés (défaut réel du 26.08.2026 : casse Access préservée par mdb-export)', () => {
    const index = indexerColonnesLigne(ligne({ KundenNr: 'K-1', ChassisNr: 'VIN123' }));
    expect(index.get('kundennr')).toBe('K-1');
    expect(index.get('chassisnr')).toBe('VIN123');
  });

  it('la première colonne gagne en cas de collision de casse (jamais une exception)', () => {
    const index = indexerColonnesLigne(ligne({ Id: 'premier', id: 'second' }));
    expect(index.get('id')).toBe('premier');
  });
});

describe('texteParAlias', () => {
  it('essaie les alias dans l’ordre, rend le premier non vide', () => {
    const index = indexerColonnesLigne(ligne({ numero: '', kundennr: 'K-1' }));
    expect(texteParAlias(index, 'id', 'numero', 'kundennr')).toBe('K-1');
  });

  it('rend null si aucun alias ne résout', () => {
    const index = indexerColonnesLigne(ligne({ autre: 'valeur' }));
    expect(texteParAlias(index, 'id', 'numero')).toBeNull();
  });
});

describe('valeurParAlias', () => {
  it('rend la valeur brute, quel que soit son type (pas seulement du texte)', () => {
    const index = indexerColonnesLigne(ligne({ total_ttc: 150 }));
    expect(valeurParAlias(index, 'total_ttc')).toBe(150);
  });
});

describe('dateIsoParAlias — normalisation `jj.mm.aaaa`/`aaaa.mm.jj` (défaut réel du 26.08.2026)', () => {
  it('convertit `jj.mm.aaaa` (Lager.ErstIV réel) en ISO `aaaa-mm-jj`', () => {
    const index = indexerColonnesLigne(ligne({ erstiv: '15.03.2019' }));
    expect(dateIsoParAlias(index, 'erstiv')).toBe('2019-03-15');
  });

  it('convertit `aaaa.mm.jj` en ISO, distingué par le groupe à 4 chiffres', () => {
    const index = indexerColonnesLigne(ligne({ date_immatriculation: '2019.3.5' }));
    expect(dateIsoParAlias(index, 'date_immatriculation')).toBe('2019-03-05');
  });

  it('laisse une chaîne déjà ISO inchangée (sortie native `mdb-export -D %Y-%m-%d`)', () => {
    const index = indexerColonnesLigne(ligne({ plaque_du: '2021-06-15' }));
    expect(dateIsoParAlias(index, 'plaque_du')).toBe('2021-06-15');
  });

  it('convertit une `Date` native en ISO (moteur DBF/date native Access)', () => {
    const index = indexerColonnesLigne(ligne({ plaque_du: new Date(Date.UTC(2020, 0, 10)) }));
    expect(dateIsoParAlias(index, 'plaque_du')).toBe('2020-01-10');
  });

  it('rend le texte brut si le format ne correspond à rien de reconnu (jamais deviné à l’aveugle)', () => {
    const index = indexerColonnesLigne(ligne({ plaque_du: 'inconnu-2019' }));
    expect(dateIsoParAlias(index, 'plaque_du')).toBe('inconnu-2019');
  });

  it("n'inverse jamais jour/mois quand aucun groupe n'a 4 chiffres — rend le texte brut", () => {
    const index = indexerColonnesLigne(ligne({ plaque_du: '15.03.19' }));
    expect(dateIsoParAlias(index, 'plaque_du')).toBe('15.03.19');
  });

  it('rend null si aucun alias ne résout', () => {
    const index = indexerColonnesLigne(ligne({ autre: 'x' }));
    expect(dateIsoParAlias(index, 'plaque_du')).toBeNull();
  });
});
