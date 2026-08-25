import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { TAILLE_TRANCHE_RECOMMANDEE_OCTETS_DEFAUT, type ReponseDossierReprise } from '@dfa/shared';

import { ErreurApi, ErreurReseau } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';

import { clesReprise } from './cles';
import {
  creerDossierReprise,
  deposerTranche,
  finaliserDepot,
  recupererTranches,
} from './reprise.api';
import { hacherFichierSha256 } from './sha256-incremental';

export type PhaseDepotArchive =
  'attente' | 'verification' | 'creation' | 'envoi' | 'finalisation' | 'termine' | 'erreur';

/** Une clé par CODE i18n (`reprise:depot.erreur.<clé>` ou `reprise:depot.reprise.<clé>`) — jamais
 *  un message construit ici, toujours traduit par l'écran appelant. */
export type TypeErreurDepot =
  'reseau' | 'integrite' | 'tailleInattendue' | 'fichierDifferent' | 'generique';

export interface EtatDepotArchive {
  readonly phase: PhaseDepotArchive;
  /** Sémantique dépendante de `phase` : octets hachés en `verification`, octets envoyés en
   *  `envoi` (départ non-nul en cas de reprise — la progression reste honnête sur le TOTAL du
   *  fichier, jamais réinitialisée à zéro pour un dépôt repris). */
  readonly octetsTraites: number;
  readonly octetsTotal: number;
  readonly erreur: TypeErreurDepot | null;
}

const ETAT_INITIAL: EtatDepotArchive = {
  phase: 'attente',
  octetsTraites: 0,
  octetsTotal: 0,
  erreur: null,
};

/** Backoff exponentiel sur `PUT .../tranches/{numero}` — jusqu'à 5 tentatives supplémentaires.
 *  `PUT` est idempotent par construction (même doctrine que le contrat) : redéposer la même
 *  tranche après une coupure ne crée jamais de doublon, un retry est donc toujours sûr. */
const DELAIS_RETRY_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

function estErreurReessayable(erreur: unknown): boolean {
  if (erreur instanceof ErreurReseau) return true;
  if (erreur instanceof ErreurApi) return erreur.probleme.status >= 500;
  return false;
}

function attendre(delaiMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delaiMs));
}

/** Exécute `action` avec retry/backoff sur erreur réseau ou 5xx — jamais sur une erreur 4xx
 *  (validation, conflit d'état…), qui ne se résoudra pas en réessayant à l'identique. */
async function avecRetry<T>(
  action: () => Promise<T>,
  attendreFn: (ms: number) => Promise<void> = attendre,
): Promise<T> {
  let derniereErreur: unknown;
  for (let tentative = 0; tentative <= DELAIS_RETRY_MS.length; tentative++) {
    try {
      return await action();
    } catch (erreur) {
      derniereErreur = erreur;
      if (!estErreurReessayable(erreur) || tentative === DELAIS_RETRY_MS.length) {
        throw erreur;
      }
      await attendreFn(DELAIS_RETRY_MS[tentative] ?? 16_000);
    }
  }
  throw derniereErreur;
}

function classifierErreur(erreur: unknown): TypeErreurDepot {
  if (erreur instanceof ErreurReseau) return 'reseau';
  if (erreur instanceof ErreurApi) {
    if (erreur.probleme.code === 'REPRISE_EMPREINTE_INVALIDE') return 'integrite';
    if (erreur.probleme.status >= 500) return 'reseau';
  }
  return 'generique';
}

/** Identité légère d'un `File` — sert de clé de cache pour éviter de hacher deux fois le MÊME
 *  fichier (ex. un `reessayer()` après une coupure réseau en plein envoi n'a aucune raison de
 *  relire tout le disque). Ne garantit pas l'unicité au sens cryptographique — seul le hachage
 *  complet le fait — mais suffit à éviter le cas fréquent (retry immédiat, même onglet). */
function identiteFichier(fichier: File): string {
  return `${fichier.name}:${fichier.size}:${fichier.lastModified}`;
}

interface OptionsTeleversement {
  /** Injecté en test pour ne jamais attendre réellement le backoff. */
  readonly attendreFn?: (ms: number) => Promise<void>;
  /** Taille de tranche par défaut — utilisée pour un dépôt REPRIS (le serveur ne redonne jamais
   *  `tailleTrancheRecommandeeOctets` en dehors de `POST /reprise/dossiers`) et comme valeur de
   *  secours avant la réponse de création. Paramétrable pour que les tests n'aient pas besoin de
   *  fichiers de plusieurs Mo pour exercer plusieurs tranches. */
  readonly tailleTrancheOctetsDefaut?: number;
}

/**
 * Orchestrateur du dépôt par tranches — la SEULE étape de tout le parcours de reprise où
 * l'utilisateur fournit quelque chose (mission : « le moins d'interaction possible »). Pas un
 * `useMutation` TanStack Query classique : un dépôt de plusieurs dizaines de Go dure des minutes
 * à des heures, traverse plusieurs centaines d'appels réseau et deux passes de lecture du fichier
 * (vérification puis envoi, voir `sha256-incremental.ts`) — un modèle requête/réponse unique ne
 * convient pas, d'où un état local géré ici et une SEULE invalidation TanStack Query à la fin
 * (`clesReprise.dossiers.liste()`), pour que `useDossierRepriseActif` bascule l'écran vers l'étape
 * Analyse sans attendre son prochain sondage à 4 s.
 *
 * REPRISE APRÈS INTERRUPTION (`dossierEnCours` non `null`, statut `depot_en_cours`) : le point de
 * redémarrage n'est JAMAIS déduit d'une taille de tranche supposée — il vient de
 * `GET .../tranches` (`octetsRecus`, `dernierNumeroTrancheRecuContigu`), la SEULE source de
 * vérité serveur. Le fichier redéposé est d'abord vérifié (taille, puis empreinte complète
 * comparée à `archive.empreinteSha256Annoncee`) avant tout nouvel octet envoyé — un fichier
 * différent ou corrompu est refusé explicitement, jamais mélangé en silence à l'archive déjà
 * reçue.
 */
export function useTeleversementArchive(
  dossierEnCours: ReponseDossierReprise | null,
  options: OptionsTeleversement = {},
) {
  const queryClient = useQueryClient();
  const [etat, setEtat] = useState<EtatDepotArchive>(ETAT_INITIAL);
  const fichierRef = useRef<File | null>(null);
  const empreinteCacheRef = useRef<{ cle: string; empreinte: string } | null>(null);
  const enCoursRef = useRef(false);
  const monteRef = useRef(true);
  const attendreFn = options.attendreFn ?? attendre;
  const tailleTrancheOctetsDefaut =
    options.tailleTrancheOctetsDefaut ?? TAILLE_TRANCHE_RECOMMANDEE_OCTETS_DEFAUT;

  useEffect(
    () => () => {
      monteRef.current = false;
    },
    [],
  );

  const majEtat = useCallback((partiel: Partial<EtatDepotArchive>) => {
    if (!monteRef.current) return;
    setEtat((precedent) => ({ ...precedent, ...partiel }));
  }, []);

  const executer = useCallback(
    async (fichier: File) => {
      try {
        let dossierId: string;
        let empreinte: string;
        let offset: number;
        let numero: number;
        let tailleTranche = tailleTrancheOctetsDefaut;

        const reprendActif = dossierEnCours?.statut === 'depot_en_cours';

        if (reprendActif && dossierEnCours) {
          if (fichier.size !== dossierEnCours.archive.tailleOctetsAnnoncee) {
            majEtat({ phase: 'erreur', erreur: 'tailleInattendue' });
            return;
          }

          const cache = empreinteCacheRef.current;
          const cle = identiteFichier(fichier);
          if (cache && cache.cle === cle) {
            empreinte = cache.empreinte;
            majEtat({
              phase: 'verification',
              octetsTraites: fichier.size,
              octetsTotal: fichier.size,
            });
          } else {
            majEtat({ phase: 'verification', octetsTraites: 0, octetsTotal: fichier.size });
            empreinte = await hacherFichierSha256(fichier, {
              surProgression: (octets) => majEtat({ octetsTraites: octets }),
            });
            empreinteCacheRef.current = { cle, empreinte };
          }

          if (empreinte !== dossierEnCours.archive.empreinteSha256Annoncee) {
            majEtat({ phase: 'erreur', erreur: 'fichierDifferent' });
            return;
          }

          dossierId = dossierEnCours.id;
          const etatTranches = await avecRetry(() => recupererTranches(dossierId), attendreFn);
          offset = etatTranches.octetsRecus;
          numero = (etatTranches.dernierNumeroTrancheRecuContigu ?? -1) + 1;
        } else {
          const cache = empreinteCacheRef.current;
          const cle = identiteFichier(fichier);
          if (cache && cache.cle === cle) {
            empreinte = cache.empreinte;
            majEtat({
              phase: 'verification',
              octetsTraites: fichier.size,
              octetsTotal: fichier.size,
            });
          } else {
            majEtat({ phase: 'verification', octetsTraites: 0, octetsTotal: fichier.size });
            empreinte = await hacherFichierSha256(fichier, {
              surProgression: (octets) => majEtat({ octetsTraites: octets }),
            });
            empreinteCacheRef.current = { cle, empreinte };
          }

          majEtat({ phase: 'creation' });
          const creation = await avecRetry(
            () =>
              creerDossierReprise(
                {
                  tailleOctetsAnnoncee: fichier.size,
                  empreinteSha256Annoncee: empreinte,
                  nomArchiveOriginal: fichier.name,
                },
                genererCleIdempotence(),
              ),
            attendreFn,
          );
          dossierId = creation.dossier.id;
          tailleTranche = creation.tailleTrancheRecommandeeOctets;
          offset = 0;
          numero = 0;
        }

        majEtat({ phase: 'envoi', octetsTraites: offset, octetsTotal: fichier.size });
        while (offset < fichier.size) {
          const fin = Math.min(offset + tailleTranche, fichier.size);
          const tranche = fichier.slice(offset, fin);
          const numeroCourant = numero;
          await avecRetry(() => {
            const controleur = new AbortController();
            return deposerTranche(dossierId, numeroCourant, tranche, controleur.signal);
          }, attendreFn);
          offset = fin;
          numero += 1;
          majEtat({ octetsTraites: offset });
        }

        majEtat({ phase: 'finalisation' });
        await avecRetry(
          () => finaliserDepot(dossierId, { empreinteSha256Calculee: empreinte }),
          attendreFn,
        );

        majEtat({ phase: 'termine', octetsTraites: fichier.size });
        void queryClient.invalidateQueries({ queryKey: clesReprise.dossiers.liste() });
      } catch (erreur) {
        majEtat({ phase: 'erreur', erreur: classifierErreur(erreur) });
      } finally {
        enCoursRef.current = false;
      }
    },
    [dossierEnCours, majEtat, queryClient, attendreFn, tailleTrancheOctetsDefaut],
  );

  const demarrerDepot = useCallback(
    (fichier: File) => {
      if (enCoursRef.current) return;
      enCoursRef.current = true;
      fichierRef.current = fichier;
      setEtat({ phase: 'verification', octetsTraites: 0, octetsTotal: fichier.size, erreur: null });
      void executer(fichier);
    },
    [executer],
  );

  const reessayer = useCallback(() => {
    if (enCoursRef.current || !fichierRef.current) return;
    enCoursRef.current = true;
    const fichier = fichierRef.current;
    majEtat({ erreur: null });
    void executer(fichier);
  }, [executer, majEtat]);

  return { etat, demarrerDepot, reessayer };
}
