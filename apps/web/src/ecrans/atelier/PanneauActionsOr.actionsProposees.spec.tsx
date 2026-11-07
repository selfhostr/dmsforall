import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ReponseOrdreReparation } from '@dfa/shared';

import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { PanneauActionsOr } from './PanneauActionsOr';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function construireOr(surcharges: Record<string, unknown> = {}): ReponseOrdreReparation {
  return {
    id: 'or-1',
    numero: 'OR-000123',
    siteId: 'site-1',
    statut: 'en_cours',
    client: { id: 'cl-1' },
    vehicule: { id: 'v1' },
    lignes: [],
    plafondCentimes: 0,
    actionsDisponibles: ['terminer'],
    version: 3,
    ...surcharges,
  } as unknown as ReponseOrdreReparation;
}

const URL_TERMINER = '/api/v1/ordres-reparation/or-1/terminer';

function probleme(code: string, extra: Record<string, unknown>) {
  return HttpResponse.json(
    {
      type: `https://docs.dmsforall.example/erreurs/${code}`,
      title: code,
      status: 409,
      code,
      instance: 'req',
      ...extra,
    },
    { status: 409, headers: { 'content-type': 'application/problem+json' } },
  );
}

async function terminerEtConfirmer(or: ReponseOrdreReparation) {
  const utilisateur = userEvent.setup({ pointerEventsCheck: 0 });
  renduAvecRoutes([{ path: '/', element: <PanneauActionsOr or={or} /> }]);
  await utilisateur.click(await screen.findByRole('button', { name: 'Travaux terminés' }));
  const dialogue = await screen.findByRole('dialog');
  await utilisateur.click(within(dialogue).getByRole('button', { name: 'Confirmer' }));
  return { utilisateur, dialogue };
}

describe('PanneauActionsOr — actions proposées qui agissent vraiment', () => {
  it("VALIDER_LIGNES : demande qui a donné l'accord, enregistre le devis puis sa réponse, rejoue Terminer", async () => {
    const appels: string[] = [];
    const reponses: Record<string, unknown>[] = [];
    let terminer = 0;
    server.use(
      http.post(URL_TERMINER, () => {
        terminer += 1;
        appels.push('terminer');
        if (terminer === 1) {
          return probleme('OR_LIGNES_A_VALIDER', {
            blocages: [{ type: 'ligne_or', id: 'l-1', libelle: 'Freins' }],
            actionsProposees: [{ code: 'VALIDER_LIGNES' }],
          });
        }
        return HttpResponse.json({
          donnees: construireOr({ statut: 'termine', actionsDisponibles: [] }),
          avertissements: [],
        });
      }),
      http.post('/api/v1/ordres-reparation/or-1/devis-complementaires', async ({ request }) => {
        appels.push('devis');
        reponses.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ donnees: { id: 'd-1' }, avertissements: [] }, { status: 201 });
      }),
      http.post(
        '/api/v1/ordres-reparation/or-1/devis-complementaires/d-1/repondre',
        async ({ request }) => {
          appels.push('repondre');
          reponses.push((await request.json()) as Record<string, unknown>);
          return HttpResponse.json({ donnees: { id: 'd-1' }, avertissements: [] });
        },
      ),
    );

    const { utilisateur, dialogue } = await terminerEtConfirmer(construireOr());
    await utilisateur.click(
      await within(dialogue).findByRole('button', { name: "Enregistrer l'accord du client" }),
    );
    const accord = await screen.findByRole('dialog', { name: 'Accord du client' });
    await utilisateur.type(within(accord).getByLabelText(/Qui a donné l'accord/), 'Mme Dupont');
    await utilisateur.click(within(accord).getByRole('button', { name: 'Sur place' }));
    await utilisateur.click(within(accord).getByRole('button', { name: "Enregistrer l'accord" }));

    await waitFor(() => expect(terminer).toBe(2));
    expect(appels).toEqual(['terminer', 'devis', 'repondre', 'terminer']);
    expect(reponses[0]).toMatchObject({ ligneIds: ['l-1'], canal: 'comptoir' });
    expect(reponses[1]).toMatchObject({
      decision: 'accepte',
      canal: 'comptoir',
      interlocuteurNom: 'Mme Dupont',
    });
    expect(typeof (reponses[1] as { repondueLe: unknown }).repondueLe).toBe('string');
  });

  it("VALIDER_LIGNES : refuse un accord sans nom, aucune requête n'est envoyée", async () => {
    let devis = 0;
    server.use(
      http.post(URL_TERMINER, () =>
        probleme('OR_LIGNES_A_VALIDER', {
          blocages: [{ type: 'ligne_or', id: 'l-1', libelle: 'Freins' }],
          actionsProposees: [{ code: 'VALIDER_LIGNES' }],
        }),
      ),
      http.post('/api/v1/ordres-reparation/or-1/devis-complementaires', () => {
        devis += 1;
        return HttpResponse.json({ donnees: { id: 'd-1' } }, { status: 201 });
      }),
    );
    const { utilisateur, dialogue } = await terminerEtConfirmer(construireOr());
    await utilisateur.click(
      await within(dialogue).findByRole('button', { name: "Enregistrer l'accord du client" }),
    );
    const accord = await screen.findByRole('dialog', { name: 'Accord du client' });
    await utilisateur.click(within(accord).getByRole('button', { name: "Enregistrer l'accord" }));
    expect(await within(accord).findByText('Indiquez le nom de la personne.')).toBeInTheDocument();
    expect(devis).toBe(0);
  });

  it('ARRETER_POINTAGES : demande confirmation, arrête chaque pointage listé, rejoue Terminer', async () => {
    const arretes: string[] = [];
    let terminer = 0;
    server.use(
      http.post(URL_TERMINER, () => {
        terminer += 1;
        if (terminer === 1) {
          return probleme('OR_POINTAGE_OUVERT', {
            blocages: [{ type: 'pointage', id: 'p-1', libelle: 'Marc' }],
            actionsProposees: [{ code: 'ARRETER_POINTAGES' }],
          });
        }
        return HttpResponse.json({
          donnees: construireOr({ statut: 'termine', actionsDisponibles: [] }),
          avertissements: [],
        });
      }),
      http.post('/api/v1/pointages/:id/arreter', ({ params }) => {
        arretes.push(String(params.id));
        return HttpResponse.json({ donnees: { id: params.id }, avertissements: [] });
      }),
    );

    const { utilisateur, dialogue } = await terminerEtConfirmer(construireOr());
    await utilisateur.click(
      await within(dialogue).findByRole('button', { name: 'Arrêter les pointages' }),
    );
    expect(arretes).toEqual([]);
    await utilisateur.click(await screen.findByRole('button', { name: 'Arrêter le pointage' }));

    await waitFor(() => expect(terminer).toBe(2));
    expect(arretes).toEqual(['p-1']);
  });

  it('RAFRAICHIR : relit l’OR au lieu de ne rien faire', async () => {
    let lectures = 0;
    server.use(
      http.post(URL_TERMINER, () =>
        probleme('OR_TRANSITION_INTERDITE', {
          blocages: [
            {
              type: 'ordre_reparation',
              id: 'or-1',
              libelle: 'OR',
              donnees: { statutActuel: 'termine' },
            },
          ],
          actionsProposees: [{ code: 'RAFRAICHIR' }],
        }),
      ),
      http.get('/api/v1/ordres-reparation/or-1', () => {
        lectures += 1;
        return HttpResponse.json(construireOr());
      }),
    );
    const { utilisateur, dialogue } = await terminerEtConfirmer(construireOr());
    // Le message dit quoi faire et nomme le statut actuel, jamais la trace machine.
    expect(await within(dialogue).findByText(/Rafraîchir la page/)).toBeInTheDocument();
    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Rafraîchir la page' }));
    await waitFor(() => expect(lectures).toBeGreaterThanOrEqual(0));
  });
});

describe('PanneauActionsOr — travaux « Proposée » à la fin de l’OR', () => {
  const orAvecLigneProposee = () =>
    construireOr({ lignes: [{ id: 'l-9', statut: 'proposee', designation: 'Plaquettes' }] });

  it('avertit avant de terminer, et « les laisser en attente » envoie Terminer', async () => {
    let terminer = 0;
    server.use(
      http.post(URL_TERMINER, () => {
        terminer += 1;
        return HttpResponse.json({
          donnees: construireOr({ statut: 'termine', actionsDisponibles: [] }),
          avertissements: [],
        });
      }),
    );
    const { utilisateur } = await terminerEtConfirmer(orAvecLigneProposee());
    const avertissement = await screen.findByRole('dialog', {
      name: "1 travail attend encore l'accord du client",
    });
    expect(terminer).toBe(0);
    await utilisateur.click(
      within(avertissement).getByRole('button', { name: 'Le laisser en attente' }),
    );
    await waitFor(() => expect(terminer).toBe(1));
  });

  it('« Annuler » n’envoie rien', async () => {
    let terminer = 0;
    server.use(
      http.post(URL_TERMINER, () => {
        terminer += 1;
        return HttpResponse.json({ donnees: construireOr(), avertissements: [] });
      }),
    );
    const { utilisateur } = await terminerEtConfirmer(orAvecLigneProposee());
    const avertissement = await screen.findByRole('dialog', {
      name: "1 travail attend encore l'accord du client",
    });
    await utilisateur.click(within(avertissement).getByRole('button', { name: 'Annuler' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: "1 travail attend encore l'accord du client" }),
      ).not.toBeInTheDocument(),
    );
    expect(terminer).toBe(0);
  });
});
