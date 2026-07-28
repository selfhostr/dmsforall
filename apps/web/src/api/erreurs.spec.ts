import { describe, expect, it, vi } from 'vitest';

import { CODES_ERREUR } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { construireErreurApi, ErreurApi, ErreurReseau, messageErreur } from './erreurs';

async function attendreI18nPret() {
  if (!i18n.isInitialized) {
    await new Promise<void>((resoudre) => i18n.on('initialized', () => resoudre()));
  }
}

describe('construireErreurApi / messageErreur', () => {
  it('extrait le code depuis un problem+json valide et traduit via erreurs:codes.<CODE>', async () => {
    await attendreI18nPret();
    const reponse = new Response(
      JSON.stringify({
        type: 'https://docs.dmsforall.example/erreurs/AUTH_IDENTIFIANTS_INVALIDES',
        title: 'Identifiants invalides',
        status: 401,
        code: 'AUTH_IDENTIFIANTS_INVALIDES',
        instance: 'req-1',
        detail: 'Ne doit jamais apparaître à l’écran',
      }),
      { status: 401, headers: { 'content-type': 'application/problem+json' } },
    );
    const erreur = construireErreurApi(reponse, await reponse.clone().text());
    expect(erreur).toBeInstanceOf(ErreurApi);
    expect(erreur.probleme.code).toBe('AUTH_IDENTIFIANTS_INVALIDES');

    const message = messageErreur(erreur, i18n.t);
    expect(message).toBe('Adresse e-mail ou mot de passe incorrect.');
    expect(message).not.toContain('Ne doit jamais apparaître');
  });

  it('synthétise ERREUR_INTERNE sur un corps HTML non-JSON (ex. 502 de proxy)', async () => {
    await attendreI18nPret();
    const reponse = new Response('<html><body>Bad Gateway</body></html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    });
    const erreur = construireErreurApi(reponse, await reponse.clone().text());
    expect(erreur.probleme.code).toBe('ERREUR_INTERNE');
    expect(messageErreur(erreur, i18n.t)).toBe("Une erreur interne s'est produite. Réessayez.");
  });

  it('synthétise ERREUR_INTERNE si le Content-Type annonce problem+json mais le corps est illisible', async () => {
    await attendreI18nPret();
    const reponse = new Response('{ceci-nest-pas-du-json', {
      status: 500,
      headers: { 'content-type': 'application/problem+json' },
    });
    const erreur = construireErreurApi(reponse, await reponse.clone().text());
    expect(erreur.probleme.code).toBe('ERREUR_INTERNE');
  });

  it('synthétise ERREUR_INTERNE si le code du problem+json est inconnu du contrat', async () => {
    await attendreI18nPret();
    const reponse = new Response(
      JSON.stringify({
        type: 'https://docs.dmsforall.example/erreurs/UN_CODE_QUI_NEXISTE_PAS',
        title: 'Inconnu',
        status: 400,
        code: 'UN_CODE_QUI_NEXISTE_PAS',
        instance: 'req-2',
      }),
      { status: 400, headers: { 'content-type': 'application/problem+json' } },
    );
    const erreur = construireErreurApi(reponse, await reponse.clone().text());
    expect(erreur.probleme.code).toBe('ERREUR_INTERNE');
  });

  it('journalise en console.error le code inconnu et l’URL au lieu de rester silencieux', async () => {
    await attendreI18nPret();
    const espionConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Code délibérément fictif (préfixe `CODE_ARTIFICIEL_` absent de toute famille métier de
      // `CODES_ERREUR` — OR_, VEHICULE_, CLIENT_, POINTAGE_, RDV_, DEVIS_, LIGNE_, PRET_, AUTH_,
      // CONFIRMATION_, IDEMPOTENCE_, FONCTION_) : il ne doit jamais pouvoir devenir un vrai code
      // métier ajouté à l'étape 2, contrairement à un nom plausible qui aurait fini par exister.
      const reponse = new Response(
        JSON.stringify({
          type: 'https://docs.dmsforall.example/erreurs/CODE_ARTIFICIEL_INTROUVABLE',
          title: 'Code de test',
          status: 409,
          code: 'CODE_ARTIFICIEL_INTROUVABLE',
          instance: 'req-3',
        }),
        { status: 409, headers: { 'content-type': 'application/problem+json' } },
      );
      construireErreurApi(reponse, await reponse.clone().text());

      expect(espionConsole).toHaveBeenCalledTimes(1);
      const [message] = espionConsole.mock.calls[0] as [string];
      expect(message).toContain('CODE_ARTIFICIEL_INTROUVABLE');
    } finally {
      espionConsole.mockRestore();
    }
  });

  it('reconnaît les 53 codes de CODES_ERREUR sans jamais retomber sur le repli ERREUR_INTERNE (sauf lui-même)', async () => {
    await attendreI18nPret();
    for (const code of CODES_ERREUR) {
      const reponse = new Response(
        JSON.stringify({
          type: `https://docs.dmsforall.example/erreurs/${code}`,
          title: 'Titre de test',
          status: 400,
          code,
          instance: 'req-contrat',
        }),
        { status: 400, headers: { 'content-type': 'application/problem+json' } },
      );
      const erreur = construireErreurApi(reponse, await reponse.clone().text());
      // Le repli ne doit se déclencher pour aucun de ces codes : le code reconstruit doit être
      // exactement celui envoyé (identité, pas de substitution silencieuse par ERREUR_INTERNE).
      expect(erreur.probleme.code).toBe(code);

      // Chaque code doit aussi avoir sa traduction dans erreurs:codes.<CODE> — sinon i18next
      // rend la clé brute (`codes.<CODE>`) à l'écran, la panne silencieuse que ce test couvre.
      const message = messageErreur(erreur, i18n.t);
      expect(message).toBeTruthy();
      expect(message.startsWith('codes.')).toBe(false);
    }
  });

  it('produit un message réseau distinct pour ErreurReseau', async () => {
    await attendreI18nPret();
    const message = messageErreur(new ErreurReseau(new Error('fetch failed')), i18n.t);
    expect(message).toBe('Vérifiez votre connexion internet, puis réessayez.');
  });
});
