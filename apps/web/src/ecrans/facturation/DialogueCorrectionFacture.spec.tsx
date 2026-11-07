import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ReponseDocumentVente } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';
import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { DialogueCorrectionFacture } from './DialogueCorrectionFacture';

beforeAll(() => {
  // Radix Select appelle ces API absentes de jsdom.
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const FACTURE_ID = '11111111-1111-4111-8111-111111111111';
const BROUILLON_ID = '22222222-2222-4222-8222-222222222222';

/** Échappe TOUS les métacaractères d'une regex (pas seulement `()+`) : un libellé avec `.`, `?`,
 *  `[` ou `$` ne doit jamais changer le sens du motif. */
function echapperRegex(texte: string): string {
  return texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function facture(montantRegleCentimes: number): ReponseDocumentVente {
  return {
    id: FACTURE_ID,
    numero: 'F-2026-042',
    figees: {
      clientDesignation: 'Jean Dupont',
      adresseFacturation: {
        rue: 'Rue 1',
        numero: null,
        npa: '1000',
        localite: 'Lausanne',
        pays: 'CH',
      },
    },
    montantRegleCentimes,
  } as unknown as ReponseDocumentVente;
}

function rendre(f: ReponseDocumentVente, onSucces = vi.fn()) {
  renduAvecQueryClient(
    <DialogueCorrectionFacture facture={f} ouvert onOuvertChange={vi.fn()} onSucces={onSucces} />,
  );
  return onSucces;
}

const t = (cle: string) => i18n.t(cle);

describe('DialogueCorrectionFacture — deux gestes', () => {
  it('propose « Corriger l’adresse seulement » (par défaut) et « Refaire la facture (avoir + nouveau brouillon) »', async () => {
    rendre(facture(0));
    const adresse = await screen.findByRole('radio', {
      name: new RegExp(t('facturation:fiche.correction.choix.remplacement.titre')),
    });
    expect(adresse).toBeChecked();
    expect(
      screen.getByRole('radio', {
        name: new RegExp(
          echapperRegex(t('facturation:fiche.correction.choix.brouillon.titre')),
        ),
      }),
    ).not.toBeChecked();
  });

  it('« Refaire la facture » envoie mode=brouillon SANS champsCorriges et navigue vers le brouillon créé', async () => {
    let corps: unknown;
    server.use(
      http.post(`/api/v1/documents-vente/${FACTURE_ID}/corriger`, async ({ request }) => {
        corps = await request.json();
        return HttpResponse.json(
          {
            donnees: {
              mode: 'brouillon',
              avoir: { id: 'avoir-1', numero: 'A-2026-001' },
              factureRemplacement: { id: BROUILLON_ID, numero: null, statut: 'brouillon' },
            },
            avertissements: [],
          },
          { status: 201 },
        );
      }),
    );
    const onSucces = rendre(facture(0));
    const utilisateur = userEvent.setup();

    await utilisateur.click(
      await screen.findByRole('radio', {
        name: new RegExp(
          echapperRegex(t('facturation:fiche.correction.choix.brouillon.titre')),
        ),
      }),
    );
    await utilisateur.click(
      screen.getByRole('button', { name: t('facturation:fiche.correction.confirmerBrouillon') }),
    );

    await waitFor(() => expect(onSucces).toHaveBeenCalledWith('A-2026-001', null, BROUILLON_ID));
    expect(corps).toEqual({
      mode: 'brouillon',
      motif: 'erreur_montant',
      corrigerFicheClient: true,
    });
  });

  it('facture déjà réglée en partie (15000 centimes) : « Refaire la facture » désactivé avec sa raison', async () => {
    rendre(facture(15_000));
    const refaire = await screen.findByRole('radio', {
      name: new RegExp(
        echapperRegex(t('facturation:fiche.correction.choix.brouillon.titre')),
      ),
    });
    expect(refaire).toBeDisabled();
    expect(
      screen.getByText(t('facturation:fiche.correction.choix.brouillon.dejaRegle')),
    ).toBeInTheDocument();
  });
});
