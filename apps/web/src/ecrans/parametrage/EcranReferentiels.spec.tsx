import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import type { PageCurseur, ReponsePrestation, ReponseTauxHoraire } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranReferentiels } from './EcranReferentiels';

/** Libellé d'un champ obligatoire : l'étoile (aria-hidden) fait partie du texte du <label>. */
const avecEtoile = (libelle: string) => new RegExp(`^${libelle}\\*?$`);

// Radix Select appelle `hasPointerCapture`/`scrollIntoView`, absents de jsdom.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const CHEMIN_TAUX_HORAIRES = '/api/v1/referentiels/taux-horaires';
const CHEMIN_PRESTATIONS = '/api/v1/referentiels/prestations';

const TAUX_HORAIRE: ReponseTauxHoraire = {
  id: 'th-1',
  code: 'MEC',
  libelle: 'Mécanique générale',
  montantCentimes: 14500,
  valideDuLe: '2026-01-01',
  valideAuLe: null,
};

const PRESTATION: ReponsePrestation = {
  id: 'pr-1',
  code: 'VIDANGE-STD',
  designation: { fr: 'Vidange standard', de: 'Standard-Ölwechsel', it: 'Cambio olio standard' },
  typeLigne: 'forfait',
  tempsBaremeCentiemes: 50,
  tauxHoraireCode: 'MEC',
  tauxTvaPourmille: 81,
  prixCentimes: 9500,
  actif: true,
};

function pageVide<T>(): PageCurseur<T> {
  return { donnees: [], curseurSuivant: null, limite: 100 };
}

function connecterSession(role: (typeof SESSION_TEST)['utilisateur']['role'] = 'chef_atelier') {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
}

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EcranReferentiels />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranReferentiels — mon compte (choix de langue)', () => {
  // `parametrage/referentiels` est le SEUL onglet de Réglages ouvert à tout rôle authentifié sans
  // restriction (voir le commentaire de tête d'`EcranReferentiels` et `routes/droits-routes.ts` :
  // les quatre autres onglets — atelier, sites, facturation, pièces — ferment la ROUTE elle-même à
  // des sous-ensembles de rôles). Un rôle qui ne verrait pas ce sélecteur ici perdrait toute
  // possibilité de changer de langue une fois connecté : les deux tests ci-dessous couvrent un rôle
  // de gouvernance (chef_atelier) et un rôle sans aucun droit d'écriture sur le paramétrage
  // (technicien) pour prouver que l'un comme l'autre l'atteint.
  it.each(['chef_atelier', 'technicien'] as const)(
    'affiche le sélecteur de langue, réutilisé tel quel, pour le rôle %s',
    async (role) => {
      connecterSession(role);
      server.use(
        http.get(CHEMIN_TAUX_HORAIRES, () => HttpResponse.json(pageVide<ReponseTauxHoraire>())),
        http.get(CHEMIN_PRESTATIONS, () => HttpResponse.json(pageVide<ReponsePrestation>())),
      );
      rendre();

      expect(await screen.findByText(i18n.t('parametrage:monCompte.titre'))).toBeInTheDocument();
      const groupe = screen.getByRole('group', { name: i18n.t('commun:langue.choisir') });
      for (const code of ['fr', 'de', 'it']) {
        expect(within(groupe).getByRole('button', { name: code })).toBeInTheDocument();
      }
    },
  );
});

describe('EcranReferentiels — taux horaires', () => {
  it('affiche un état vide avec action de création quand le catalogue est vide (rôle habilité)', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () => HttpResponse.json(pageVide<ReponseTauxHoraire>())),
      http.get(CHEMIN_PRESTATIONS, () => HttpResponse.json(pageVide<ReponsePrestation>())),
    );
    rendre();

    expect(
      await screen.findByText(i18n.t('parametrage:referentiels.tauxHoraires.vide.titre')),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', {
        name: i18n.t('parametrage:referentiels.tauxHoraires.nouveau'),
      }).length,
    ).toBeGreaterThan(0);
  });

  it('affiche la liste des taux horaires chargés', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () =>
        HttpResponse.json({
          donnees: [TAUX_HORAIRE],
          curseurSuivant: null,
          limite: 100,
        } satisfies PageCurseur<ReponseTauxHoraire>),
      ),
      http.get(CHEMIN_PRESTATIONS, () => HttpResponse.json(pageVide<ReponsePrestation>())),
    );
    rendre();

    // Attente sur la colonne « libellé », PAS sur la colonne « code » (`findByText('MEC')`) :
    // `role` (chef_atelier) vient d'une session asynchrone (`useSession`), résolue APRÈS le
    // premier rendu de la ligne — `onOuvrirLigne` passe donc de `undefined` à défini en cours de
    // montage (`peutEcrire ? ouvrirEdition : undefined`, `OngletTauxHoraires.tsx`). La colonne
    // identifiante (« code ») est la seule à changer de FORME selon `onOuvrirLigne` (texte nu ->
    // `<button>`, voir JSDoc `TableComptoir`) : React démonte l'ancien nœud « MEC » pour en
    // remonter un nouveau au lieu de le mettre à jour en place. `findByText('MEC')` peut donc
    // résoudre sur la RÉFÉRENCE PÉRIMÉE du premier rendu et échouer à `toBeInTheDocument()`
    // (mesuré : échec systématique ~450ms, sans rapport avec `asyncUtilTimeout`). La colonne
    // « libellé » ne porte jamais ce bouton (jamais la colonne identifiante ici) : sa structure ne
    // bouge pas quand `role` se résout, `findByText` y est donc fiable — une fois elle affichée,
    // la même passe de rendu a déjà réglé la colonne « code » : vérification synchrone ensuite.
    expect(await screen.findByText('Mécanique générale')).toBeInTheDocument();
    expect(screen.getByText('MEC')).toBeInTheDocument();
    expect(screen.getByText('145.00')).toBeInTheDocument();
  });

  it('crée un nouveau taux horaire et l’envoie au serveur avec le corps attendu', async () => {
    connecterSession('chef_atelier');
    let corpsRecu: unknown;
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () => HttpResponse.json(pageVide<ReponseTauxHoraire>())),
      http.get(CHEMIN_PRESTATIONS, () => HttpResponse.json(pageVide<ReponsePrestation>())),
      http.post(CHEMIN_TAUX_HORAIRES, async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({ ...TAUX_HORAIRE, id: 'th-2', code: 'CARR' }, { status: 201 });
      }),
    );
    rendre();

    const utilisateur = userEvent.setup();
    // Un seul bouton de création, même en état vide (celui de l'en-tête).
    const boutonsNouveau = await screen.findByRole('button', {
      name: i18n.t('parametrage:referentiels.tauxHoraires.nouveau'),
    });
    await utilisateur.click(boutonsNouveau);

    const dialogue = await screen.findByRole('dialog');
    await utilisateur.type(
      within(dialogue).getByLabelText(
        avecEtoile(i18n.t('parametrage:referentiels.tauxHoraires.champs.code')),
      ),
      'CARR',
    );
    await utilisateur.type(
      within(dialogue).getByLabelText(
        avecEtoile(i18n.t('parametrage:referentiels.tauxHoraires.champs.libelle')),
      ),
      'Carrosserie',
    );
    // `ChampMontant` marque ce champ obligatoire d'un « * » ajouté au libellé — correspondance
    // partielle, pas le texte traduit exact. Le champ affiche déjà « 0.00 » (valeur par défaut de
    // création) : il faut le vider avant de taper, sinon la saisie s'ajoute au texte existant.
    const champMontant = within(dialogue).getByLabelText(
      i18n.t('parametrage:referentiels.tauxHoraires.champs.montant'),
      {
        exact: false,
      },
    );
    await utilisateur.clear(champMontant);
    await utilisateur.type(champMontant, '150.00');

    await utilisateur.click(
      within(dialogue).getByRole('button', { name: i18n.t('commun:actions.enregistrer') }),
    );

    await waitFor(() =>
      expect(corpsRecu).toMatchObject({
        code: 'CARR',
        libelle: 'Carrosserie',
        montantCentimes: 15000,
      }),
    );
  });

  it('grise les actions d’écriture pour un rôle sans droit de gouvernance du paramétrage (technicien)', async () => {
    connecterSession('technicien');
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () =>
        HttpResponse.json({
          donnees: [TAUX_HORAIRE],
          curseurSuivant: null,
          limite: 100,
        } satisfies PageCurseur<ReponseTauxHoraire>),
      ),
      http.get(CHEMIN_PRESTATIONS, () => HttpResponse.json(pageVide<ReponsePrestation>())),
    );
    rendre();

    await screen.findByText('MEC');
    expect(
      screen.queryByRole('button', {
        name: i18n.t('parametrage:referentiels.tauxHoraires.nouveau'),
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: i18n.t('commun:actions.modifier') }),
    ).not.toBeInTheDocument();
  });

  it('affiche un état d’erreur avec bouton réessayer sur une panne serveur', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-1',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
      http.get(CHEMIN_PRESTATIONS, () => HttpResponse.json(pageVide<ReponsePrestation>())),
    );
    rendre();

    expect(
      await screen.findByRole('button', { name: i18n.t('commun:actions.reessayer') }),
    ).toBeInTheDocument();
  });

  it('n’envoie rien et affiche une erreur par champ quand le formulaire de création est vide', async () => {
    connecterSession('chef_atelier');
    let appelPost = false;
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () => HttpResponse.json(pageVide<ReponseTauxHoraire>())),
      http.get(CHEMIN_PRESTATIONS, () => HttpResponse.json(pageVide<ReponsePrestation>())),
      http.post(CHEMIN_TAUX_HORAIRES, () => {
        appelPost = true;
        return HttpResponse.json(TAUX_HORAIRE, { status: 201 });
      }),
    );
    rendre();

    const utilisateur = userEvent.setup();
    const boutonsNouveau = await screen.findByRole('button', {
      name: i18n.t('parametrage:referentiels.tauxHoraires.nouveau'),
    });
    await utilisateur.click(boutonsNouveau);

    const dialogue = await screen.findByRole('dialog');
    // Le montant est pré-affiché « 0.00 » (valeur par défaut de `ChampMontant`) : le vider rend
    // le champ réellement vide (`null`), donc effectivement manquant pour le schéma zod.
    await utilisateur.clear(
      within(dialogue).getByLabelText(
        i18n.t('parametrage:referentiels.tauxHoraires.champs.montant'),
        {
          exact: false,
        },
      ),
    );
    await utilisateur.click(
      within(dialogue).getByRole('button', { name: i18n.t('commun:actions.enregistrer') }),
    );

    expect(await within(dialogue).findAllByText(i18n.t('validation:requis'))).not.toHaveLength(0);
    expect(
      within(dialogue).getByLabelText(
        avecEtoile(i18n.t('parametrage:referentiels.tauxHoraires.champs.code')),
      ),
    ).toHaveAttribute('aria-invalid', 'true');
    expect(appelPost).toBe(false);
  });
});

describe('EcranReferentiels — catalogue de prestations', () => {
  it('bascule vers l’onglet prestations et affiche le catalogue chargé', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () => HttpResponse.json(pageVide<ReponseTauxHoraire>())),
      http.get(CHEMIN_PRESTATIONS, () =>
        HttpResponse.json({
          donnees: [PRESTATION],
          curseurSuivant: null,
          limite: 100,
        } satisfies PageCurseur<ReponsePrestation>),
      ),
    );
    rendre();

    const utilisateur = userEvent.setup();
    await utilisateur.click(
      await screen.findByRole('tab', {
        name: i18n.t('parametrage:referentiels.prestations.onglet'),
      }),
    );

    expect(await screen.findByText('VIDANGE-STD')).toBeInTheDocument();
    expect(screen.getByText('Vidange standard')).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('parametrage:referentiels.prestations.statutActif')),
    ).toBeInTheDocument();
  });

  it('affiche l’état vide « première utilisation » du catalogue de prestations', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () => HttpResponse.json(pageVide<ReponseTauxHoraire>())),
      http.get(CHEMIN_PRESTATIONS, () => HttpResponse.json(pageVide<ReponsePrestation>())),
    );
    rendre();

    const utilisateur = userEvent.setup();
    await utilisateur.click(
      await screen.findByRole('tab', {
        name: i18n.t('parametrage:referentiels.prestations.onglet'),
      }),
    );

    expect(
      await screen.findByText(i18n.t('parametrage:referentiels.prestations.vide.titre')),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', {
        name: i18n.t('parametrage:referentiels.prestations.nouvelle'),
      }).length,
    ).toBeGreaterThan(0);
  });

  it('crée une nouvelle prestation et l’envoie au serveur avec le corps attendu', async () => {
    connecterSession('chef_atelier');
    let corpsRecu: unknown;
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () => HttpResponse.json(pageVide<ReponseTauxHoraire>())),
      http.get(CHEMIN_PRESTATIONS, () => HttpResponse.json(pageVide<ReponsePrestation>())),
      http.post(CHEMIN_PRESTATIONS, async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({ ...PRESTATION, id: 'pr-2', code: 'FREINS' }, { status: 201 });
      }),
    );
    rendre();

    const utilisateur = userEvent.setup();
    await utilisateur.click(
      await screen.findByRole('tab', {
        name: i18n.t('parametrage:referentiels.prestations.onglet'),
      }),
    );
    const boutonsNouvelle = await screen.findByRole('button', {
      name: i18n.t('parametrage:referentiels.prestations.nouvelle'),
    });
    await utilisateur.click(boutonsNouvelle);

    const dialogue = await screen.findByRole('dialog');
    await utilisateur.type(
      within(dialogue).getByLabelText(
        avecEtoile(i18n.t('parametrage:referentiels.prestations.champs.code')),
      ),
      'FREINS',
    );
    await utilisateur.type(
      within(dialogue).getByLabelText(avecEtoile(i18n.t('commun:langues.fr'))),
      'Remplacement plaquettes',
    );
    await utilisateur.click(
      within(dialogue).getByRole('button', { name: i18n.t('commun:actions.enregistrer') }),
    );

    await waitFor(() =>
      expect(corpsRecu).toMatchObject({
        code: 'FREINS',
        designationFr: 'Remplacement plaquettes',
        typeLigne: 'forfait',
        tauxTvaPourmille: 81,
      }),
    );
  });

  it('affiche l’erreur de code déjà utilisé renvoyée par le serveur', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () => HttpResponse.json(pageVide<ReponseTauxHoraire>())),
      http.get(CHEMIN_PRESTATIONS, () => HttpResponse.json(pageVide<ReponsePrestation>())),
      http.post(CHEMIN_PRESTATIONS, () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/CONFLIT',
            title: 'Conflit',
            status: 409,
            code: 'CONFLIT',
            instance: 'req-2',
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();

    const utilisateur = userEvent.setup();
    await utilisateur.click(
      await screen.findByRole('tab', {
        name: i18n.t('parametrage:referentiels.prestations.onglet'),
      }),
    );
    const boutonsNouvelle = await screen.findByRole('button', {
      name: i18n.t('parametrage:referentiels.prestations.nouvelle'),
    });
    await utilisateur.click(boutonsNouvelle);

    const dialogue = await screen.findByRole('dialog');
    await utilisateur.type(
      within(dialogue).getByLabelText(
        avecEtoile(i18n.t('parametrage:referentiels.prestations.champs.code')),
      ),
      'VIDANGE-STD',
    );
    await utilisateur.type(
      within(dialogue).getByLabelText(avecEtoile(i18n.t('commun:langues.fr'))),
      'Vidange standard',
    );
    await utilisateur.click(
      within(dialogue).getByRole('button', { name: i18n.t('commun:actions.enregistrer') }),
    );

    expect(
      await within(dialogue).findByText(
        i18n.t('parametrage:referentiels.prestations.erreurCodeExistant'),
      ),
    ).toBeInTheDocument();
    // Le dialogue reste ouvert : aucune saisie perdue.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('n’envoie rien et affiche une erreur par champ quand le formulaire de création est vide', async () => {
    connecterSession('chef_atelier');
    let appelPost = false;
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () => HttpResponse.json(pageVide<ReponseTauxHoraire>())),
      http.get(CHEMIN_PRESTATIONS, () => HttpResponse.json(pageVide<ReponsePrestation>())),
      http.post(CHEMIN_PRESTATIONS, () => {
        appelPost = true;
        return HttpResponse.json(PRESTATION, { status: 201 });
      }),
    );
    rendre();

    const utilisateur = userEvent.setup();
    await utilisateur.click(
      await screen.findByRole('tab', {
        name: i18n.t('parametrage:referentiels.prestations.onglet'),
      }),
    );
    const boutonsNouvelle = await screen.findByRole('button', {
      name: i18n.t('parametrage:referentiels.prestations.nouvelle'),
    });
    await utilisateur.click(boutonsNouvelle);

    const dialogue = await screen.findByRole('dialog');
    await utilisateur.click(
      within(dialogue).getByRole('button', { name: i18n.t('commun:actions.enregistrer') }),
    );

    expect(await within(dialogue).findAllByText(i18n.t('validation:requis'))).not.toHaveLength(0);
    expect(
      within(dialogue).getByLabelText(
        avecEtoile(i18n.t('parametrage:referentiels.prestations.champs.code')),
      ),
    ).toHaveAttribute('aria-invalid', 'true');
    expect(appelPost).toBe(false);
  });

  it('grise les actions d’écriture du catalogue pour un rôle sans droit de gouvernance (technicien)', async () => {
    connecterSession('technicien');
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () => HttpResponse.json(pageVide<ReponseTauxHoraire>())),
      http.get(CHEMIN_PRESTATIONS, () =>
        HttpResponse.json({
          donnees: [PRESTATION],
          curseurSuivant: null,
          limite: 100,
        } satisfies PageCurseur<ReponsePrestation>),
      ),
    );
    rendre();

    const utilisateur = userEvent.setup();
    await utilisateur.click(
      await screen.findByRole('tab', {
        name: i18n.t('parametrage:referentiels.prestations.onglet'),
      }),
    );

    await screen.findByText('VIDANGE-STD');
    expect(
      screen.queryByRole('button', {
        name: i18n.t('parametrage:referentiels.prestations.nouvelle'),
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: i18n.t('commun:actions.modifier') }),
    ).not.toBeInTheDocument();
  });
});

describe('EcranReferentiels — champs obligatoires', () => {
  it('affiche la légende, marque le taux horaire obligatoire et pose aria-required sur les champs requis', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN_TAUX_HORAIRES, () => HttpResponse.json(pageVide<ReponseTauxHoraire>())),
      http.get(CHEMIN_PRESTATIONS, () => HttpResponse.json(pageVide<ReponsePrestation>())),
    );
    rendre();

    expect(screen.getByText(i18n.t('parametrage:obligatoire.legende'))).toBeInTheDocument();
    expect(
      await screen.findByText(i18n.t('parametrage:referentiels.tauxHoraires.auMoinsUn')),
    ).toBeInTheDocument();

    const boutonsNouveau = await screen.findByRole('button', {
      name: i18n.t('parametrage:referentiels.tauxHoraires.nouveau'),
    });
    await userEvent.setup().click(boutonsNouveau);
    const dialogue = await screen.findByRole('dialog');
    for (const cle of ['code', 'libelle']) {
      expect(
        within(dialogue).getByLabelText(
          avecEtoile(i18n.t(`parametrage:referentiels.tauxHoraires.champs.${cle}`)),
        ),
      ).toHaveAttribute('aria-required', 'true');
    }
    // « Valide au » est facultatif : ni étoile ni aria-required.
    expect(
      within(dialogue).getByLabelText(
        i18n.t('parametrage:referentiels.tauxHoraires.champs.valideAuLe'),
      ),
    ).not.toHaveAttribute('aria-required');
  });
});
