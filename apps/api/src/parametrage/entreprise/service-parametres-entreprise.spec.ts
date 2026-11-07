import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant } from '../../db';
import { ServiceParametresEntreprise } from './service-parametres-entreprise';

const CTX: ContexteTenant = { tenantId: 'tid', utilisateurId: 'uid', requeteId: 'req' };

interface LigneTenant {
  raisonSociale: string;
  assujettiTva?: boolean;
  numeroTva: string | null;
  delaiPaiementJoursDefaut?: number;
  modeSignalement?: string;
}

function acces(ligneBrute: LigneTenant | undefined) {
  const ligne = ligneBrute && { delaiPaiementJoursDefaut: 30, assujettiTva: true, ...ligneBrute };
  const sets: unknown[] = [];
  const audits: unknown[] = [];
  const tx = {
    insert: () => ({
      values: (v: unknown) => {
        audits.push(v);
        return Promise.resolve();
      },
    }),
    select: () => ({ from: () => ({ where: () => Promise.resolve(ligne ? [ligne] : []) }) }),
    update: () => ({
      set: (v: {
        raisonSociale?: string;
        numeroTva?: string | null;
        assujettiTva?: boolean;
        delaiPaiementJoursDefaut?: number;
        modeSignalement?: string;
      }) => {
        sets.push(v);
        const definis = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
        return {
          where: () => ({
            returning: () => Promise.resolve(ligne ? [{ ...ligne, ...definis }] : []),
          }),
        };
      },
    }),
  };
  const base: AccesBase = {
    enTenant: vi.fn((_c, travail) => travail(tx as never)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
  return { base, sets, audits };
}

describe('ServiceParametresEntreprise', () => {
  it('lit la raison sociale et le n° TVA (null tant que non saisi)', async () => {
    const { base } = acces({ raisonSociale: 'Garage Sandra', numeroTva: null });
    expect(await new ServiceParametresEntreprise(base).obtenir(CTX)).toEqual({
      raisonSociale: 'Garage Sandra',
      assujettiTva: true,
      numeroTva: null,
      delaiPaiementJoursDefaut: 30,
    });
  });

  it('lit un garage non assujetti', async () => {
    const { base } = acces({ raisonSociale: 'G', assujettiTva: false, numeroTva: null });
    expect((await new ServiceParametresEntreprise(base).obtenir(CTX)).assujettiTva).toBe(false);
  });

  it('« Non » vide le n° TVA et journalise assujetti_tva et numero_tva (avant/après)', async () => {
    const { base, sets, audits } = acces({
      raisonSociale: 'G',
      assujettiTva: true,
      numeroTva: 'CHE-116.281.710 TVA',
    });
    const dto = await new ServiceParametresEntreprise(base).modifier(CTX, { assujettiTva: false });
    expect(sets).toEqual([{ assujettiTva: false, numeroTva: null }]);
    expect(dto.assujettiTva).toBe(false);
    expect(dto.numeroTva).toBeNull();
    expect(audits).toEqual([
      {
        tenantId: 'tid',
        entite: 'tenant',
        entiteId: 'tid',
        action: 'modification',
        champ: 'assujetti_tva',
        valeurAvant: true,
        valeurApres: false,
        utilisateurId: 'uid',
        requeteId: 'req',
      },
      {
        tenantId: 'tid',
        entite: 'tenant',
        entiteId: 'tid',
        action: 'modification',
        champ: 'numero_tva',
        valeurAvant: 'CHE-116.281.710 TVA',
        valeurApres: null,
        utilisateurId: 'uid',
        requeteId: 'req',
      },
    ]);
  });

  it('« Oui » sans n° est accepté (le n° sera exigé à l’émission)', async () => {
    const { base, sets, audits } = acces({
      raisonSociale: 'G',
      assujettiTva: false,
      numeroTva: null,
    });
    const dto = await new ServiceParametresEntreprise(base).modifier(CTX, { assujettiTva: true });
    expect(sets).toEqual([{ assujettiTva: true }]);
    expect(dto).toMatchObject({ assujettiTva: true, numeroTva: null });
    expect(audits).toHaveLength(1);
  });

  it('« Oui » avec n° dans le même PATCH écrit les deux', async () => {
    const { base, sets } = acces({ raisonSociale: 'G', assujettiTva: false, numeroTva: null });
    const dto = await new ServiceParametresEntreprise(base).modifier(CTX, {
      assujettiTva: true,
      numeroTva: 'CHE-116.281.710 TVA',
    });
    expect(sets).toEqual([{ assujettiTva: true, numeroTva: 'CHE-116.281.710 TVA' }]);
    expect(dto.numeroTva).toBe('CHE-116.281.710 TVA');
  });

  it('« Non » avec un n° TVA dans le même PATCH est refusé, rien n’est écrit', async () => {
    const { base, sets, audits } = acces({ raisonSociale: 'G', numeroTva: null });
    await expect(
      new ServiceParametresEntreprise(base).modifier(CTX, {
        assujettiTva: false,
        numeroTva: 'CHE-116.281.710 TVA',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
    expect(sets).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it('un n° TVA envoyé à un garage déjà non assujetti est refusé', async () => {
    const { base, sets } = acces({ raisonSociale: 'G', assujettiTva: false, numeroTva: null });
    await expect(
      new ServiceParametresEntreprise(base).modifier(CTX, { numeroTva: 'CHE-116.281.710 TVA' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
    expect(sets).toHaveLength(0);
  });

  it('un PATCH du délai ne touche pas à l’assujettissement ni au n° TVA', async () => {
    const { base, sets } = acces({
      raisonSociale: 'G',
      assujettiTva: false,
      numeroTva: null,
    });
    await new ServiceParametresEntreprise(base).modifier(CTX, { delaiPaiementJoursDefaut: 10 });
    expect(sets).toEqual([{ delaiPaiementJoursDefaut: 10, numeroTva: null }]);
  });

  it('saisit le n° TVA', async () => {
    const { base, sets } = acces({ raisonSociale: 'G', numeroTva: null });
    const dto = await new ServiceParametresEntreprise(base).modifier(CTX, {
      numeroTva: 'CHE-116.281.710 TVA',
    });
    expect(sets).toEqual([{ numeroTva: 'CHE-116.281.710 TVA' }]);
    expect(dto.numeroTva).toBe('CHE-116.281.710 TVA');
  });

  it('null efface le numéro', async () => {
    const { base, sets } = acces({ raisonSociale: 'G', numeroTva: 'CHE-116.281.710 TVA' });
    const dto = await new ServiceParametresEntreprise(base).modifier(CTX, { numeroTva: null });
    expect(sets).toEqual([{ numeroTva: null }]);
    expect(dto.numeroTva).toBeNull();
  });

  it('change le mode de signalement : écrit le champ seul et le journalise avant/après', async () => {
    const { base, sets, audits } = acces({
      raisonSociale: 'G',
      numeroTva: null,
      modeSignalement: 'via_site',
    });
    const r = await new ServiceParametresEntreprise(base).modifier(CTX, {
      modeSignalement: 'copie_seule',
    });
    expect(sets).toEqual([
      {
        raisonSociale: undefined,
        numeroTva: undefined,
        assujettiTva: undefined,
        delaiPaiementJoursDefaut: undefined,
        modeSignalement: 'copie_seule',
      },
    ]);
    expect(r).toMatchObject({ modeSignalement: 'copie_seule' });
    expect(audits).toEqual([
      expect.objectContaining({
        entite: 'tenant',
        champ: 'mode_signalement',
        valeurAvant: 'via_site',
        valeurApres: 'copie_seule',
      }),
    ]);
  });

  it('même mode de signalement : pas de ligne d’audit', async () => {
    const { base, audits } = acces({
      raisonSociale: 'G',
      numeroTva: null,
      modeSignalement: 'desactive',
    });
    await new ServiceParametresEntreprise(base).modifier(CTX, { modeSignalement: 'desactive' });
    expect(audits).toEqual([]);
  });

  it('corps vide : aucune écriture', async () => {
    const { base, sets } = acces({ raisonSociale: 'G', numeroTva: 'CHE-116.281.710 TVA' });
    const dto = await new ServiceParametresEntreprise(base).modifier(CTX, {});
    expect(sets).toHaveLength(0);
    expect(dto.numeroTva).toBe('CHE-116.281.710 TVA');
  });

  it('tenant introuvable : RESSOURCE_INTROUVABLE', async () => {
    const { base } = acces(undefined);
    await expect(new ServiceParametresEntreprise(base).obtenir(CTX)).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
  });

  it('modifie le délai de paiement par défaut sans toucher au n° TVA', async () => {
    const { base, sets } = acces({ raisonSociale: 'G', numeroTva: 'CHE-116.281.710 TVA' });
    const dto = await new ServiceParametresEntreprise(base).modifier(CTX, {
      delaiPaiementJoursDefaut: 10,
    });
    expect(sets).toEqual([{ delaiPaiementJoursDefaut: 10 }]);
    expect(dto).toEqual({
      raisonSociale: 'G',
      assujettiTva: true,
      numeroTva: 'CHE-116.281.710 TVA',
      delaiPaiementJoursDefaut: 10,
    });
  });

  it('accepte un délai de 0 jour (comptant) : zéro n’est pas « absent »', async () => {
    const { base, sets } = acces({ raisonSociale: 'G', numeroTva: null });
    await new ServiceParametresEntreprise(base).modifier(CTX, { delaiPaiementJoursDefaut: 0 });
    expect(sets).toEqual([{ delaiPaiementJoursDefaut: 0 }]);
  });

  it('change la raison sociale : écrit le champ seul, journalise avant/après, ne touche pas au slug', async () => {
    const { base, sets, audits } = acces({ raisonSociale: 'Garage Martin SA', numeroTva: null });
    const dto = await new ServiceParametresEntreprise(base).modifier(CTX, {
      raisonSociale: 'Garage Martin Sàrl',
    });
    expect(sets).toEqual([{ raisonSociale: 'Garage Martin Sàrl' }]);
    expect(Object.keys(sets[0] as object)).not.toContain('slug');
    expect(dto.raisonSociale).toBe('Garage Martin Sàrl');
    expect(audits).toEqual([
      {
        tenantId: 'tid',
        entite: 'tenant',
        entiteId: 'tid',
        action: 'modification',
        champ: 'raison_sociale',
        valeurAvant: 'Garage Martin SA',
        valeurApres: 'Garage Martin Sàrl',
        utilisateurId: 'uid',
        requeteId: 'req',
      },
    ]);
  });

  it('raison sociale identique : pas de ligne d’audit', async () => {
    const { base, audits } = acces({ raisonSociale: 'G', numeroTva: null });
    await new ServiceParametresEntreprise(base).modifier(CTX, { raisonSociale: 'G' });
    expect(audits).toHaveLength(0);
  });

  it('modifier le seul n° TVA ne journalise pas de raison sociale', async () => {
    const { base, audits } = acces({ raisonSociale: 'G', numeroTva: null });
    await new ServiceParametresEntreprise(base).modifier(CTX, { numeroTva: 'CHE-116.281.710 TVA' });
    expect(audits).toHaveLength(0);
  });
});
