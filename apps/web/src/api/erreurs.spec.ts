import { describe, expect, it, vi } from 'vitest';

import { CODES_ERREUR } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import {
  construireErreurApi,
  ErreurApi,
  ErreurReseau,
  messageErreur,
  messageErreurChamp,
} from './erreurs';

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
    expect(message).toBe(
      'E-mail ou mot de passe incorrect. Vérifiez la saisie, ou cliquez sur « Mot de passe oublié ».',
    );
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
    expect(messageErreur(erreur, i18n.t)).toBe(
      "Un problème inattendu est survenu. Réessayez dans un instant ; s'il revient, prévenez le support en indiquant l'heure.",
    );
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

  it('reconnaît tous les codes de CODES_ERREUR sans jamais retomber sur le repli ERREUR_INTERNE (sauf lui-même) — un échec pointe un code ajouté sans sa traduction erreurs:codes.<CODE>', async () => {
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

describe('ErreurApi — transport des blocages et actionsProposees (invariant n°8)', () => {
  // Les trois corps normatifs de contrats-api-etape-1.md §3.4, repris à l'identique. Le critère
  // n'est pas leur seule présence après construireErreurApi, mais l'égalité de CONTENU : un
  // aplatissement (perte de `donnees`, de `libelle`, ou de `parametres`) doit faire échouer ces
  // tests, pas seulement une disparition pure et simple du champ.

  it('I-08 — construireErreurApi ne perd ni blocages ni actionsProposees (corps texte réel)', async () => {
    const corps = {
      type: 'https://docs.dmsforall.example/erreurs/OR_LIGNES_A_VALIDER',
      title: 'Des lignes attendent encore une décision',
      status: 409,
      code: 'OR_LIGNES_A_VALIDER',
      instance: '01J8Z6M4S3Q0K8V2N7T1R5W9XA',
      blocages: [
        {
          type: 'ligne_or',
          id: '8f2c…a91',
          libelle: 'Disques de frein avant (jeu)',
          donnees: { numeroLigne: 4, totalTtcCentimes: 62000, origine: 'constatee' },
        },
        {
          type: 'ligne_or',
          id: 'b17d…4e0',
          libelle: 'Plaquettes avant',
          donnees: { numeroLigne: 5, totalTtcCentimes: 32000, origine: 'constatee' },
        },
      ],
      actionsProposees: [
        {
          code: 'CREER_DEVIS_COMPLEMENTAIRE',
          methode: 'POST',
          chemin: '/api/v1/ordres-reparation/3a1f…c22/devis-complementaires',
          parametres: { ligneIds: ['8f2c…a91', 'b17d…4e0'], nouveauPlafondSuggereCentimes: 174000 },
        },
        { code: 'VALIDER_LIGNES' },
      ],
    };
    const reponse = new Response(JSON.stringify(corps), {
      status: 409,
      headers: { 'content-type': 'application/problem+json' },
    });
    const erreur = construireErreurApi(reponse, await reponse.clone().text());

    expect(erreur.probleme.code).toBe('OR_LIGNES_A_VALIDER');
    // Contenu exact, pas seulement présence : un aplatissement partiel (ex. `donnees` perdu)
    // doit faire échouer ce test.
    expect(erreur.blocages).toEqual(corps.blocages);
    expect(erreur.actionsProposees).toEqual(corps.actionsProposees);
    expect(erreur.confirmationsRequises).toEqual([]);
  });

  it('I-09 — préserve les blocages "pointage" (deux techniciens) pour OR_POINTAGE_OUVERT', async () => {
    const corps = {
      type: 'https://docs.dmsforall.example/erreurs/OR_POINTAGE_OUVERT',
      title: 'Des pointages sont encore en cours',
      status: 409,
      code: 'OR_POINTAGE_OUVERT',
      instance: '01J8Z6M8YB2H4C6D8E0F2G4H6J',
      blocages: [
        {
          type: 'pointage',
          id: 'c4e1…77a',
          libelle: 'Rui Almeida — depuis 09:12',
          donnees: {
            technicienId: 'd09a…113',
            technicienPrenom: 'Rui',
            debutLe: '2026-07-27T07:12:00.000Z',
            ligneOrId: '8f2c…a91',
          },
        },
        {
          type: 'pointage',
          id: 'e88b…2f5',
          libelle: 'Sarah Berger — depuis 10:04',
          donnees: {
            technicienId: '77c2…908',
            technicienPrenom: 'Sarah',
            debutLe: '2026-07-27T08:04:00.000Z',
            ligneOrId: null,
          },
        },
      ],
      actionsProposees: [{ code: 'ARRETER_POINTAGES' }],
    };
    const reponse = new Response(JSON.stringify(corps), {
      status: 409,
      headers: { 'content-type': 'application/problem+json' },
    });
    const erreur = construireErreurApi(reponse, await reponse.clone().text());

    expect(erreur.blocages).toEqual(corps.blocages);
    expect(erreur.blocages).toHaveLength(2);
    expect(erreur.actionsProposees).toEqual([{ code: 'ARRETER_POINTAGES' }]);
  });

  it('RM-54 / CT-20 — préserve blocages + actionsProposees pour OR_PLAFOND_DEPASSE (ligne ET champ)', async () => {
    const corps = {
      type: 'https://docs.dmsforall.example/erreurs/OR_PLAFOND_DEPASSE',
      title: 'Le plafond autorisé serait dépassé',
      status: 409,
      code: 'OR_PLAFOND_DEPASSE',
      instance: '01J8Z6MC5N7P9R1T3V5X7Z9B1D',
      blocages: [
        {
          type: 'ligne_or',
          id: 'b17d…4e0',
          libelle: 'Plaquettes avant',
          donnees: { totalTtcCentimes: 9000 },
        },
        {
          type: 'champ',
          id: 'plafondCentimes',
          libelle: 'Plafond autorisé 30000, déjà validé 28000, demandé 9000',
          donnees: {
            plafondCentimes: 30000,
            dejaValideCentimes: 28000,
            apresValidationCentimes: 37000,
          },
        },
      ],
      actionsProposees: [
        {
          code: 'CREER_DEVIS_COMPLEMENTAIRE',
          parametres: { ligneIds: ['b17d…4e0'], nouveauPlafondSuggereCentimes: 37000 },
        },
      ],
    };
    const reponse = new Response(JSON.stringify(corps), {
      status: 409,
      headers: { 'content-type': 'application/problem+json' },
    });
    const erreur = construireErreurApi(reponse, await reponse.clone().text());

    expect(erreur.blocages).toEqual(corps.blocages);
    // Le blocage "champ" transporte le détail chiffré du dépassement : le perdre romprait
    // exactement le cas d'usage documenté (ouvrir le panneau de devis pré-rempli).
    expect(erreur.blocages[1]?.donnees).toEqual({
      plafondCentimes: 30000,
      dejaValideCentimes: 28000,
      apresValidationCentimes: 37000,
    });
    expect(erreur.actionsProposees).toEqual(corps.actionsProposees);
  });

  it('les accesseurs blocages/confirmationsRequises/actionsProposees renvoient [] quand le contrat ne les fournit pas', async () => {
    const reponse = new Response(
      JSON.stringify({
        type: 'https://docs.dmsforall.example/erreurs/DROIT_INSUFFISANT',
        title: 'Droit insuffisant',
        status: 403,
        code: 'DROIT_INSUFFISANT',
        instance: 'req-4',
      }),
      { status: 403, headers: { 'content-type': 'application/problem+json' } },
    );
    const erreur = construireErreurApi(reponse, await reponse.clone().text());

    expect(erreur.blocages).toEqual([]);
    expect(erreur.confirmationsRequises).toEqual([]);
    expect(erreur.actionsProposees).toEqual([]);
  });
});

describe('ErreurApi.erreursChamp / champErreur — erreurs de saisie par champ (§3.5 règle 5)', () => {
  it('erreursChamp renvoie [] quand le contrat ne fournit pas `erreurs` (même contrat que blocages)', async () => {
    const reponse = new Response(
      JSON.stringify({
        type: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE',
        title: 'Validation échouée',
        status: 400,
        code: 'VALIDATION_ECHOUEE',
        instance: 'req-5',
      }),
      { status: 400, headers: { 'content-type': 'application/problem+json' } },
    );
    const erreur = construireErreurApi(reponse, await reponse.clone().text());
    expect(erreur.erreursChamp).toEqual([]);
    expect(erreur.champErreur('email')).toBeUndefined();
  });

  it('ne perd pas `erreurs[]` — corps réel PipeZod (rue trop longue) ET corps ErreurMetier (adresse_active_unique)', async () => {
    const corps = {
      type: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE',
      title: 'Validation échouée',
      status: 400,
      code: 'VALIDATION_ECHOUEE',
      instance: 'req-6',
      erreurs: [
        {
          champ: 'rue',
          code: 'too_big',
          message: 'Too big: expected string to have <=200 characters',
        },
        {
          champ: 'type',
          code: 'adresse_active_unique',
          message: 'Une adresse « principale » active existe déjà.',
        },
      ],
    };
    const reponse = new Response(JSON.stringify(corps), {
      status: 400,
      headers: { 'content-type': 'application/problem+json' },
    });
    const erreur = construireErreurApi(reponse, await reponse.clone().text());

    expect(erreur.erreursChamp).toEqual(corps.erreurs);
    expect(erreur.champErreur('rue')).toEqual(corps.erreurs[0]);
    expect(erreur.champErreur('type')).toEqual(corps.erreurs[1]);
    expect(erreur.champErreur('npa')).toBeUndefined();
  });
});

describe('messageErreurChamp — ne jamais afficher un message zod anglais brut à un garagiste', () => {
  it('affiche TEL QUEL le message d’un code MÉTIER (ErreurMetier, non-zod)', async () => {
    await attendreI18nPret();
    const message = messageErreurChamp(
      {
        champ: 'type',
        code: 'adresse_active_unique',
        message: 'Une adresse « principale » active existe déjà.',
      },
      i18n.t,
    );
    expect(message).toBe('Une adresse « principale » active existe déjà.');
  });

  it('ne renvoie JAMAIS le message anglais brut de zod pour un code natif zod (repli générique)', async () => {
    await attendreI18nPret();
    const message = messageErreurChamp(
      {
        champ: 'rue',
        code: 'too_big',
        message: 'Too big: expected string to have <=200 characters',
      },
      i18n.t,
    );
    expect(message).not.toContain('Too big');
    expect(message).not.toContain('expected string');
    expect(message).toBe(
      'Certaines informations sont incorrectes ou incomplètes. Corrigez les champs signalés, puis réessayez.',
    );
  });

  it('reconnaît un e-mail invalide (code zod `invalid_format` sur un champ `email`) via la clé existante `validation:email.invalide`', async () => {
    await attendreI18nPret();
    const message = messageErreurChamp(
      { champ: 'email', code: 'invalid_format', message: 'Invalid email address' },
      i18n.t,
    );
    expect(message).toBe("Cette adresse e-mail n'est pas valide.");

    // Même règle pour un champ imbriqué (`contacts.0.email`) : seul le dernier segment du chemin
    // pointé compte pour reconnaître le nom du champ.
    const messageImbrique = messageErreurChamp(
      { champ: 'contacts.0.email', code: 'invalid_format', message: 'Invalid email address' },
      i18n.t,
    );
    expect(messageImbrique).toBe("Cette adresse e-mail n'est pas valide.");
  });

  it('aucun code natif zod connu ne fait fuiter son message anglais, quel que soit le champ', async () => {
    await attendreI18nPret();
    const CODES_ISSUE_ZOD_TESTES = [
      'invalid_type',
      'invalid_value',
      'too_big',
      'too_small',
      'invalid_format',
      'not_multiple_of',
      'unrecognized_keys',
      'invalid_union',
      'invalid_key',
      'invalid_element',
      'custom',
    ] as const;
    for (const code of CODES_ISSUE_ZOD_TESTES) {
      const message = messageErreurChamp(
        { champ: 'npa', code, message: `Message zod brut en anglais pour ${code}` },
        i18n.t,
      );
      expect(message).not.toContain('Message zod brut');
    }
  });
});
