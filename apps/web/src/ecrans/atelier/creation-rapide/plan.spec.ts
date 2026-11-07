import { describe, expect, it } from 'vitest';

import { construirePlan, type SaisieOrdreDepuisPlaque } from './plan';

const BASE: SaisieOrdreDepuisPlaque = {
  siteId: 'site-1',
  plaque: 'VD 123456',
  vehicule: null,
  vehiculeNouveau: false,
  marque: '',
  modele: '',
  client: null,
  clientNouveau: false,
  nom: '',
  telephone: '',
  langue: 'fr',
  type: 'reparation',
  demande: '',
  kilometrage: null,
  restitution: '',
  numeroCommande: '',
};
const LIBRE = { kilometrageObligatoire: false, poObligatoire: false };

const VEHICULE = {
  id: 'v1',
  designation: 'VW Golf',
  plaque: 'VD 123456',
  detenteurNom: null,
  orOuvert: false,
  plaqueHistorique: false,
};

describe('construirePlan', () => {
  it('véhicule connu + client connu : un seul geste, aucune création préalable', () => {
    const r = construirePlan(
      {
        ...BASE,
        vehicule: VEHICULE,
        client: { id: 'c1', nomAffiche: 'Dupont', telephone: null },
        demande: '  Bruit au freinage ',
        kilometrage: 120_000,
      },
      LIBRE,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.vehicule).toEqual({ mode: 'existant', id: 'v1' });
    expect(r.plan.client).toEqual({ mode: 'existant', id: 'c1' });
    expect(r.plan.ordre.demandes).toEqual([{ verbatim: 'Bruit au freinage' }]);
    expect(r.plan.ordre.kilometrageEntree).toBe(120_000);
    expect(r.plan.ordre.statutInitial).toBe('ouvert');
  });

  it('véhicule inconnu + nouveau client : marque, modèle, nom et téléphone suffisent', () => {
    const r = construirePlan(
      {
        ...BASE,
        vehiculeNouveau: true,
        marque: ' Audi ',
        modele: 'A3',
        clientNouveau: true,
        nom: ' Martin ',
        telephone: '079 123 45 67',
      },
      LIBRE,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.vehicule).toMatchObject({
      mode: 'nouveau',
      entree: { marque: 'Audi', modele: 'A3', plaque: 'VD 123456' },
    });
    expect(r.plan.client).toMatchObject({
      mode: 'nouveau',
      entree: {
        type: 'particulier',
        nom: 'Martin',
        telephones: [{ valeur: '079 123 45 67', principal: true }],
      },
    });
  });

  it('signale champ par champ ce qui manque, sans rien effacer', () => {
    const r = construirePlan(
      { ...BASE, vehiculeNouveau: true, clientNouveau: true, telephone: '07' },
      LIBRE,
    );
    expect(r).toEqual({
      ok: false,
      erreurs: {
        marque: 'requis',
        modele: 'requis',
        nom: 'requis',
        telephone: 'invalide',
      },
    });
  });

  it("exige véhicule et client quand rien n'est choisi, et le site", () => {
    const r = construirePlan({ ...BASE, siteId: '' }, LIBRE);
    expect(r).toEqual({
      ok: false,
      erreurs: { site: 'requis', vehicule: 'requis', client: 'requis' },
    });
  });

  it('kilométrage et bon de commande obligatoires seulement si le garage / le client les exigent', () => {
    const saisie = {
      ...BASE,
      vehicule: VEHICULE,
      client: { id: 'c1', nomAffiche: 'D', telephone: null },
    };
    expect(construirePlan(saisie, LIBRE).ok).toBe(true);
    expect(construirePlan(saisie, { kilometrageObligatoire: true, poObligatoire: true })).toEqual({
      ok: false,
      erreurs: { kilometrage: 'requis', numeroCommande: 'requis' },
    });
    expect(construirePlan({ ...saisie, kilometrage: 10_000_000 }, LIBRE)).toEqual({
      ok: false,
      erreurs: { kilometrage: 'invalide' },
    });
  });
});
