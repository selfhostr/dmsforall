import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { encoderCurseurTrie } from '../common/pagination';

import { ServiceHistoriqueEnvoisRelance } from './service-historique-envois';

const dialect = new PgDialect();
function rendu(fragment: ReturnType<typeof sql>): {
  readonly sql: string;
  readonly params: readonly unknown[];
} {
  return dialect.sqlToQuery(fragment);
}

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

interface LigneTest {
  readonly id: string;
  readonly factureId: string;
  readonly factureNumero: string | null;
  readonly palier: number;
  readonly canal: string;
  readonly destinataire: string;
  readonly statutEnvoi: string;
  readonly erreur: string | null;
  readonly envoyeLeTexte: string;
}

function ligne(champs: Partial<LigneTest> = {}): LigneTest {
  return {
    id: '01dc576e-7560-4e7f-9fc7-2b1806186f67',
    factureId: 'facture-1',
    factureNumero: 'F-2026-00042',
    palier: 1,
    canal: 'email',
    destinataire: 'client@exemple.ch',
    statutEnvoi: 'envoye',
    erreur: null,
    envoyeLeTexte: '2026-08-10 08:00:00.123456+00',
    ...champs,
  };
}

/** Capture le fragment SQL brut passé à `tx.execute()` — même technique que
 *  `pieces/pagination-triee.spec.ts` (`PgDialect().sqlToQuery`), adaptée à un `execute()` unique
 *  par appel plutôt qu'au query-builder Drizzle. */
function accesFactice(rows: readonly LigneTest[]): {
  readonly acces: AccesBase;
  readonly execute: ReturnType<typeof vi.fn>;
  readonly appels: ContexteTenant[];
} {
  const execute = vi.fn().mockResolvedValue({ rows });
  const tx = { execute } as unknown as TransactionDfa;
  const appels: ContexteTenant[] = [];
  const acces: AccesBase = {
    enTenant: vi.fn((ctx, travail) => {
      appels.push(ctx);
      return travail(tx);
    }),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
  return { acces, execute, appels };
}

function service(acces: AccesBase): ServiceHistoriqueEnvoisRelance {
  return new ServiceHistoriqueEnvoisRelance(acces);
}

describe('ServiceHistoriqueEnvoisRelance.lister — isolation tenant et filtre facture (SQL réellement construit)', () => {
  it('scope toujours re.tenant_id = ctx.tenantId, paramétré (jamais un littéral concaténé)', async () => {
    const { acces, execute } = accesFactice([]);
    await service(acces).lister(CTX, { limite: 50 });

    const requete = rendu(execute.mock.calls[0]?.[0]);
    expect(requete.sql).toContain('re.tenant_id =');
    expect(requete.params).toContain('tid-1');
  });

  it('factureId omis : aucune clause sur rp.objet_id — historique complet du tenant', async () => {
    const { acces, execute } = accesFactice([]);
    await service(acces).lister(CTX, { limite: 50 });

    const requete = rendu(execute.mock.calls[0]?.[0]);
    expect(requete.sql).not.toContain('rp.objet_id =');
  });

  it(
    'factureId fourni : filtre appliqué au SQL (paramétré, ET-composé avec le scope tenant — ' +
      'jamais un OR qui élargirait) — piège vérifié du dépôt : un filtre accepté par le contrat ' +
      'doit réellement atteindre la requête, pas seulement être accepté par zod',
    async () => {
      const { acces, execute } = accesFactice([]);
      await service(acces).lister(CTX, { limite: 50, factureId: 'facture-cible' });

      const requete = rendu(execute.mock.calls[0]?.[0]);
      expect(requete.sql).toContain('and rp.objet_id =');
      expect(requete.params).toContain('facture-cible');
    },
  );

  it('un factureId inconnu ne change pas la FORME de la requête (même clause AND) — une base réelle y répond par une page vide, pas tout le tenant', async () => {
    const { acces, execute } = accesFactice([]);
    const resultat = await service(acces).lister(CTX, {
      limite: 50,
      factureId: 'facture-jamais-planifiee',
    });

    expect(resultat.donnees).toEqual([]);
    const requete = rendu(execute.mock.calls[0]?.[0]);
    expect(requete.params).toContain('facture-jamais-planifiee');
  });
});

describe('ServiceHistoriqueEnvoisRelance.lister — mapping DTO (raisonEchec, jamais le contenu du message)', () => {
  it("statut 'envoye' : raisonEchec null", async () => {
    const { acces } = accesFactice([ligne({ statutEnvoi: 'envoye', erreur: null })]);
    const resultat = await service(acces).lister(CTX, { limite: 50 });
    expect(resultat.donnees[0]?.raisonEchec).toBeNull();
    expect(resultat.donnees[0]?.statutEnvoi).toBe('envoye');
  });

  it("statut 'echoue' avec erreur 'quota_depasse: ...' : raisonEchec = 'quota_depasse' (code fermé, jamais le texte technique brut)", async () => {
    const { acces } = accesFactice([
      ligne({ statutEnvoi: 'echoue', erreur: 'quota_depasse: Délai de connexion dépassé.' }),
    ]);
    const resultat = await service(acces).lister(CTX, { limite: 50 });
    expect(resultat.donnees[0]?.raisonEchec).toBe('quota_depasse');
  });

  it.each([
    'destinataire_invalide: Adresse rejetée par le fournisseur.',
    'canal_non_supporte: SMS indisponible pour ce client.',
    'contenu_refuse: Message bloqué par le filtre anti-spam.',
  ])('reconnaît le code fermé en préfixe de "%s"', async (erreurTexte) => {
    const { acces } = accesFactice([ligne({ statutEnvoi: 'echoue', erreur: erreurTexte })]);
    const resultat = await service(acces).lister(CTX, { limite: 50 });
    expect(resultat.donnees[0]?.raisonEchec).toBe(erreurTexte.split(': ')[0]);
  });

  it('un texte d’erreur au format inattendu (aucun code fermé reconnu en préfixe) rend raisonEchec=null plutôt que de planter — défensif, jamais une régression visible pour le comptable', async () => {
    const { acces } = accesFactice([
      ligne({ statutEnvoi: 'echoue', erreur: 'un format qui n’a jamais existé côté écriture' }),
    ]);
    const resultat = await service(acces).lister(CTX, { limite: 50 });
    expect(resultat.donnees[0]?.raisonEchec).toBeNull();
  });

  it('ne renvoie jamais le contenu du message (contenu_fige) — le DTO ne porte structurellement pas ce champ', async () => {
    const { acces } = accesFactice([ligne()]);
    const resultat = await service(acces).lister(CTX, { limite: 50 });
    expect(resultat.donnees[0]).not.toHaveProperty('contenuFige');
    expect(Object.keys(resultat.donnees[0] ?? {}).sort()).toEqual(
      [
        'canal',
        'destinataire',
        'envoyeLe',
        'factureId',
        'factureNumero',
        'id',
        'palier',
        'raisonEchec',
        'statutEnvoi',
      ].sort(),
    );
  });
});

describe('ServiceHistoriqueEnvoisRelance.lister — pagination par curseur', () => {
  it('N+1 lignes rendues, limite=2 : page tronquée à 2, curseurSuivant non nul', async () => {
    const lignes = [
      ligne({ id: 'e1', envoyeLeTexte: '2026-08-10 09:00:00+00' }),
      ligne({ id: 'e2', envoyeLeTexte: '2026-08-10 08:00:00+00' }),
      ligne({ id: 'e3', envoyeLeTexte: '2026-08-10 07:00:00+00' }),
    ];
    const { acces } = accesFactice(lignes);
    const resultat = await service(acces).lister(CTX, { limite: 2 });

    expect(resultat.donnees).toHaveLength(2);
    expect(resultat.limite).toBe(2);
    expect(resultat.curseurSuivant).not.toBeNull();
  });

  it('exactement `limite` lignes rendues : curseurSuivant null (fin de liste)', async () => {
    const { acces } = accesFactice([ligne({ id: 'e1' }), ligne({ id: 'e2' })]);
    const resultat = await service(acces).lister(CTX, { limite: 2 });

    expect(resultat.donnees).toHaveLength(2);
    expect(resultat.curseurSuivant).toBeNull();
  });

  it('un curseur émis par un appel précédent construit la clause keyset avec le SEUIL exact (texte natif Postgres, jamais un Date JS)', async () => {
    const idCurseur = '01dc576e-7560-4e7f-9fc7-2b1806186f67';
    const curseur = encoderCurseurTrie({
      tri: 'envoyeLe:desc',
      valeur: '2026-08-10T08:00:00.123456+00:00',
      id: idCurseur,
    });
    const { acces, execute } = accesFactice([]);
    await service(acces).lister(CTX, { limite: 50, curseur });

    const requete = rendu(execute.mock.calls[0]?.[0]);
    expect(requete.sql).toContain('(re.envoye_le, re.id) <');
    expect(requete.params).toContain('2026-08-10T08:00:00.123456+00:00');
    expect(requete.params).toContain(idCurseur);
  });

  it('un curseur illisible produit VALIDATION_ECHOUEE (400), jamais un plantage interne — et n’ouvre jamais de transaction', async () => {
    const { acces, appels } = accesFactice([]);
    await expect(
      service(acces).lister(CTX, { limite: 50, curseur: '!!!pas-un-curseur-valide!!!' }),
    ).rejects.toThrow(expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }));
    expect(appels).toHaveLength(0);
  });

  it('un curseur émis pour un autre tri est refusé (pas de continuité silencieusement inventée)', async () => {
    const curseurAutreTri = encoderCurseurTrie({
      tri: 'creeLe:desc',
      valeur: '2026-01-01T00:00:00.000000+00:00',
      id: '01dc576e-7560-4e7f-9fc7-2b1806186f67',
    });
    const { acces } = accesFactice([]);
    await expect(
      service(acces).lister(CTX, { limite: 50, curseur: curseurAutreTri }),
    ).rejects.toThrow(expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }));
  });
});
