import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { ChampEmplacementVehicule } from './ChampEmplacementVehicule';

/**
 * Couverture directe du geste central (migration 0044, Lot C du plan du parc) : affichage
 * avec/sans emplacement, modification en place réussie, échec serveur traité sans perte de
 * saisie. La preuve d'intégration depuis la fiche complète (en-tête -> hook -> `PATCH`) vit dans
 * `ecrans/vehicules/EcranFicheVehicule.spec.tsx` — ce fichier-ci isole le composant.
 */
describe('ChampEmplacementVehicule', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('affiche la valeur et la date de dernière mise à jour quand un emplacement est renseigné', () => {
    renduAvecQueryClient(
      <ChampEmplacementVehicule
        vehiculeId="v1"
        emplacement="Devant, place 3"
        majLe="2026-07-20T09:15:00.000Z"
        peutModifier
      />,
    );

    expect(screen.getByText('Devant, place 3')).toBeInTheDocument();
    // 2026-07-20T09:15:00.000Z (UTC) -> 11:15 heure locale CEST (UTC+2)
    expect(screen.getByText('Noté le 20.07.2026 11:15')).toBeInTheDocument();
  });

  it("affiche un texte neutre — ni erreur ni alarme — quand l'emplacement n'est pas renseigné, sans date", () => {
    renduAvecQueryClient(
      <ChampEmplacementVehicule vehiculeId="v1" emplacement={null} majLe={null} peutModifier />,
    );

    expect(screen.getByText('Emplacement non renseigné')).toBeInTheDocument();
    expect(screen.queryByText(/Noté le/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // DÉFAUT AUDIT — une action proposée à qui ne peut pas l'accomplir (`PATCH /vehicules/{id}`
  // exige `vehicule.modifier`, absent pour technicien/comptable/vendeur/poste_atelier). Preuve
  // directe sur le composant, en plus de la preuve d'intégration depuis la session dans
  // `EcranFicheVehicule.spec.tsx` : `peutModifier={false}` retire le crayon, jamais un bouton
  // désactivé ni un refus après coup.
  it("ne propose pas l'édition quand l'appelant indique l'absence du droit (peutModifier=false)", () => {
    renduAvecQueryClient(
      <ChampEmplacementVehicule
        vehiculeId="v1"
        emplacement="Devant, place 3"
        majLe={null}
        peutModifier={false}
      />,
    );

    expect(screen.getByText('Devant, place 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
  });

  // Le composant est piloté par ses props (`emplacement`/`majLe`), source de vérité = le cache
  // TanStack Query du PARENT (`useVehicule`, voir `EnTeteFicheVehicule`) — pas de re-rendu avec la
  // valeur serveur ici puisqu'aucun parent ne ré-alimente les props dans ce test isolé. La preuve
  // que la fiche affiche bien la NOUVELLE valeur après succès vit dans l'intégration bout en bout
  // (`ecrans/vehicules/EcranFicheVehicule.spec.tsx`) ; ce test-ci prouve ce que le composant
  // possède en propre : le corps envoyé et la sortie du mode édition.
  it('modifie l’emplacement en deux clics (crayon puis valider) : corps correct envoyé, retour en lecture', async () => {
    let corpsRecu: Record<string, unknown> | null = null;
    server.use(
      http.patch('/api/v1/vehicules/v1', async ({ request }) => {
        corpsRecu = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          donnees: {
            id: 'v1',
            emplacementLibre: 'Atelier, pont 2',
            emplacementMajLe: '2026-08-05T10:00:00.000Z',
          },
          avertissements: [],
        });
      }),
    );
    const utilisateur = userEvent.setup();
    renduAvecQueryClient(
      <ChampEmplacementVehicule vehiculeId="v1" emplacement={null} majLe={null} peutModifier />,
    );

    await utilisateur.click(screen.getByRole('button', { name: 'Modifier' }));
    const champ = screen.getByLabelText('Emplacement');
    await utilisateur.type(champ, 'Atelier, pont 2');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(corpsRecu).toEqual({ emplacementLibre: 'Atelier, pont 2' }));
    await waitFor(() => expect(screen.queryByLabelText('Emplacement')).not.toBeInTheDocument());
  });

  it('efface l’emplacement (chaîne vide -> null), pas juste une chaîne vide envoyée telle quelle', async () => {
    let corpsRecu: Record<string, unknown> | null = null;
    server.use(
      http.patch('/api/v1/vehicules/v1', async ({ request }) => {
        corpsRecu = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          donnees: {
            id: 'v1',
            emplacementLibre: null,
            emplacementMajLe: '2026-08-05T10:00:00.000Z',
          },
          avertissements: [],
        });
      }),
    );
    const utilisateur = userEvent.setup();
    renduAvecQueryClient(
      <ChampEmplacementVehicule
        vehiculeId="v1"
        emplacement="Devant, place 3"
        majLe={null}
        peutModifier
      />,
    );

    await utilisateur.click(screen.getByRole('button', { name: 'Modifier' }));
    const champ = screen.getByLabelText('Emplacement');
    await utilisateur.clear(champ);
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(corpsRecu).toEqual({ emplacementLibre: null }));
  });

  it('annule la saisie avec Échap sans appeler le serveur', async () => {
    const utilisateur = userEvent.setup();
    renduAvecQueryClient(
      <ChampEmplacementVehicule
        vehiculeId="v1"
        emplacement="Devant, place 3"
        majLe={null}
        peutModifier
      />,
    );

    await utilisateur.click(screen.getByRole('button', { name: 'Modifier' }));
    const champ = screen.getByLabelText('Emplacement');
    await utilisateur.clear(champ);
    await utilisateur.type(champ, 'Brouillon perdu');
    await utilisateur.keyboard('{Escape}');

    expect(screen.queryByLabelText('Emplacement')).not.toBeInTheDocument();
    expect(screen.getByText('Devant, place 3')).toBeInTheDocument();
  });

  it("affiche une erreur actionnable en cas d'échec serveur, SANS perdre la saisie ni quitter l'édition", async () => {
    server.use(
      http.patch('/api/v1/vehicules/v1', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-1',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    renduAvecQueryClient(
      <ChampEmplacementVehicule vehiculeId="v1" emplacement={null} majLe={null} peutModifier />,
    );

    await utilisateur.click(screen.getByRole('button', { name: 'Modifier' }));
    const champ = screen.getByLabelText('Emplacement');
    await utilisateur.type(champ, 'Chez le carrossier');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(
      await screen.findByText("Une erreur interne s'est produite. Réessayez."),
    ).toBeInTheDocument();
    // Toujours en édition, saisie intacte — aucune perte, standard non négociable (CONTRIBUTING.md).
    expect(screen.getByLabelText('Emplacement')).toHaveValue('Chez le carrossier');
  });

  it('traduit le champ en allemand', async () => {
    await i18n.changeLanguage('de');
    renduAvecQueryClient(
      <ChampEmplacementVehicule vehiculeId="v1" emplacement={null} majLe={null} peutModifier />,
    );

    expect(screen.getByText('Kein Standort erfasst')).toBeInTheDocument();
  });
});
