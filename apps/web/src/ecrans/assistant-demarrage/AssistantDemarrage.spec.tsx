import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { creerSessionTest } from '@/test/session';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { AssistantDemarrage } from './AssistantDemarrage';

const t = (cle: string, options?: Record<string, unknown>) => i18n.t(cle, options);
const API = '/api/v1';

interface Appel {
  readonly methode: string;
  readonly chemin: string;
  readonly corps: unknown;
}

/** Garage neuf : tout est vide, chaque écriture est enregistrée pour être relue par le test. */
function simulerApi(): Appel[] {
  const appels: Appel[] = [];
  const noter = async (request: Request): Promise<unknown> => {
    const corps: unknown = request.method === 'GET' ? undefined : await request.json();
    appels.push({ methode: request.method, chemin: new URL(request.url).pathname, corps });
    return corps;
  };
  server.use(
    http.get(`${API}/auth/moi`, () => HttpResponse.json(creerSessionTest('direction'))),
    http.get(`${API}/accueil/etat-demarrage`, () =>
      HttpResponse.json({
        etapes: {
          coordonnees: false,
          iban: false,
          numeroTva: false,
          tauxHoraire: false,
          motifsRdv: false,
          premierCollaborateur: false,
          borne: false,
        },
      }),
    ),
    http.get(`${API}/parametres-entreprise`, () =>
      HttpResponse.json({
        raisonSociale: 'Garage Test SA',
        numeroTva: null,
        delaiPaiementJoursDefaut: 30,
      }),
    ),
    http.patch(`${API}/parametres-entreprise`, async ({ request }) => {
      const corps = (await noter(request)) as { numeroTva?: string | null };
      return HttpResponse.json({
        raisonSociale: 'Garage Test SA',
        numeroTva: corps.numeroTva ?? null,
        delaiPaiementJoursDefaut: 30,
      });
    }),
    http.get(`${API}/parametres-facturation/creancier`, () =>
      HttpResponse.json({
        nom: null,
        rue: null,
        numero: null,
        npa: null,
        localite: null,
        pays: 'CH',
        iban: null,
        qrIban: null,
        version: 0,
      }),
    ),
    http.patch(`${API}/parametres-facturation/creancier`, async ({ request }) => {
      const corps = (await noter(request)) as object;
      return HttpResponse.json({
        nom: null,
        rue: null,
        numero: null,
        npa: null,
        localite: null,
        pays: 'CH',
        iban: null,
        qrIban: null,
        version: 1,
        ...corps,
      });
    }),
    http.get(`${API}/referentiels/taux-horaires`, () =>
      HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 100 }),
    ),
    http.post(`${API}/referentiels/taux-horaires`, async ({ request }) => {
      const corps = (await noter(request)) as object;
      return HttpResponse.json({ id: 'th-1', valideAuLe: null, ...corps }, { status: 201 });
    }),
    http.get(`${API}/motifs-rendez-vous`, () => HttpResponse.json([])),
    http.post(`${API}/motifs-rendez-vous`, async ({ request }) => {
      const corps = (await noter(request)) as { code: string };
      return HttpResponse.json({ id: corps.code, ...corps, actif: true }, { status: 201 });
    }),
    http.get(`${API}/sites/site-1/parametres-atelier`, () =>
      HttpResponse.json({
        siteId: 'site-1',
        heureOuverture: null,
        heureFermeture: null,
        heureCloturePointage: null,
        capaciteHeuresJourCentiemes: null,
        joursFermeture: [],
        version: 0,
      }),
    ),
    http.patch(`${API}/sites/site-1/parametres-atelier`, async ({ request }) => {
      const corps = (await noter(request)) as object;
      return HttpResponse.json({
        siteId: 'site-1',
        heureCloturePointage: null,
        capaciteHeuresJourCentiemes: null,
        joursFermeture: [],
        version: 1,
        heureOuverture: null,
        heureFermeture: null,
        ...corps,
      });
    }),
    http.get(`${API}/parametres-entreprise/logo`, () => new HttpResponse(null, { status: 404 })),
    http.post(`${API}/utilisateurs`, async ({ request }) => {
      await noter(request);
      return HttpResponse.json(
        {
          utilisateur: { ...creerSessionTest('technicien').utilisateur, id: 'u-2' },
          acces: { motDePasseTemporaire: 'Tmp-Pass-1234' },
        },
        { status: 201 },
      );
    }),
  );
  return appels;
}

function rendre(onFermer = vi.fn()) {
  render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <MemoryRouter>
        <AssistantDemarrage ouvert onFermer={onFermer} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onFermer;
}

const ecrit = (appels: readonly Appel[], methode: string, chemin: string) =>
  appels.filter((a) => a.methode === methode && a.chemin === `${API}${chemin}`);

const bouton = (nom: string) => screen.findByRole('button', { name: nom });
const enregistrer = () => bouton(t('assistant:actions.enregistrerContinuer'));
const titreEtape = (id: string) =>
  screen.findByRole('heading', { name: t(`assistant:etapes.${id}.titre`), level: 3 });

async function remplirGarage() {
  await userEvent.type(await screen.findByLabelText(t('assistant:garage.rue')), 'Rue du Lac');
  await userEvent.type(screen.getByLabelText(t('assistant:garage.npa')), '1950');
  await userEvent.type(screen.getByLabelText(t('assistant:garage.localite')), 'Sion');
}

describe('AssistantDemarrage', () => {
  beforeEach(() => window.localStorage.clear());

  it('étape 1 : adresse enregistrée dans le bloc créancier, raison sociale en lecture seule', async () => {
    const appels = simulerApi();
    rendre();
    const raison = await screen.findByLabelText(t('assistant:garage.raisonSociale'));
    expect(raison).toHaveValue('Garage Test SA');
    expect(raison).toHaveAttribute('readonly');

    await remplirGarage();
    await userEvent.click(await enregistrer());

    await titreEtape('paiements');
    expect(ecrit(appels, 'PATCH', '/parametres-facturation/creancier')[0]?.corps).toEqual({
      nom: 'Garage Test SA',
      rue: 'Rue du Lac',
      numero: null,
      npa: '1950',
      localite: 'Sion',
    });
    // Aucune réponse « assujetti » : le n° TVA n'est pas touché.
    expect(ecrit(appels, 'PATCH', '/parametres-entreprise')).toHaveLength(0);
  });

  it('étape 1 : adresse incomplète bloque l’enregistrement sans rien perdre', async () => {
    const appels = simulerApi();
    rendre();
    await userEvent.type(await screen.findByLabelText(t('assistant:garage.rue')), 'Rue du Lac');
    await userEvent.click(await enregistrer());
    expect(await screen.findByText(t('assistant:garage.erreurNpa'))).toBeInTheDocument();
    expect(screen.getByLabelText(t('assistant:garage.rue'))).toHaveValue('Rue du Lac');
    expect(ecrit(appels, 'PATCH', '/parametres-facturation/creancier')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: t('assistant:actions.passer') })).toBeNull();
  });

  it('TVA : question « assujetti ? » — Oui montre le champ (format vérifié), Non efface le numéro', async () => {
    const appels = simulerApi();
    rendre();
    await remplirGarage();
    expect(screen.queryByLabelText(t('assistant:garage.tva.numero'))).toBeNull();

    await userEvent.click(screen.getByRole('radio', { name: t('assistant:garage.tva.oui') }));
    await userEvent.type(screen.getByLabelText(t('assistant:garage.tva.numero')), 'CHE-12');
    await userEvent.click(await enregistrer());
    expect(await screen.findByText(t('assistant:garage.tva.erreurFormat'))).toBeInTheDocument();
    expect(ecrit(appels, 'PATCH', '/parametres-entreprise')).toHaveLength(0);

    await userEvent.click(screen.getByRole('radio', { name: t('assistant:garage.tva.non') }));
    expect(screen.queryByLabelText(t('assistant:garage.tva.numero'))).toBeNull();
    await userEvent.click(await enregistrer());
    await titreEtape('paiements');
    expect(ecrit(appels, 'PATCH', '/parametres-entreprise')[0]?.corps).toEqual({ numeroTva: null });
  });

  it('TVA : un numéro valide est enregistré', async () => {
    const appels = simulerApi();
    rendre();
    await remplirGarage();
    await userEvent.click(screen.getByRole('radio', { name: t('assistant:garage.tva.oui') }));
    await userEvent.type(
      screen.getByLabelText(t('assistant:garage.tva.numero')),
      'CHE-116.281.710 TVA',
    );
    await userEvent.click(await enregistrer());
    await titreEtape('paiements');
    expect(ecrit(appels, 'PATCH', '/parametres-entreprise')[0]?.corps).toEqual({
      numeroTva: 'CHE-116.281.710 TVA',
    });
  });

  it('parcours complet : paiements, atelier, logo passé, équipe, récapitulatif', async () => {
    const appels = simulerApi();
    const onFermer = rendre();
    await remplirGarage();
    await userEvent.click(await enregistrer());

    // 2. Paiements : un QR-IBAN est rangé dans « qrIban ».
    await titreEtape('paiements');
    await userEvent.type(
      screen.getByLabelText(t('assistant:paiements.iban')),
      'CH44 3199 9123 0008 8901 2',
    );
    await userEvent.click(await enregistrer());
    await titreEtape('atelier');
    expect(ecrit(appels, 'PATCH', '/parametres-facturation/creancier')[1]?.corps).toEqual({
      qrIban: 'CH4431999123000889012',
      iban: null,
    });

    // 3. Atelier : taux prérempli 140.00, 8 motifs cochés, heures d'ouverture.
    const taux = await screen.findByLabelText(t('assistant:atelier.tauxHoraire'));
    expect(taux).toHaveValue('140.00');
    fireEvent.change(screen.getByLabelText(t('assistant:atelier.ouverture')), {
      target: { value: '07:30' },
    });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Devis' }));
    await userEvent.click(await enregistrer());
    await titreEtape('logo');
    expect(ecrit(appels, 'POST', '/referentiels/taux-horaires')[0]?.corps).toMatchObject({
      montantCentimes: 14000,
    });
    expect(ecrit(appels, 'PATCH', '/sites/site-1/parametres-atelier')[0]?.corps).toEqual({
      heureOuverture: '07:30',
      heureFermeture: null,
    });
    const motifs = ecrit(appels, 'POST', '/motifs-rendez-vous').map(
      (a) => (a.corps as { code: string }).code,
    );
    expect(motifs).toHaveLength(7);
    expect(motifs).not.toContain('DEVIS');

    // 4. Logo : facultatif.
    await userEvent.click(await bouton(t('assistant:actions.passer')));

    // 5. Équipe : un compte, le mot de passe temporaire est montré.
    await titreEtape('equipe');
    await userEvent.type(screen.getByLabelText(t('assistant:equipe.prenom')), 'Marc');
    await userEvent.type(screen.getByLabelText(t('assistant:equipe.nom')), 'Rey');
    await userEvent.type(screen.getByLabelText(t('assistant:equipe.email')), 'marc@garage.ch');
    await userEvent.click(await bouton(t('assistant:equipe.inviter')));
    expect(await screen.findByText(/Tmp-Pass-1234/)).toBeInTheDocument();
    expect(ecrit(appels, 'POST', '/utilisateurs')[0]?.corps).toMatchObject({
      prenom: 'Marc',
      nom: 'Rey',
      email: 'marc@garage.ch',
      role: 'technicien',
      siteIds: ['site-1'],
    });
    await userEvent.click(await bouton(t('assistant:equipe.continuer')));

    // 6. Terminé : récapitulatif et trois suites.
    await titreEtape('termine');
    expect(await screen.findByText(t('assistant:termine.recapitulatif'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('assistant:termine.creerOr') })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: t('assistant:termine.ajouterClient') }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: t('assistant:termine.accueil') }));
    expect(onFermer).toHaveBeenCalledTimes(1);
  });

  it('« Je n’encaisse qu’au comptant » : aucun compte enregistré', async () => {
    const appels = simulerApi();
    rendre();
    await remplirGarage();
    await userEvent.click(await enregistrer());
    await titreEtape('paiements');
    await userEvent.click(
      screen.getByRole('checkbox', { name: t('assistant:paiements.comptant') }),
    );
    expect(screen.getByLabelText(t('assistant:paiements.iban'))).toBeDisabled();
    await userEvent.click(await enregistrer());
    await titreEtape('atelier');
    expect(ecrit(appels, 'PATCH', '/parametres-facturation/creancier')).toHaveLength(1);
  });

  it('Retour ramène à l’étape précédente en gardant la saisie', async () => {
    simulerApi();
    rendre();
    await remplirGarage();
    await userEvent.click(await enregistrer());
    await titreEtape('paiements');
    await userEvent.click(await bouton(t('assistant:actions.retour')));
    await titreEtape('garage');
    expect(await screen.findByLabelText(t('assistant:garage.localite'))).toHaveValue('Sion');
  });

  it('erreur d’enregistrement : message actionnable et saisies conservées', async () => {
    simulerApi();
    server.use(
      http.patch(`${API}/parametres-facturation/creancier`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Erreur', status: 500, code: 'ERREUR_INTERNE' },
          { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();
    await remplirGarage();
    await userEvent.click(await enregistrer());
    await waitFor(() =>
      expect(
        screen.getByText(t('assistant:erreur.enregistrement'), { exact: false }),
      ).toBeVisible(),
    );
    expect(screen.getByLabelText(t('assistant:garage.rue'))).toHaveValue('Rue du Lac');
    expect(screen.getByRole('heading', { name: t('assistant:etapes.garage.titre'), level: 3 }));
  });

  it('« Quitter pour l’instant » ferme sans rien exiger', async () => {
    simulerApi();
    const onFermer = rendre();
    await userEvent.click(await bouton(t('assistant:actions.quitter')));
    expect(onFermer).toHaveBeenCalledTimes(1);
  });
});
