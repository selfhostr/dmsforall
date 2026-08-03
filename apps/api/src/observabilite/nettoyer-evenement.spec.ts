import { describe, expect, it } from 'vitest';
import type { ErrorEvent, EventHint } from '@sentry/nestjs';

import {
  assainirAttributsSpan,
  assainirEvenement,
  nettoyerEvenementSentry,
} from './nettoyer-evenement';

const HINT_VIDE: EventHint = {};

/** Construit un événement Sentry minimal, avec des surcharges ciblées par test. */
function evenement(surcharges: Partial<ErrorEvent> = {}): ErrorEvent {
  return { type: undefined, ...surcharges };
}

/**
 * Construit un événement de TRANSACTION minimal — même forme qu'un `ErrorEvent` (voir
 * `FormeEvenementCommune` dans `nettoyer-evenement.ts`), seul le champ `type` diffère. On ne
 * type pas explicitement contre le `TransactionEvent` du SDK ici : voir le commentaire de
 * `assainirEvenement` sur pourquoi ce fichier évite de nommer ce type.
 */
function transaction(
  surcharges: Partial<Omit<ErrorEvent, 'type'>> = {},
): Omit<ErrorEvent, 'type'> & { type: 'transaction' } {
  return { type: 'transaction', ...surcharges };
}

describe('nettoyerEvenementSentry — nettoyage des données personnelles avant envoi', () => {
  it('retire les cookies bruts de la requête', () => {
    const resultat = nettoyerEvenementSentry(
      evenement({
        request: {
          url: 'https://api.dmsforall.example/api/v1/atelier/or',
          cookies: { dfa_session: 'abc123' },
        },
      }),
      HINT_VIDE,
    );

    expect(resultat.request?.cookies).toBeUndefined();
  });

  it("retire l'en-tête Authorization", () => {
    const resultat = nettoyerEvenementSentry(
      evenement({
        request: {
          url: 'https://api.dmsforall.example/api/v1/atelier/or',
          headers: { authorization: 'Bearer secret-token', 'content-type': 'application/json' },
        },
      }),
      HINT_VIDE,
    );

    expect(resultat.request?.headers?.authorization).toBe('[retiré]');
    expect(resultat.request?.headers?.['content-type']).toBe('application/json');
  });

  it("retire l'en-tête Cookie (variante insensible à la casse)", () => {
    const resultat = nettoyerEvenementSentry(
      evenement({
        request: { url: 'https://api.dmsforall.example/x', headers: { Cookie: 'dfa_session=abc' } },
      }),
      HINT_VIDE,
    );

    expect(resultat.request?.headers?.Cookie).toBe('[retiré]');
  });

  it("retire intégralement le corps de requête des endpoints d'authentification", () => {
    const resultat = nettoyerEvenementSentry(
      evenement({
        request: {
          url: 'https://api.dmsforall.example/api/v1/auth/connexion',
          data: { email: 'client@garage-martin.ch', motDePasse: 'Demo1234!Garage' },
        },
      }),
      HINT_VIDE,
    );

    expect(resultat.request?.data).toBeUndefined();
  });

  it("masque un mot de passe présent dans le corps d'une requête hors authentification", () => {
    const resultat = nettoyerEvenementSentry(
      evenement({
        request: {
          url: 'https://api.dmsforall.example/api/v1/utilisateurs/42',
          data: { nomUtilisateur: 'Test', password: 'secret', role: 'admin' },
        },
      }),
      HINT_VIDE,
    );

    const donnees = resultat.request?.data as Record<string, unknown>;
    expect(donnees.password).toBe('[retiré]');
    expect(donnees.role).toBe('admin');
  });

  it("retire l'identité utilisateur (email, username) et ne garde qu'un id technique éventuel", () => {
    const resultat = nettoyerEvenementSentry(
      evenement({
        user: {
          id: 'utilisateur-uuid-1',
          email: 'jean.dupont@garage-martin.ch',
          username: 'Jean Dupont',
        },
      }),
      HINT_VIDE,
    );

    expect(resultat.user).toEqual({ id: 'utilisateur-uuid-1' });
  });

  it('masque un champ nommé "nom" ou "prenom" (nom de client) dans le corps d\'une requête', () => {
    const resultat = nettoyerEvenementSentry(
      evenement({
        request: {
          url: 'https://api.dmsforall.example/api/v1/clients/42',
          data: { client: { nom: 'Dupont', prenom: 'Jean' } },
        },
      }),
      HINT_VIDE,
    );

    const client = (resultat.request?.data as Record<string, unknown>).client;
    expect(client).toBe('[retiré]');
  });

  it("masque une adresse e-mail apparaissant dans un message d'exception en texte libre", () => {
    const resultat = nettoyerEvenementSentry(
      evenement({
        exception: {
          values: [
            { type: 'Error', value: 'Échec de notification pour jean.dupont@garage-martin.ch' },
          ],
        },
      }),
      HINT_VIDE,
    );

    expect(resultat.exception?.values?.[0]?.value).toBe('Échec de notification pour [retiré]');
  });

  it('masque un VIN (17 caractères) apparaissant dans un texte libre', () => {
    const resultat = nettoyerEvenementSentry(
      evenement({ message: 'Véhicule introuvable pour VIN WVWZZZ1KZAW123456' }),
      HINT_VIDE,
    );

    expect(resultat.message).toBe('Véhicule introuvable pour VIN [retiré]');
  });

  it("masque une plaque d'immatriculation suisse dans un texte libre", () => {
    const resultat = nettoyerEvenementSentry(
      evenement({ message: 'Plaque VD 123456 déjà enregistrée' }),
      HINT_VIDE,
    );

    expect(resultat.message).toBe('Plaque [retiré] déjà enregistrée');
  });

  it('masque un numéro de téléphone suisse dans un texte libre (finding H1)', () => {
    const resultat = nettoyerEvenementSentry(
      evenement({ message: 'Échec de rappel client au 079 123 45 67' }),
      HINT_VIDE,
    );

    expect(resultat.message).toBe('Échec de rappel client au [retiré]');
  });

  it('masque un IBAN dans un texte libre (finding H1)', () => {
    const resultat = nettoyerEvenementSentry(
      evenement({ message: 'Virement refusé pour IBAN CH93 0076 2011 6238 5295 7' }),
      HINT_VIDE,
    );

    expect(resultat.message).toBe('Virement refusé pour IBAN [retiré]');
  });

  it('masque un numéro AVS dans un texte libre (finding H1) — le nom en clair du scénario audit reste un résidu connu, voir la note ci-dessous', () => {
    const resultat = nettoyerEvenementSentry(
      evenement({ message: 'Echec pour le client Jean Dupont (AVS 756.1234.5678.97)' }),
      HINT_VIDE,
    );

    // « Jean Dupont » n'est PAS masqué : contrairement au téléphone/IBAN/AVS/VIN/plaque, un nom
    // de personne n'a pas de forme régulière détectable par motif — seule une clé nommée (`nom`,
    // `client`…) le masque, jamais du texte libre. Résidu documenté, pas une régression : le
    // correctif H1 porte sur les motifs à FORME FIXE (téléphone, IBAN, AVS) réclamés par
    // l'audit, pas sur la détection de noms propres arbitraires (hors de portée d'un regex).
    expect(resultat.message).toBe('Echec pour le client Jean Dupont (AVS [retiré])');
  });

  it('masque un téléphone, un IBAN ou un AVS présent dans un champ nommé (finding H1, clés alignées sur le front)', () => {
    const resultat = nettoyerEvenementSentry(
      evenement({
        extra: { requeteId: 'r-1' },
        request: {
          url: 'https://api.dmsforall.example/api/v1/clients/42',
          data: {
            telephone: '079 123 45 67',
            iban: 'CH93 0076 2011 6238 5295 7',
            avs: '756.1234.5678.97',
            role: 'admin',
          },
        },
      }),
      HINT_VIDE,
    );

    const donnees = resultat.request?.data as Record<string, unknown>;
    expect(donnees.telephone).toBe('[retiré]');
    expect(donnees.iban).toBe('[retiré]');
    expect(donnees.avs).toBe('[retiré]');
    expect(donnees.role).toBe('admin');
  });

  it('nettoie en profondeur les breadcrumbs (message et données)', () => {
    const resultat = nettoyerEvenementSentry(
      evenement({
        breadcrumbs: [
          {
            message: 'Connexion tentée pour jean.dupont@garage-martin.ch',
            data: { motDePasse: 'secret' },
          },
        ],
      }),
      HINT_VIDE,
    );

    expect(resultat.breadcrumbs?.[0]?.message).toBe('Connexion tentée pour [retiré]');
    expect((resultat.breadcrumbs?.[0]?.data as Record<string, unknown>).motDePasse).toBe(
      '[retiré]',
    );
  });

  it('coupe entièrement la query string plutôt que de la rédiger par motif (finding H1)', () => {
    const resultat = nettoyerEvenementSentry(
      evenement({
        request: {
          url: 'https://api.dmsforall.example/api/v1/clients?recherche=Dupont%20Jean&telephone=0791234567',
          query_string: 'recherche=Dupont Jean&telephone=0791234567&iban=CH93007620201162385295 7',
        },
      }),
      HINT_VIDE,
    );

    expect(resultat.request?.url).toBe('https://api.dmsforall.example/api/v1/clients');
    expect(resultat.request?.query_string).toBeUndefined();
  });

  it("reproduit le scénario réaliste de l'audit — recherche « Dupont Jean » avec téléphone, IBAN et AVS : neutralise ce qui a une forme reconnaissable, documente ce qui ne l'a pas", () => {
    const evenementReel = evenement({
      request: {
        url: 'https://api.dmsforall.example/api/v1/clients?recherche=Dupont%20Jean&telephone=0791234567',
        query_string: 'recherche=Dupont Jean&telephone=0791234567&iban=CH93007620201162385295 7',
        data: { libelle: 'Client Jean Dupont, tel 079 123 45 67, IBAN CH93 0076 2011 6238 5295 7' },
      },
      message: 'Echec pour le client Jean Dupont (AVS 756.1234.5678.97)',
    });

    const resultat = nettoyerEvenementSentry(evenementReel, HINT_VIDE);

    // La query string entière est coupée (pas rédigée par motif) : elle emportait « Dupont Jean »
    // avec elle, sans dépendre d'aucune détection de nom.
    expect(resultat.request?.url).toBe('https://api.dmsforall.example/api/v1/clients');
    expect(resultat.request?.query_string).toBeUndefined();

    // Dans le texte libre restant (`data.libelle`, `message`), seules les données à FORME
    // RECONNAISSABLE (téléphone, IBAN, AVS) sont rédigées par motif — c'est ce que le finding H1
    // réclamait. « Jean Dupont » n'a aucune forme régulière détectable (un motif qui l'attraperait
    // attraperait aussi « Garage Martin » ou « Service Pneus ») : il survit tel quel dans ces deux
    // champs. Ce n'est pas une régression du nettoyage, c'est une limite connue et acceptée de
    // l'approche par motifs — documentée ici plutôt que dans un simple commentaire, pour que la
    // suite ne prétende pas couvrir ce qu'elle ne couvre pas.
    expect((resultat.request?.data as Record<string, unknown>).libelle).toBe(
      'Client Jean Dupont, tel [retiré], IBAN [retiré]',
    );
    expect(resultat.message).toBe('Echec pour le client Jean Dupont (AVS [retiré])');

    // Preuve positive et négative combinées, sur l'événement entier : ce qui a une forme fixe a
    // disparu partout ; le nom, lui, est encore présent (résidu connu — voir plus haut). La seule
    // protection réelle contre ce résidu est de ne jamais construire de message d'erreur avec un
    // nom de client en clair (voir la note de tête de fichier pour la conséquence côté code
    // applicatif).
    const serialise = JSON.stringify(resultat);
    expect(serialise).not.toContain('0791234567');
    expect(serialise).not.toContain('079 123 45 67');
    expect(serialise).not.toContain('CH93');
    expect(serialise).not.toContain('756.1234.5678.97');
    expect(serialise).toContain('Jean Dupont');
  });

  it('allow-list sur `extra` : ne laisse passer que les clés techniques connues (finding H1)', () => {
    const resultat = nettoyerEvenementSentry(
      evenement({
        extra: {
          requeteId: 'r-1',
          tenantId: 'a1b2c3d4-...',
          endpoint: '/api/v1/atelier/or/:id',
          role: 'chef_atelier',
          methode: 'GET',
          // Clé inconnue de l'allow-list — droppée intégralement, quel que soit son contenu.
          recherche: 'Dupont Jean',
          libelle: 'Client Jean Dupont',
        },
      }),
      HINT_VIDE,
    );

    expect(resultat.extra).toEqual({
      requeteId: 'r-1',
      tenantId: 'a1b2c3d4-...',
      endpoint: '/api/v1/atelier/or/:id',
      role: 'chef_atelier',
      methode: 'GET',
    });
  });

  it('allow-list sur `contexts` : droppe un namespace inconnu en bloc, garde les namespaces techniques connus', () => {
    const resultat = nettoyerEvenementSentry(
      evenement({
        contexts: {
          runtime: { name: 'node', version: '22.0.0' },
          // Namespace inconnu de l'allow-list, potentiellement posé par un futur appel
          // `scope.setContext('client', {...})` — droppé entièrement.
          client: { nom: 'Dupont', telephone: '079 123 45 67' },
        },
      }),
      HINT_VIDE,
    );

    expect(resultat.contexts).toEqual({ runtime: { name: 'node', version: '22.0.0' } });
  });

  it("masque une clé sensible même à l'intérieur d'un namespace `contexts` autorisé (défense en profondeur)", () => {
    const resultat = nettoyerEvenementSentry(
      evenement({ contexts: { runtime: { name: 'node', email: 'jean.dupont@garage-martin.ch' } } }),
      HINT_VIDE,
    );

    expect(resultat.contexts).toEqual({ runtime: { name: 'node', email: '[retiré]' } });
  });

  it('masque une clé sensible portée par un tag', () => {
    const resultat = nettoyerEvenementSentry(
      evenement({ tags: { tenantId: 'a1b2c3d4-...', email: 'jean.dupont@garage-martin.ch' } }),
      HINT_VIDE,
    );

    expect(resultat.tags).toEqual({ tenantId: 'a1b2c3d4-...', email: '[retiré]' });
  });

  it('laisse intact un événement déjà propre (requeteId, tenantId, endpoint)', () => {
    const resultat = nettoyerEvenementSentry(
      evenement({
        extra: { requeteId: 'r-1', tenantId: 'a1b2c3d4-...', endpoint: '/api/v1/atelier/or/:id' },
      }),
      HINT_VIDE,
    );

    expect(resultat.extra).toEqual({
      requeteId: 'r-1',
      tenantId: 'a1b2c3d4-...',
      endpoint: '/api/v1/atelier/or/:id',
    });
  });

  it('ne lève jamais, même sur un événement vide', () => {
    expect(() => nettoyerEvenementSentry(evenement({}), HINT_VIDE)).not.toThrow();
  });
});

describe('assainirEvenement — même nettoyage que les erreurs, appliqué aux transactions (finding H2)', () => {
  // `assainirEvenement` est la fonction commune derrière `nettoyerEvenementSentry` (beforeSend)
  // ET derrière le `beforeSendTransaction` branché en ligne dans `initialiser-sentry.ts` (voir
  // ce fichier pour pourquoi la lambda n'est pas exportée nommée ici). La tester directement sur
  // une forme de transaction couvre exactement le même chemin de code que celui réellement
  // exécuté par le SDK sur 100% des transactions.
  it("coupe la query string et applique l'allow-list `extra` d'une transaction, exactement comme pour une erreur", () => {
    const resultat = assainirEvenement(
      transaction({
        request: {
          url: 'https://api.dmsforall.example/api/v1/clients?recherche=Dupont%20Jean',
          query_string: 'recherche=Dupont Jean',
        },
        extra: { requeteId: 'r-1', recherche: 'Dupont Jean' },
      }),
    );

    expect(resultat.request?.url).toBe('https://api.dmsforall.example/api/v1/clients');
    expect(resultat.request?.query_string).toBeUndefined();
    expect(resultat.extra).toEqual({ requeteId: 'r-1' });
    expect(resultat.type).toBe('transaction');
  });

  it('ne lève jamais, même sur une transaction vide', () => {
    expect(() => assainirEvenement(transaction({}))).not.toThrow();
  });
});

describe('assainirAttributsSpan — beforeSendSpan (finding H2)', () => {
  it("coupe la query string d'un attribut http.url", () => {
    const resultat = assainirAttributsSpan({
      'http.url': 'https://api.dmsforall.example/api/v1/clients?recherche=Dupont%20Jean',
    });

    expect(resultat['http.url']).toBe('https://api.dmsforall.example/api/v1/clients');
  });

  it("coupe la query string d'un attribut url.full", () => {
    const resultat = assainirAttributsSpan({
      'url.full': 'https://api.dmsforall.example/api/v1/clients?telephone=0791234567',
    });

    expect(resultat['url.full']).toBe('https://api.dmsforall.example/api/v1/clients');
  });

  it('masque intégralement un attribut db.statement (paramètres SQL potentiellement littéraux)', () => {
    const resultat = assainirAttributsSpan({
      'db.statement': "select * from clients where nom = 'Dupont'",
    });

    expect(resultat['db.statement']).toBe('[retiré]');
  });

  it('masque intégralement un attribut url.query', () => {
    const resultat = assainirAttributsSpan({ 'url.query': 'recherche=Dupont%20Jean' });

    expect(resultat['url.query']).toBe('[retiré]');
  });

  it('masque un attribut dont le nom correspond à une clé sensible connue (ex. en-tête Authorization)', () => {
    const resultat = assainirAttributsSpan({
      'http.request.header.authorization': 'Bearer secret',
    });

    expect(resultat['http.request.header.authorization']).toBe('[retiré]');
  });

  it('laisse passer un attribut technique non sensible (http.method, http.status_code)', () => {
    const resultat = assainirAttributsSpan({ 'http.method': 'GET', 'http.status_code': 200 });

    expect(resultat['http.method']).toBe('GET');
    expect(resultat['http.status_code']).toBe(200);
  });

  it("ne lève jamais, même sur un objet d'attributs vide", () => {
    expect(() => assainirAttributsSpan({})).not.toThrow();
  });
});
