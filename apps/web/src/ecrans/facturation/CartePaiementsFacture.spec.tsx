import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { CartePaiementsFacture, montantImputeAuDocument } from './CartePaiementsFacture';

const imputation = (documentId: string, montantCentimes: number, nature: string) => ({
  id: `i-${documentId}-${montantCentimes}-${nature}`,
  paiementId: 'p',
  documentId,
  montantCentimes,
  nature,
  imputeLe: '2026-11-08T10:00:00.000Z',
  imputePar: null,
});

function paiement(id: string, moyen: string, montant: number, imputations: object[]) {
  return {
    id,
    moyen,
    montantCentimes: montant,
    dateValeur: '2026-11-08',
    devise: 'CHF',
    imputations,
  };
}

describe('CartePaiementsFacture — recette #64 (FAC-2026-00040)', () => {
  it('affiche payé, solde et chaque paiement imputé, montants exacts', async () => {
    await i18n.changeLanguage('fr');
    server.use(
      http.get('/api/v1/paiements', ({ request }) => {
        expect(new URL(request.url).searchParams.get('documentId')).toBe('doc-1');
        return HttpResponse.json({
          donnees: [
            paiement('p1', 'especes', 10005, [imputation('doc-1', 10005, 'reglement')]),
            paiement('p2', 'carte', 800000, [imputation('doc-1', 800000, 'reglement')]),
            paiement('p3', 'twint', 500000, [imputation('doc-1', 500000, 'reglement')]),
          ],
          curseurSuivant: null,
          limite: 100,
        });
      }),
    );
    renduAvecQueryClient(
      <CartePaiementsFacture
        documentId="doc-1"
        montantRegleCentimes={1310005}
        soldeCentimes={1179995}
        devise="CHF"
      />,
    );
    expect(await screen.findByText('Espèces')).toBeInTheDocument();
    expect(screen.getByText('Carte')).toBeInTheDocument();
    expect(screen.getByText('TWINT')).toBeInTheDocument();
    expect(screen.getByText("13'100.05")).toBeInTheDocument();
    expect(screen.getByText("11'799.95")).toBeInTheDocument();
    expect(screen.getByText('100.05')).toBeInTheDocument();
    expect(screen.getByText("8'000.00")).toBeInTheDocument();
    expect(screen.getByText("5'000.00")).toBeInTheDocument();
  });

  it('montantImputeAuDocument ne compte que le règlement de CE document, hors arrondi', () => {
    const p = paiement('p', 'especes', 10945, [
      imputation('doc-1', 10945, 'reglement'),
      imputation('doc-1', -1, 'arrondi'),
      imputation('doc-2', 500, 'reglement'),
    ]);
    expect(montantImputeAuDocument(p as never, 'doc-1')).toBe(10945);
  });
});
