import { describe, expect, it } from 'vitest';

import { schemaCreationUtilisateur, schemaModificationUtilisateur } from './socle';

const SITE_ID = '11111111-1111-4111-8111-111111111111';

const ENTREE_VALIDE = {
  prenom: 'Julie',
  nom: 'Rey',
  email: 'julie.rey@garage-martin.ch',
  role: 'technicien',
  siteIds: [SITE_ID],
} as const;

describe('schemaCreationUtilisateur — garde n°2 (le tenant vient de la session, jamais du corps)', () => {
  it('accepte un corps valide', () => {
    expect(schemaCreationUtilisateur.safeParse(ENTREE_VALIDE).success).toBe(true);
  });

  it("REFUSE (jamais n'ignore) un tenantId glissé dans le corps — .strict() sur le schéma", () => {
    const resultat = schemaCreationUtilisateur.safeParse({
      ...ENTREE_VALIDE,
      tenantId: '00000000-0000-4000-8000-000000000000',
    });
    expect(resultat.success).toBe(false);
  });

  it('refuse toute autre clé inconnue au même titre (pas un cas spécial de tenantId)', () => {
    const resultat = schemaCreationUtilisateur.safeParse({ ...ENTREE_VALIDE, motDePasse: 'x' });
    expect(resultat.success).toBe(false);
  });

  it("refuse le rôle de compte de service ('poste_atelier') — un employé est une personne", () => {
    const resultat = schemaCreationUtilisateur.safeParse({
      ...ENTREE_VALIDE,
      role: 'poste_atelier',
    });
    expect(resultat.success).toBe(false);
  });

  it('refuse une création sans aucun site', () => {
    const resultat = schemaCreationUtilisateur.safeParse({ ...ENTREE_VALIDE, siteIds: [] });
    expect(resultat.success).toBe(false);
  });
});

describe('schemaModificationUtilisateur — même garde n°2', () => {
  it('accepte { role } seul', () => {
    expect(schemaModificationUtilisateur.safeParse({ role: 'chef_atelier' }).success).toBe(true);
  });

  it('accepte { siteIds } seul', () => {
    expect(schemaModificationUtilisateur.safeParse({ siteIds: [SITE_ID] }).success).toBe(true);
  });

  it('refuse un corps sans role ni siteIds (au moins un requis)', () => {
    expect(schemaModificationUtilisateur.safeParse({}).success).toBe(false);
  });

  it('REFUSE un tenantId glissé dans le corps, même combiné à un champ valide', () => {
    const resultat = schemaModificationUtilisateur.safeParse({
      role: 'chef_atelier',
      tenantId: '00000000-0000-4000-8000-000000000000',
    });
    expect(resultat.success).toBe(false);
  });
});
