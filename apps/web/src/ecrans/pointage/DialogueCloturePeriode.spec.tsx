import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { DialogueCloturePeriode } from './DialogueCloturePeriode';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

/**
 * Anciennement `EcranCloturePeriodePointage.spec.tsx` — adapté à la fusion (Lot D/E, voir l'en-tête
 * d'`EcranPointage.tsx` et de `DialogueCloturePeriode.tsx`) : ce geste vit désormais dans un
 * dialogue monté par `VueEquipePointage`, plus dans un écran routé séparément. `siteId` est
 * désormais un prop direct (résolu par l'appelant, lui-même sous la gate de site unique
 * d'`EcranPointage`) — le dialogue s'ouvre donc toujours avec un site déjà connu.
 *
 * Test DEVENU CADUC et volontairement RETIRÉ (pas affaibli, RETIRÉ avec justification) :
 * « site requis : invite à choisir un site quand plusieurs sont actifs ». Ce dialogue ne peut plus
 * s'ouvrir sans site — il n'a plus de branche `if (!siteId)` du tout, `siteId` est un prop
 * `string` non optionnel. Le comportement qu'il vérifiait (inviter à choisir un site) est couvert
 * UNE SEULE FOIS par `EcranPointage.spec.tsx` (gate désormais partagée par les deux vues), là où il
 * vivait auparavant en TROIS exemplaires quasi identiques (Journal, Équipe, Clôture de période).
 *
 * Toutes les autres assertions (verrouillage, conflit optimiste générique, résolution des
 * techniciens bloquants, arrêt des pointages bloquants, motif obligatoire au déverrouillage) sont
 * conservées à l'identique.
 */
function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <DialogueCloturePeriode ouvert onOuvertChange={() => {}} siteId="site-1" />
    </QueryClientProvider>,
  );
}

describe('DialogueCloturePeriode', () => {
  it('verrouille une période et affiche le nombre de pointages verrouillés', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.post('/api/v1/pointages/verrouiller-periode', () =>
        HttpResponse.json({ siteId: 'site-1', jusquauLe: '2026-08-01', pointagesVerrouilles: 12 }),
      ),
    );

    rendre();

    const utilisateur = userEvent.setup();
    await utilisateur.click(await screen.findByRole('button', { name: 'Verrouiller' }));

    expect(await screen.findByText('12 pointages verrouillés.')).toBeInTheDocument();
  });

  it('affiche une erreur actionnable si le verrouillage échoue (pointage encore en cours)', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.post('/api/v1/pointages/verrouiller-periode', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/CONFLIT',
            title: 'Conflit',
            status: 409,
            code: 'CONFLIT',
            instance: '',
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    rendre();

    const utilisateur = userEvent.setup();
    await utilisateur.click(await screen.findByRole('button', { name: 'Verrouiller' }));

    expect(
      await screen.findByText('Cet élément a été modifié entre-temps. Rechargez la page.'),
    ).toBeInTheDocument();
  });

  it(
    'régression défaut 4 : distingue le conflit « pointages en cours » du conflit optimiste ' +
      'générique — affiche la vraie cause, le nom du technicien, et propose de les arrêter ' +
      '(jamais un UUID brut, jamais « Rechargez la page »)',
    async () => {
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.post('/api/v1/pointages/verrouiller-periode', () =>
          HttpResponse.json(
            {
              type: 'https://docs.dmsforall.example/erreurs/CONFLIT',
              title: 'Conflit',
              status: 409,
              code: 'CONFLIT',
              instance: '',
              blocages: [
                {
                  type: 'pointage',
                  id: 'pointage-bloquant-1',
                  libelle: 'pointage-bloquant-1',
                  donnees: { technicienId: 'technicien-bloquant-1' },
                },
              ],
              actionsProposees: [{ code: 'ARRETER_POINTAGES' }],
            },
            { status: 409, headers: { 'content-type': 'application/problem+json' } },
          ),
        ),
        http.get('/api/v1/pointages/pointage-bloquant-1', () =>
          HttpResponse.json({
            id: 'pointage-bloquant-1',
            siteId: 'site-1',
            technicienId: 'technicien-bloquant-1',
            technicienNomAffiche: 'Marc Dubosson',
            statut: 'en_cours',
            nature: 'productif_or',
            ordreReparationId: 'or-1',
            ligneOrId: null,
            activiteIndirecte: null,
            source: 'ecran_atelier',
            appareilId: null,
            debutLe: '2026-08-04T07:00:00.000Z',
            finLe: null,
            dureeBruteSecondes: null,
            dureeArrondieCentiemes: null,
            clotureAutomatique: false,
            anomalie: null,
            derniereCorrection: null,
            creeLe: '2026-08-04T07:00:00.000Z',
            modifieLe: '2026-08-04T07:00:00.000Z',
          }),
        ),
        http.post('/api/v1/pointages/pointage-bloquant-1/arreter', () =>
          HttpResponse.json({
            donnees: {
              id: 'pointage-bloquant-1',
              siteId: 'site-1',
              technicienId: 'technicien-bloquant-1',
              technicienNomAffiche: 'Marc Dubosson',
              statut: 'termine',
              nature: 'productif_or',
              ordreReparationId: 'or-1',
              ligneOrId: null,
              activiteIndirecte: null,
              source: 'ecran_atelier',
              appareilId: null,
              debutLe: '2026-08-04T07:00:00.000Z',
              finLe: '2026-08-04T09:00:00.000Z',
              dureeBruteSecondes: 7200,
              dureeArrondieCentiemes: 200,
              clotureAutomatique: false,
              anomalie: null,
              derniereCorrection: null,
              creeLe: '2026-08-04T07:00:00.000Z',
              modifieLe: '2026-08-04T09:00:00.000Z',
            },
            avertissements: [],
          }),
        ),
      );

      rendre();

      const utilisateur = userEvent.setup();
      await utilisateur.click(await screen.findByRole('button', { name: 'Verrouiller' }));

      // La vraie cause, avec le nom résolu — jamais le message de conflit optimiste générique.
      expect(
        await screen.findByText(
          'Pointages encore en cours pour : Marc Dubosson — ils doivent être arrêtés avant de pouvoir verrouiller.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Cet élément a été modifié entre-temps. Rechargez la page.'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('technicien-bloquant-1')).not.toBeInTheDocument();
      expect(screen.queryByText('pointage-bloquant-1')).not.toBeInTheDocument();

      // L'action proposée explicitement par le serveur (`ARRETER_POINTAGES`) est actionnable.
      await utilisateur.click(
        await screen.findByRole('button', { name: 'Arrêter les pointages en cours' }),
      );

      expect(
        await screen.findByText('Pointages arrêtés — vous pouvez verrouiller à nouveau.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          'Pointages encore en cours pour : Marc Dubosson — ils doivent être arrêtés avant de pouvoir verrouiller.',
        ),
      ).not.toBeInTheDocument();
    },
  );

  it('exige un motif pour déverrouiller une période', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));

    rendre();

    const utilisateur = userEvent.setup();
    await utilisateur.click(await screen.findByRole('button', { name: 'Déverrouiller' }));

    expect(
      await screen.findByText('Le motif est obligatoire pour déverrouiller une période.'),
    ).toBeInTheDocument();
  });
});
