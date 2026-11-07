import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';

import type {
  FiltresDocumentsVente,
  OrdreReparationResume,
  PageCurseur,
  ReponseFinancierTableauBord,
  ReponsePaiement,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { listerOrdresReparation } from '@/hooks/atelier/ordres-reparation.api';
import { listerDocumentsVente } from '@/hooks/facturation/documents-vente.api';
import { recupererFinancierTableauBord } from '@/hooks/tableau-bord/tableau-bord.api';

import {
  encaissementsParMoyen,
  resumerFacturesOuvertes,
  resumerOrTermines,
  type EncaissementMoyen,
  type ResumeFacturesOuvertes,
  type ResumeOrTermines,
} from './calculs';
import { chargerToutesLesPages, TAILLE_PAGE } from './pages';
import type { PeriodeIso, PeriodesChiffres } from './periodes';

const STALE_MS = 60_000;

/** Forme commune des sections, qui n'ont besoin que de l'état de la requête. */
export interface EtatSection<T> {
  readonly data: T | undefined;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly refetch: () => void;
}

export interface ChiffreAffairesPeriodes {
  readonly moisCourant: ReponseFinancierTableauBord;
  readonly moisPrecedent: ReponseFinancierTableauBord;
  readonly annee: ReponseFinancierTableauBord;
}

/** CA du mois, du mois précédent et de l'année : trois appels à `GET /tableau-bord/financier`. */
export function useChiffreAffaires(
  periodes: PeriodesChiffres,
  siteId: string | undefined,
): EtatSection<ChiffreAffairesPeriodes> {
  const cles = [periodes.moisCourant, periodes.moisPrecedent, periodes.annee];
  const requetes = useQueries({
    queries: cles.map((periode) => ({
      queryKey: ['facturation', 'chiffres', 'ca', siteId ?? null, periode.du, periode.au],
      queryFn: () => recupererFinancierTableauBord({ siteId, du: periode.du, au: periode.au }),
      staleTime: STALE_MS,
    })),
  });
  const [mois, precedent, annee] = requetes;
  const erreur = requetes.find((requete) => requete.isError);
  return {
    data:
      mois?.data && precedent?.data && annee?.data
        ? { moisCourant: mois.data, moisPrecedent: precedent.data, annee: annee.data }
        : undefined,
    isPending: requetes.some((requete) => requete.isPending),
    isError: erreur !== undefined,
    error: erreur?.error,
    refetch: () => requetes.forEach((requete) => void requete.refetch()),
  };
}

export interface EncaissementsPeriode {
  readonly parMoyen: readonly EncaissementMoyen[];
  readonly totalCentimes: number;
  readonly incomplet: boolean;
}

/** Encaissements d'une période par moyen : `GET /paiements` lu jusqu'au bout, agrégé ici. */
export function useEncaissements(
  periode: PeriodeIso,
  siteId: string | undefined,
): UseQueryResult<EncaissementsPeriode> {
  return useQuery({
    queryKey: ['facturation', 'chiffres', 'encaissements', siteId ?? null, periode.du, periode.au],
    staleTime: STALE_MS,
    queryFn: async () => {
      const { elements, incomplet } = await chargerToutesLesPages<ReponsePaiement>(
        async (curseur) => {
          const parametres = new URLSearchParams({
            dateValeurDu: periode.du,
            dateValeurAu: periode.au,
            limite: String(TAILLE_PAGE),
          });
          if (siteId) parametres.set('siteId', siteId);
          if (curseur) parametres.set('curseur', curseur);
          const page = await requeteApi<PageCurseur<ReponsePaiement>>(
            `/paiements?${parametres.toString()}`,
            { method: 'GET' },
          );
          return page ?? { donnees: [], curseurSuivant: null, limite: TAILLE_PAGE };
        },
      );
      return { ...encaissementsParMoyen(elements), incomplet };
    },
  });
}

export interface FacturesOuvertes extends ResumeFacturesOuvertes {
  readonly incomplet: boolean;
}

/** Factures émises non soldées (`GET /documents-vente`), le retard étant lu sur chaque facture. */
export function useFacturesOuvertes(siteId: string | undefined): UseQueryResult<FacturesOuvertes> {
  return useQuery({
    queryKey: ['facturation', 'chiffres', 'factures-ouvertes', siteId ?? null],
    staleTime: STALE_MS,
    queryFn: async () => {
      const filtres: FiltresDocumentsVente = {
        siteId,
        typeDocument: ['facture'],
        statut: ['emis'],
        statutReglement: ['non_regle', 'partiel'],
        tri: 'dateDocument:asc',
      };
      const { elements, incomplet } = await chargerToutesLesPages((curseur) =>
        listerDocumentsVente(filtres, { limite: TAILLE_PAGE, curseur }),
      );
      return { ...resumerFacturesOuvertes(elements), incomplet };
    },
  });
}

export interface TravauxTermines extends ResumeOrTermines {
  readonly incomplet: boolean;
}

/** OR terminés, pas encore facturés (`GET /ordres-reparation?statut=termine`). */
export function useTravauxTermines(siteId: string | undefined): UseQueryResult<TravauxTermines> {
  return useQuery({
    queryKey: ['facturation', 'chiffres', 'or-termines', siteId ?? null],
    staleTime: STALE_MS,
    queryFn: async () => {
      const { elements, incomplet } = await chargerToutesLesPages<OrdreReparationResume>(
        (curseur) =>
          listerOrdresReparation(
            { statut: 'termine', siteId, tri: 'ouvertLe:asc' },
            { limite: TAILLE_PAGE, curseur },
          ),
      );
      return { ...resumerOrTermines(elements), incomplet };
    },
  });
}
