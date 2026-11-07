import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import i18n from '@/i18n';
import { creerQueryClientTest } from '@/test/utils';

import { useActionOrdreReparation } from './atelier/useTransitionsOrdreReparation';
import * as transitions from './atelier/useTransitionsOrdreReparation';
import { useEmettreDocumentVente } from './facturation/useEmettreDocumentVente';
import { useEncaissement } from './facturation/useEncaissement';
import { useCreerPretCourtoisie } from './courtoisie/useCourtoisie';
import {
  useCreerMotifRendezVous,
  useModifierMotifRendezVous,
} from './parametrage/useMotifsRendezVousGestion';
import { useCreerUtilisateur } from './parametrage/useCreerUtilisateur';
import { useCreerRendezVous } from './rendez-vous/useCreerRendezVous';
import { useReprendreTravailDansOr } from './vehicules/useReprendreTravailDansOr';

/**
 * Lot « toasts de succès » : chaque mutation principale DÉCLARE `meta.succes` (le mécanisme
 * générique de `App.tsx` fait le reste, voir `api/toast-succes-mutation.ts`). On lit la méta sur la
 * mutation enregistrée dans le cache (le réseau échoue, peu importe) et on vérifie que la clé
 * existe vraiment en français — une clé fautive afficherait la clé brute à l'utilisateur.
 */
async function metaDeclaree(utiliser: () => { mutate: (...args: never[]) => void }) {
  const queryClient = creerQueryClientTest();
  const enveloppe = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(utiliser, { wrapper: enveloppe });
  result.current.mutate({} as never);
  await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(1));
  return queryClient.getMutationCache().getAll()[0]?.meta?.succes;
}

const DECLARATIONS: ReadonlyArray<readonly [string, () => { mutate: never }, string]> = [
  [
    'réceptionner OR',
    () => transitions.useReceptionnerOr('or-1') as never,
    'commun:toasts.orReceptionne',
  ],
  ['démarrer OR', () => transitions.useDemarrerOr('or-1') as never, 'commun:toasts.orDemarre'],
  [
    'reprendre travaux',
    () => transitions.useReprendreTravauxOr('or-1') as never,
    'commun:toasts.travauxRepris',
  ],
  [
    'passer en contrôle',
    () => transitions.usePasserEnControleOr('or-1') as never,
    'commun:toasts.orEnControle',
  ],
  [
    'refuser contrôle',
    () => transitions.useRefuserControleOr('or-1') as never,
    'commun:toasts.controleRefuse',
  ],
  [
    'valider contrôle',
    () => transitions.useValiderControleOr('or-1') as never,
    'commun:toasts.controleValide',
  ],
  [
    'terminer OR',
    () => transitions.useTerminerOr('or-1') as never,
    'commun:toasts.travauxTermines',
  ],
  ['rouvrir OR', () => transitions.useRouvrirOr('or-1') as never, 'commun:toasts.orRouvert'],
  ['restituer OR', () => transitions.useRestituerOr('or-1') as never, 'commun:toasts.orRestitue'],
  ['clôturer OR', () => transitions.useCloturerOr('or-1') as never, 'commun:toasts.orCloture'],
  ['annuler OR', () => transitions.useAnnulerOr('or-1') as never, 'commun:toasts.orAnnule'],
  ['émettre une facture', () => useEmettreDocumentVente() as never, 'commun:toasts.factureEmise'],
  [
    'émettre un avoir',
    () => useEmettreDocumentVente({ succes: 'commun:toasts.avoirEmis' }) as never,
    'commun:toasts.avoirEmis',
  ],
  ['encaisser', () => useEncaissement() as never, 'commun:toasts.paiementEnregistre'],
  ['créer un rendez-vous', () => useCreerRendezVous() as never, 'commun:toasts.rdvCree'],
  ['prêt de courtoisie', () => useCreerPretCourtoisie() as never, 'commun:toasts.pretCree'],
  [
    'travail reporté repris',
    () => useReprendreTravailDansOr('v-1') as never,
    'commun:toasts.travailReporteRepris',
  ],
  ['créer un motif de RDV', () => useCreerMotifRendezVous() as never, 'commun:toasts.motifRdvCree'],
  [
    'modifier un motif de RDV',
    () => useModifierMotifRendezVous() as never,
    'commun:toasts.motifRdvModifie',
  ],
  ['créer un employé', () => useCreerUtilisateur() as never, 'commun:toasts.employeCree'],
];

describe('toasts de succès déclarés par les mutations principales', () => {
  it.each(DECLARATIONS)('%s déclare %s', async (_nom, utiliser, cle) => {
    expect(await metaDeclaree(utiliser as never)).toBe(cle);
    expect(i18n.exists(cle, { lng: 'fr' })).toBe(true);
    expect(i18n.exists(cle, { lng: 'de' })).toBe(true);
    expect(i18n.exists(cle, { lng: 'it' })).toBe(true);
  });

  it('les transitions de ligne (action générique sans clé) ne déclarent aucun toast', async () => {
    const succes = await metaDeclaree(
      () => useActionOrdreReparation('or-1', () => Promise.reject(new Error('x'))) as never,
    );
    expect(succes).toBeUndefined();
  });

  it('une émission silencieuse (facturer-et-encaisser) ne déclare rien', async () => {
    expect(
      await metaDeclaree(() => useEmettreDocumentVente({ succes: null }) as never),
    ).toBeUndefined();
  });

  it('un encaissement silencieux ne déclare rien', async () => {
    expect(
      await metaDeclaree(() => useEncaissement({ silencieux: true }) as never),
    ).toBeUndefined();
  });
});
