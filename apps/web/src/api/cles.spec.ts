import { describe, expect, it } from 'vitest';

import { clesQuery } from './cles';

describe('clesQuery', () => {
  it('conserve la clé de session existante (compat useSession/useConnexion)', () => {
    expect(clesQuery.session()).toEqual(['auth', 'me']);
  });

  it('produit des tuples, jamais de concaténation de chaîne', () => {
    expect(clesQuery.clients.detail('abc')).toEqual(['clients', 'detail', 'abc']);
    expect(clesQuery.or.vue('attenteAccord', 'site-1')).toEqual(['or', 'vue', 'attenteAccord', 'site-1']);
    expect(clesQuery.pointages.technicienJour('tech-1', '2026-07-27')).toEqual([
      'pointages',
      'technicienJour',
      'tech-1',
      '2026-07-27',
    ]);
  });

  it('garde les sous-ressources en frères de "detail", pas nichées dessous', () => {
    // Condition d'invalidation sûre (§5.3) : invalider or.detail(id) ne doit jamais matcher par
    // préfixe la clé de or.journal(id) ou or.documents(id).
    const detail = clesQuery.or.detail('or-1');
    const journal = clesQuery.or.journal('or-1');
    const documents = clesQuery.or.documents('or-1');
    expect(journal.slice(0, detail.length)).not.toEqual(detail);
    expect(documents.slice(0, detail.length)).not.toEqual(detail);
  });

  it('garde or.vue en préfixe commun pour permettre une invalidation large volontaire (or.vue(*))', () => {
    const vueA = clesQuery.or.vue('attenteAccord', 'site-1');
    const vueB = clesQuery.or.vue('enCours', 'site-1');
    expect(vueA.slice(0, 2)).toEqual(['or', 'vue']);
    expect(vueB.slice(0, 2)).toEqual(['or', 'vue']);
  });

  it("n'a aucune clé de base dupliquée entre domaines", () => {
    const echantillon: readonly (readonly unknown[])[] = [
      clesQuery.session(),
      clesQuery.recherche.globale('x'),
      clesQuery.parametres.atelier(),
      clesQuery.referentiels.prestations(),
      clesQuery.referentiels.techniciens('site-1'),
      clesQuery.referentiels.motifsRdv(),
      clesQuery.referentiels.checklists(),
      clesQuery.clients.liste(),
      clesQuery.clients.detail('id'),
      clesQuery.clients.vehicules('id'),
      clesQuery.clients.ordres('id'),
      clesQuery.clients.doublons('id'),
      clesQuery.clients.contacts('id'),
      clesQuery.clients.adresses('id'),
      clesQuery.clients.conditions('id'),
      clesQuery.clients.consentements('id'),
      clesQuery.clients.notes('id'),
      clesQuery.vehicules.liste(),
      clesQuery.vehicules.detail('id'),
      clesQuery.vehicules.contexteAtelier('id'),
      clesQuery.vehicules.travauxReportes('id'),
      clesQuery.vehicules.kilometrages('id'),
      clesQuery.rdv.plage('site-1', '2026-07-01', '2026-07-31'),
      clesQuery.rdv.detail('id'),
      clesQuery.rdv.charge('site-1', '2026-07-01', '2026-07-31'),
      clesQuery.or.liste(),
      clesQuery.or.vue('vue-1', 'site-1'),
      clesQuery.or.detail('id'),
      clesQuery.or.journal('id'),
      clesQuery.or.documents('id'),
      clesQuery.pointages.ouverts('site-1'),
      clesQuery.pointages.technicienJour('tech-1', '2026-07-01'),
      clesQuery.pointages.anomalies('site-1'),
      clesQuery.prets.liste('site-1'),
      clesQuery.prets.detail('id'),
    ];

    const serialisees = echantillon.map((cle) => JSON.stringify(cle));
    expect(new Set(serialisees).size).toBe(serialisees.length);
  });
});
