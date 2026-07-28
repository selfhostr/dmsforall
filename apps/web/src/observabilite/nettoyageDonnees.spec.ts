import type { Breadcrumb, ErrorEvent } from '@sentry/react';
import { describe, expect, it } from 'vitest';

import { nettoyerEvenement, nettoyerMigette, rediger } from './nettoyageDonnees';

function evenementVide(): ErrorEvent {
  return { type: undefined };
}

describe('nettoyerEvenement', () => {
  it('retire le contenu des champs de formulaire sensibles (mot de passe, e-mail) portés en extra', () => {
    const evenement = nettoyerEvenement({
      ...evenementVide(),
      extra: { motDePasse: 'Demo1234!Garage', email: 'admin@garage-martin.ch', autreChamp: 'ok' },
    });
    expect(evenement.extra?.motDePasse).toBe('[retiré]');
    expect(evenement.extra?.email).toBe('[retiré]');
    expect(evenement.extra?.autreChamp).toBe('ok');
    expect(JSON.stringify(evenement)).not.toContain('Demo1234!Garage');
    expect(JSON.stringify(evenement)).not.toContain('admin@garage-martin.ch');
  });

  it('retire le nom d’un client, même niché dans un objet imbriqué', () => {
    const evenement = nettoyerEvenement({
      ...evenementVide(),
      extra: { client: { nom: 'Dupont', prenom: 'Jean', immatriculation: 'GE 123456' } },
    });
    const client = evenement.extra?.client as Record<string, unknown>;
    expect(client.nom).toBe('[retiré]');
    expect(client.prenom).toBe('[retiré]');
    expect(client.immatriculation).toBe('[retiré]');
  });

  it('rédige une plaque suisse trouvée dans le message d’une exception', () => {
    const evenement = nettoyerEvenement({
      ...evenementVide(),
      exception: { values: [{ type: 'Error', value: 'Véhicule GE 123456 introuvable en atelier' }] },
    });
    expect(evenement.exception?.values?.[0]?.value).not.toContain('GE 123456');
    expect(evenement.exception?.values?.[0]?.value).toContain('[retiré]');
  });

  it('rédige un VIN (17 caractères ISO 3779) trouvé dans le message d’une exception', () => {
    const evenement = nettoyerEvenement({
      ...evenementVide(),
      exception: { values: [{ type: 'Error', value: 'Impossible de sauver le véhicule WVWZZZ1JZXW000001' }] },
    });
    expect(evenement.exception?.values?.[0]?.value).not.toContain('WVWZZZ1JZXW000001');
    expect(evenement.exception?.values?.[0]?.value).toContain('[retiré]');
  });

  it('retire les variables locales de stack frame (défense en profondeur si dataCollection était réactivé)', () => {
    const evenement = nettoyerEvenement({
      ...evenementVide(),
      exception: {
        values: [
          {
            type: 'Error',
            value: 'échec',
            stacktrace: { frames: [{ filename: 'connexion.ts', vars: { motDePasse: 'Demo1234!Garage' } }] },
          },
        ],
      },
    });
    expect(evenement.exception?.values?.[0]?.stacktrace?.frames?.[0]?.vars).toBeUndefined();
  });

  it('retire le corps de la réponse API, jamais transmis, même si présent en extra', () => {
    const evenement = nettoyerEvenement({
      ...evenementVide(),
      extra: {
        reponseApi: { body: { plaque: 'VD 998877', client: 'Rossi Garage SA' } },
      },
    });
    expect(JSON.stringify(evenement)).not.toContain('Rossi Garage SA');
    expect(JSON.stringify(evenement)).not.toContain('VD 998877');
  });

  it('retire headers, cookies, corps et query string de la requête, et ne garde que le chemin de l’URL', () => {
    const evenement = nettoyerEvenement({
      ...evenementVide(),
      request: {
        method: 'GET',
        url: 'https://dms.garage-martin.ch/clients/recherche?nom=Dupont&plaque=VD123456',
        headers: { cookie: 'session=abc', authorization: 'Bearer secret' },
        cookies: { session: 'abc' },
        data: { motDePasse: 'x' },
      },
    });
    expect(evenement.request?.url).toBe('https://dms.garage-martin.ch/clients/recherche');
    expect(evenement.request?.headers).toBeUndefined();
    expect(evenement.request?.cookies).toBeUndefined();
    expect(evenement.request?.data).toBeUndefined();
  });

  it('retire systématiquement le champ user, même si un appelant l’a renseigné', () => {
    const evenement = nettoyerEvenement({ ...evenementVide(), user: { email: 'admin@garage-martin.ch' } });
    expect(evenement.user).toBeUndefined();
  });

  it('nettoie chaque breadcrumb du fil de navigation avant de les rattacher à l’événement', () => {
    const evenement = nettoyerEvenement({
      ...evenementVide(),
      breadcrumbs: [
        {
          category: 'fetch',
          data: { method: 'GET', url: '/api/v1/clients?nom=Dupont', status_code: 200 },
        },
      ],
    });
    const migette = evenement.breadcrumbs?.[0];
    expect(migette?.data?.url).toBe('/api/v1/clients');
    expect(JSON.stringify(migette)).not.toContain('Dupont');
  });
});

describe('nettoyerMigette', () => {
  it('retire la chaîne de requête d’une URL de breadcrumb réseau (recherche client, plaque…)', () => {
    const migette: Breadcrumb = {
      category: 'xhr',
      data: { method: 'GET', url: '/api/v1/vehicules?plaque=VD+123456', status_code: 200 },
    };
    const nettoyee = nettoyerMigette(migette);
    expect(nettoyee.data?.url).toBe('/api/v1/vehicules');
  });

  it('retire sans condition un corps de requête ou de réponse porté par un breadcrumb', () => {
    const migette: Breadcrumb = {
      category: 'fetch',
      data: { url: '/api/v1/or/42', body: { client: 'Dupont' }, response: { vin: 'WVWZZZ1JZXW000001' } },
    };
    const nettoyee = nettoyerMigette(migette);
    expect(nettoyee.data?.body).toBe('[retiré]');
    expect(nettoyee.data?.response).toBe('[retiré]');
  });

  it('rédige un message de breadcrumb console contenant un e-mail', () => {
    const migette: Breadcrumb = { category: 'console', message: 'Connexion échouée pour admin@garage-martin.ch' };
    const nettoyee = nettoyerMigette(migette);
    expect(nettoyee.message).not.toContain('admin@garage-martin.ch');
  });

  it('ne fait jamais disparaître le breadcrumb lui-même (chronologie préservée)', () => {
    const migette: Breadcrumb = { category: 'ui.click', message: 'button.valider' };
    expect(nettoyerMigette(migette)).not.toBeNull();
  });
});

describe('nettoyerEvenement — une catégorie de donnée sensible par cas', () => {
  const casParCategorie: ReadonlyArray<readonly [categorie: string, cle: string, valeur: string]> = [
    ['identifiants de connexion', 'motDePasse', 'Demo1234!Garage'],
    ['identifiants de connexion', 'mdp', 'Demo1234!Garage'],
    ['identifiants de connexion', 'email', 'admin@garage-martin.ch'],
    ['identité client', 'nom', 'Dupont'],
    ['identité client', 'raisonSociale', 'Rossi Garage SA'],
    ['coordonnées client', 'telephone', '+41 79 123 45 67'],
    ['coordonnées client', 'adresse', 'Rue du Lac 1'],
    ['coordonnées client', 'npa', '1000'],
    ['identifiants véhicule', 'plaque', 'VD 123456'],
    ['identifiants véhicule', 'vin', 'WVWZZZ1JZXW000001'],
    ['identifiants véhicule', 'numeroChassis', 'WVWZZZ1JZXW000001'],
    ['données financières', 'iban', 'CH93 0076 2011 6238 5295 7'],
    ['données financières', 'ahv', '756.1234.5678.97'],
  ];

  it.each(casParCategorie)('retire « %s » (clé %s) quand elle est portée en extra', (_categorie, cle, valeur) => {
    const evenement = nettoyerEvenement({ ...evenementVide(), extra: { [cle]: valeur } });
    expect(evenement.extra?.[cle]).toBe('[retiré]');
    expect(JSON.stringify(evenement)).not.toContain(valeur);
  });

  it('retire un corps de réponse API en bloc, quelle que soit la clé exacte utilisée pour le porter', () => {
    const evenement = nettoyerEvenement({
      ...evenementVide(),
      extra: { corps: { commentaireLibre: 'Rendez-vous avec Jean Dupont jeudi' } },
    });
    expect(evenement.extra?.corps).toBe('[retiré]');
  });
});

describe('rediger', () => {
  it('rédige un e-mail au milieu d’une phrase', () => {
    expect(rediger('Contact : jean.dupont@garage-martin.ch pour suite')).toBe('Contact : [retiré] pour suite');
  });

  it('laisse une chaîne sans donnée personnelle inchangée', () => {
    expect(rediger('Délai de connexion dépassé après 15s')).toBe('Délai de connexion dépassé après 15s');
  });
});
