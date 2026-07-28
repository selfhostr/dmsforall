import { describe, expect, it } from 'vitest';
import type {
  LigneClient,
  LigneClientAdresse,
  LigneClientCondition,
  LigneClientConsentement,
  LigneClientContact,
  LigneClientNote,
} from '../db/schema';
import {
  calculerNomAffiche,
  versAdresseResponse,
  versClientResponse,
  versClientResume,
  versConditionResponse,
  versConsentementResponse,
  versContactResponse,
  versNoteResponse,
} from './mappers';

function ligneClient(champs: Partial<LigneClient> = {}): LigneClient {
  return {
    id: 'c1',
    tenantId: 'tid',
    numero: 'CL-000001',
    type: 'particulier',
    civilite: null,
    nom: 'Dupont',
    prenom: 'Jean',
    raisonSociale: null,
    ide: null,
    langue: 'fr',
    email: null,
    telephone: null,
    telephoneE164: null,
    canalPrefere: null,
    statut: 'actif',
    poObligatoire: false,
    groupeClientId: null,
    fusionneVersClientId: null,
    referenceExterne: null,
    creeLe: new Date('2026-01-01T00:00:00.000Z'),
    modifieLe: new Date('2026-07-27T09:14:22.000Z'),
    ...champs,
  } as LigneClient;
}

describe('calculerNomAffiche — raisonSociale prime toujours (client_identite_chk)', () => {
  it('une entreprise affiche sa raison sociale', () => {
    expect(
      calculerNomAffiche({ raisonSociale: 'Garage Martin SA', nom: null, prenom: null }),
    ).toBe('Garage Martin SA');
  });

  it('un particulier affiche "nom prénom"', () => {
    expect(calculerNomAffiche({ raisonSociale: null, nom: 'Dupont', prenom: 'Jean' })).toBe('Dupont Jean');
  });

  it('un particulier sans prénom affiche seulement le nom', () => {
    expect(calculerNomAffiche({ raisonSociale: null, nom: 'Dupont', prenom: null })).toBe('Dupont');
  });

  it('raisonSociale et nom présents ensemble : raisonSociale prime (jamais recomposé côté client)', () => {
    expect(
      calculerNomAffiche({ raisonSociale: 'Garage Martin SA', nom: 'Dupont', prenom: 'Jean' }),
    ).toBe('Garage Martin SA');
  });
});

describe('versClientResponse', () => {
  it('projette toutes les dates en ISO et calcule nomAffiche', () => {
    const dto = versClientResponse(ligneClient(), null);
    expect(dto.creeLe).toBe('2026-01-01T00:00:00.000Z');
    expect(dto.modifieLe).toBe('2026-07-27T09:14:22.000Z');
    expect(dto.nomAffiche).toBe('Dupont Jean');
    expect(dto.numeroClient).toBe('CL-000001');
  });

  it('dernierPassageLe null (client sans OR) est rendu null, jamais absent', () => {
    const dto = versClientResponse(ligneClient(), null);
    expect(dto.dernierPassageLe).toBeNull();
  });

  it('dernierPassageLe fourni est projeté en ISO', () => {
    const dto = versClientResponse(ligneClient(), new Date('2026-05-10T08:00:00.000Z'));
    expect(dto.dernierPassageLe).toBe('2026-05-10T08:00:00.000Z');
  });

  it('fusionneVersClientId est propagé tel quel', () => {
    const dto = versClientResponse(ligneClient({ fusionneVersClientId: 'c-absorbant' }), null);
    expect(dto.fusionneVersClientId).toBe('c-absorbant');
  });
});

describe('versClientResume', () => {
  it('ne projette que les champs de synthèse, avec nomAffiche calculé', () => {
    const resume = versClientResume(ligneClient({ raisonSociale: null, nom: 'Muster', prenom: 'Hans' }));
    expect(resume).toEqual({
      id: 'c1',
      numeroClient: 'CL-000001',
      nomAffiche: 'Muster Hans',
      type: 'particulier',
      statut: 'actif',
      langueCorrespondance: 'fr',
      poObligatoire: false,
    });
  });
});

describe('versAdresseResponse', () => {
  function ligneAdresse(champs: Partial<LigneClientAdresse> = {}): LigneClientAdresse {
    return {
      id: 'a1',
      tenantId: 'tid',
      clientId: 'c1',
      type: 'principale',
      rue: 'Rue du Lac 1',
      complement: null,
      npa: '1000',
      localite: 'Lausanne',
      pays: 'CH',
      actif: true,
      creeLe: new Date('2026-01-01T00:00:00.000Z'),
      modifieLe: new Date('2026-01-01T00:00:00.000Z'),
      ...champs,
    } as LigneClientAdresse;
  }

  it('coalesce rue/npa/localite null vers chaîne vide plutôt que de rendre null', () => {
    const dto = versAdresseResponse(ligneAdresse({ rue: null, npa: null, localite: null }));
    expect(dto.rue).toBe('');
    expect(dto.npa).toBe('');
    expect(dto.localite).toBe('');
  });

  it('complement reste null quand absent (pas de coalescence)', () => {
    const dto = versAdresseResponse(ligneAdresse({ complement: null }));
    expect(dto.complement).toBeNull();
  });
});

describe('versContactResponse', () => {
  function ligneContact(champs: Partial<LigneClientContact> = {}): LigneClientContact {
    return {
      id: 'ct1',
      tenantId: 'tid',
      clientId: 'c1',
      nom: 'Directeur',
      prenom: null,
      fonction: null,
      telephone: null,
      telephoneE164: null,
      email: null,
      langue: null,
      roles: ['facturation'],
      actif: true,
      creeLe: new Date('2026-01-01T00:00:00.000Z'),
      modifieLe: new Date('2026-01-01T00:00:00.000Z'),
      ...champs,
    } as LigneClientContact;
  }

  it('coalesce nom null vers chaîne vide', () => {
    const dto = versContactResponse(ligneContact({ nom: null }));
    expect(dto.nom).toBe('');
  });

  it('propage les rôles tels quels', () => {
    const dto = versContactResponse(ligneContact({ roles: ['comptabilite', 'signataire'] }));
    expect(dto.roles).toEqual(['comptabilite', 'signataire']);
  });
});

describe('versConditionResponse — RM-07 conditions datées', () => {
  function ligneCondition(champs: Partial<LigneClientCondition> = {}): LigneClientCondition {
    return {
      id: 'cd1',
      tenantId: 'tid',
      clientId: 'c1',
      rabaisMoPourmille: null,
      rabaisPiecesPourmille: null,
      rabaisPneusPourmille: null,
      tauxHoraireCode: null,
      delaiPaiementJours: null,
      modePaiement: null,
      plafondCentimes: null,
      valideDu: '2026-01-01',
      valideAu: null,
      creeLe: new Date('2026-01-01T00:00:00.000Z'),
      modifieLe: new Date('2026-01-01T00:00:00.000Z'),
      ...champs,
    } as LigneClientCondition;
  }

  it('un rabais absent (null) est rendu comme 0, jamais null (pas de -0% ambigu)', () => {
    const dto = versConditionResponse(ligneCondition());
    expect(dto.rabaisMoPourmille).toBe(0);
    expect(dto.rabaisPiecesPourmille).toBe(0);
    expect(dto.rabaisPneusPourmille).toBe(0);
  });

  it('les bornes de validité sont projetées telles quelles, y compris valideAuLe = null (période ouverte)', () => {
    const dto = versConditionResponse(ligneCondition({ valideDu: '2026-03-01', valideAu: null }));
    expect(dto.valideDuLe).toBe('2026-03-01');
    expect(dto.valideAuLe).toBeNull();
  });

  it('une période close conserve sa borne de fin exacte', () => {
    const dto = versConditionResponse(ligneCondition({ valideDu: '2025-01-01', valideAu: '2025-12-31' }));
    expect(dto.valideDuLe).toBe('2025-01-01');
    expect(dto.valideAuLe).toBe('2025-12-31');
  });
});

describe('versConsentementResponse — RM-09 append-only', () => {
  function ligneConsentement(champs: Partial<LigneClientConsentement> = {}): LigneClientConsentement {
    return {
      id: 'cs1',
      tenantId: 'tid',
      clientId: 'c1',
      type: 'marketing',
      accorde: true,
      recueilliLe: new Date('2026-02-01T10:00:00.000Z'),
      canal: 'comptoir',
      preuve: null,
      creeLe: new Date('2026-02-01T10:00:00.000Z'),
      ...champs,
    } as LigneClientConsentement;
  }

  it('recueilliLe est projeté en ISO', () => {
    const dto = versConsentementResponse(ligneConsentement());
    expect(dto.recueilliLe).toBe('2026-02-01T10:00:00.000Z');
  });

  it('une révocation (accorde: false) reste un consentement à part entière', () => {
    const dto = versConsentementResponse(ligneConsentement({ accorde: false }));
    expect(dto.accorde).toBe(false);
  });
});

describe('versNoteResponse', () => {
  function ligneNote(champs: Partial<LigneClientNote> = {}): LigneClientNote {
    return {
      id: 'n1',
      tenantId: 'tid',
      clientId: 'c1',
      nature: 'interne',
      texte: 'Client difficile à joindre.',
      auteurId: 'u1',
      creeLe: new Date('2026-01-01T00:00:00.000Z'),
      modifieLe: new Date('2026-01-01T00:00:00.000Z'),
      ...champs,
    } as LigneClientNote;
  }

  it('un auteur retrouvé est projeté avec son nom affiché', () => {
    const dto = versNoteResponse(ligneNote(), { utilisateurId: 'u1', nomAffiche: 'Sophie Martin' });
    expect(dto.auteur).toEqual({ utilisateurId: 'u1', nomAffiche: 'Sophie Martin' });
  });

  it('un auteur absent (tâche système ou utilisateur supprimé) rend auteur: null', () => {
    const dto = versNoteResponse(ligneNote(), null);
    expect(dto.auteur).toBeNull();
  });
});
