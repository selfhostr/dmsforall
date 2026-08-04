import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ACTIVITES_INDIRECTES,
  type ActiviteIndirecte,
  type EntreeDemarragePointage,
  type ReponseIdentificationPin,
  type ReponseLigneOr,
  type ReponseOrdreReparation,
} from '@dfa/shared';

import { ErreurApi, ErreurReseau, messageErreur } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { useOrdreReparation } from '@/hooks/atelier/useOrdreReparation';
import { compterLignesAssigneesPointables } from '@/hooks/pointage/lignes-assignees';
import { useArreterPointage } from '@/hooks/pointage/useArreterPointage';
import { useDemarrerPointage } from '@/hooks/pointage/useDemarrerPointage';
import { useIdentificationPin } from '@/hooks/pointage/useIdentificationPin';
import { useMesOrdresAssignes } from '@/hooks/pointage/useMesOrdresAssignes';
import { usePointageOuvertTechnicien } from '@/hooks/pointage/usePointageOuvertTechnicien';
import { useSession } from '@/hooks/useSession';
import { genererUuid } from '@/lib/uuid';

import { CartePointageEnCours } from './CartePointageEnCours';
import { DialogueChoixCiblePointage } from './DialogueChoixCiblePointage';
import { libelleActiviteIndirecte, libelleCiblePointageGenerique } from './libelles';
import { PaveNumerique } from './PaveNumerique';

const LONGUEUR_PIN = 4;

/** Durée d'inactivité tolérée avant retour automatique à l'écran neutre (RM-113/RM-115 côté
 *  écran : une borne partagée ne doit JAMAIS rester ouverte sur l'identité du dernier technicien).
 *  45 s — assez long pour lire son statut et pointer, assez court pour qu'un technicien qui
 *  s'éloigne sans presser « Terminé » ne laisse pas son nom affiché au mur toute la journée. */
const DUREE_INACTIVITE_MS = 45_000;

type TypeErreurIdentification = 'invalide' | 'verrouille' | 'reseau' | 'inconnue';

interface EtatErreurIdentification {
  readonly type: TypeErreurIdentification;
  readonly message: string;
  /** Secondes restantes lues sur `Retry-After` — uniquement pour `type === 'verrouille'`. */
  readonly resteSecondes?: number;
}

function classifierErreur(erreur: unknown, message: string): EtatErreurIdentification {
  if (erreur instanceof ErreurApi) {
    if (erreur.probleme.code === 'POINTAGE_PIN_VERROUILLE') {
      return { type: 'verrouille', message, resteSecondes: erreur.retryApresSecondes };
    }
    if (erreur.probleme.code === 'POINTAGE_PIN_INVALIDE') {
      return { type: 'invalide', message };
    }
    return { type: 'inconnue', message };
  }
  if (erreur instanceof ErreurReseau) {
    return { type: 'reseau', message };
  }
  return { type: 'inconnue', message };
}

function construireEntreeDemarrageBorne(
  base: { readonly technicienId: string; readonly debutLe: string },
  cible:
    | {
        readonly nature: 'productif_ligne';
        readonly ordreReparationId: string;
        readonly ligneOrId: string;
        readonly siteId: string;
      }
    | {
        readonly nature: 'productif_or';
        readonly ordreReparationId: string;
        readonly siteId: string;
      }
    | {
        readonly nature: 'indirect';
        readonly activiteIndirecte: ActiviteIndirecte;
        readonly siteId: string;
      },
): EntreeDemarragePointage {
  const id = genererUuid();
  // `source: 'badge'` — le catalogue `SOURCES_POINTAGE` (`@dfa/shared`) n'a pas encore de valeur
  // dédiée à une identification par borne/PIN (`ecran_atelier`/`badge`/`mobile`/`saisie`,
  // extensible par conception — voir `atelier/enums.ts`). `badge` est la valeur la plus proche du
  // sens réel : une identification par un dispositif partagé, pas un compte personnel connecté
  // (`ecran_atelier`). Ajouter une valeur dédiée (ex. `borne_pin`) toucherait un contrat partagé
  // hors du périmètre d'écriture de cet écran — signalé au coordinateur.
  if (cible.nature === 'productif_ligne') {
    return {
      id,
      siteId: cible.siteId,
      technicienId: base.technicienId,
      debutLe: base.debutLe,
      source: 'badge',
      nature: 'productif_ligne',
      ordreReparationId: cible.ordreReparationId,
      ligneOrId: cible.ligneOrId,
    };
  }
  if (cible.nature === 'productif_or') {
    return {
      id,
      siteId: cible.siteId,
      technicienId: base.technicienId,
      debutLe: base.debutLe,
      source: 'badge',
      nature: 'productif_or',
      ordreReparationId: cible.ordreReparationId,
    };
  }
  return {
    id,
    siteId: cible.siteId,
    technicienId: base.technicienId,
    debutLe: base.debutLe,
    source: 'badge',
    nature: 'indirect',
    activiteIndirecte: cible.activiteIndirecte,
  };
}

/**
 * Borne d'atelier (`/pointage/borne`) — identification par code PIN à 4 chiffres, mode « borne
 * partagée » du pointage (RM-113 → RM-115, RM-129, arbitrage @laupernoe du 03.08.2026, NE PAS ROUVRIR).
 * Écran tactile mural, technicien mains sales/gantées, aucun clavier : pavé numérique large
 * (`PaveNumerique`), aucun texte saisi au clavier.
 *
 * CE QUE LE PIN N'EST PAS (contrat `pointage/identification.ts`, `@dfa/shared`) : ce n'est PAS un
 * mot de passe. `POST /pointages/identification` n'ouvre AUCUNE session (pas de cookie, pas de
 * jeton) — la réponse sert UNIQUEMENT à afficher un accueil nominatif et à porter `technicienId`
 * aux appels de pointage suivants, tant que CET écran reste ouvert sur cette identité (état LOCAL,
 * jamais persisté). Le droit d'écrire un pointage reste entièrement porté par la SESSION DE LA
 * BORNE (compte de service `poste_atelier`, authentifiée normalement — voir `RouteProtegee` dans
 * `routeur.tsx`, qui restreint déjà cette route à ce seul rôle). Aucun geste sensible (signature,
 * transition d'OR, réponse de devis) n'est exposé ici — seuls démarrer/arrêter/mettre en pause un
 * pointage, cohérent avec RM-115.
 *
 * DEUX ÉTATS EXCLUSIFS, jamais mélangés : `identifie === undefined` -> pavé de saisie PIN neutre ;
 * `identifie` défini -> panneau du technicien reconnu (son statut, ses OR du jour, ses activités).
 * Retour à l'état neutre par TROIS voies : bouton explicite « Terminé », inactivité
 * (`DUREE_INACTIVITE_MS`, timer nettoyé au démontage ET à chaque changement d'identité), ou une
 * nouvelle identification réussie qui remplace directement l'identité affichée.
 *
 * MODE DU SITE (borne partagée vs session personnelle) : non exposé côté API au moment d'écrire
 * cet écran — recherché dans `apps/api/src/parametrage/` et le schéma `site`, AUCUN paramètre de
 * ce type n'y existe (seul `poste_atelier`, un RÔLE de compte, existe déjà). Cet écran est donc
 * rendu ATTEIGNABLE PAR SA ROUTE (`/pointage/borne`) sans dépendre d'un paramétrage de site — un
 * garage qui choisit le mode borne y navigue directement (lien de menu ou favori sur la tablette
 * murale). Signalé au coordinateur : si le paramètre de site est ajouté plus tard côté API, cet
 * écran devra probablement devenir la destination conditionnelle d'une redirection automatique.
 */
export function EcranBornePointage() {
  const { t } = useTranslation(['pointage', 'commun']);
  const { data: session, isPending: sessionEnAttente, isError: sessionEnErreur } = useSession();

  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<EtatErreurIdentification | undefined>(undefined);
  const [compteARebours, setCompteARebours] = useState(0);
  const [identifie, setIdentifie] = useState<ReponseIdentificationPin | undefined>(undefined);
  const [orSelectionneId, setOrSelectionneId] = useState<string | undefined>(undefined);
  const [erreurAction, setErreurAction] = useState<string | undefined>(undefined);
  const [enChainage, setEnChainage] = useState(false);

  const identification = useIdentificationPin();
  const technicienId = identifie?.technicienId;
  const siteId = session?.sites[0]?.id;

  const pointageOuvert = usePointageOuvertTechnicien(technicienId);
  const mesOrdres = useMesOrdresAssignes(technicienId);
  const requeteOrSelectionne = useOrdreReparation(orSelectionneId);

  const demarrer = useDemarrerPointage();
  const arreter = useArreterPointage();

  /* ---------------------------------------------------------------------------------------- */
  /* Retour automatique à l'écran neutre (inactivité) — borne PARTAGÉE, jamais laissée ouverte  */
  /* ---------------------------------------------------------------------------------------- */

  const timerInactiviteRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const revenirEcranNeutre = useCallback(() => {
    setIdentifie(undefined);
    setOrSelectionneId(undefined);
    setErreurAction(undefined);
    setCode('');
    setErreur(undefined);
  }, []);

  const reinitialiserInactivite = useCallback(() => {
    if (timerInactiviteRef.current) clearTimeout(timerInactiviteRef.current);
    timerInactiviteRef.current = setTimeout(revenirEcranNeutre, DUREE_INACTIVITE_MS);
  }, [revenirEcranNeutre]);

  useEffect(() => {
    if (!identifie) return undefined;
    reinitialiserInactivite();
    // Nettoyé au démontage ET à chaque changement d'identité (dépendance `identifie`) — jamais un
    // timer qui survit à l'écran ou qui pointe encore sur l'identité précédente.
    return () => {
      if (timerInactiviteRef.current) clearTimeout(timerInactiviteRef.current);
    };
  }, [identifie, reinitialiserInactivite]);

  /* ---------------------------------------------------------------------------------------- */
  /* Saisie du PIN — pavé tactile ET clavier physique (une borne peut en avoir un branché)      */
  /* ---------------------------------------------------------------------------------------- */

  const clavierVerrouille =
    identification.isPending || (erreur?.type === 'verrouille' && compteARebours > 0);

  const soumettre = useCallback(
    async (valeur: string) => {
      try {
        const reponse = await identification.mutateAsync(valeur);
        setIdentifie(reponse);
        setCode('');
        setErreur(undefined);
      } catch (erreurCapturee) {
        setCode('');
        setErreur(classifierErreur(erreurCapturee, messageErreur(erreurCapturee, t)));
      }
    },
    [identification, t],
  );

  const ajouterChiffre = useCallback(
    (chiffre: string) => {
      if (clavierVerrouille) return;
      setErreur(undefined);
      setCode((precedent) => {
        if (precedent.length >= LONGUEUR_PIN) return precedent;
        const suivant = precedent + chiffre;
        if (suivant.length === LONGUEUR_PIN) {
          void soumettre(suivant);
        }
        return suivant;
      });
    },
    [clavierVerrouille, soumettre],
  );

  const effacer = useCallback(() => {
    if (clavierVerrouille) return;
    setCode((precedent) => precedent.slice(0, -1));
  }, [clavierVerrouille]);

  const validerManuel = useCallback(() => {
    if (clavierVerrouille || code.length !== LONGUEUR_PIN) return;
    void soumettre(code);
  }, [clavierVerrouille, code, soumettre]);

  // Clavier physique — actif UNIQUEMENT à l'écran de saisie (pas de raccourcis une fois identifié,
  // pour ne pas interférer avec la navigation/focus du panneau technicien).
  useEffect(() => {
    if (identifie) return undefined;
    function surTouche(evenement: KeyboardEvent) {
      if (/^[0-9]$/.test(evenement.key)) {
        ajouterChiffre(evenement.key);
      } else if (evenement.key === 'Backspace') {
        effacer();
      } else if (evenement.key === 'Enter') {
        validerManuel();
      }
    }
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [identifie, ajouterChiffre, effacer, validerManuel]);

  // Compte à rebours du verrouillage 423 — désactive le pavé le temps annoncé par `Retry-After`,
  // puis efface l'erreur pour repartir sur un pavé neutre (RM-129 : la borne redevient utilisable
  // seule, sans intervention du chef d'atelier, une fois le palier écoulé).
  //
  // UN SEUL effet, délibérément : `setErreur(undefined)` n'est déclenché QUE depuis l'intervalle,
  // au tick qui fait réellement passer le compteur à 0 — jamais depuis un second `useEffect`
  // séparé qui observerait `compteARebours`. Deux effets distincts (essayé puis abandonné) se
  // déclenchent tous les deux APRÈS LE MÊME rendu, sur les valeurs FERMÉES de CE rendu : au tout
  // premier rendu suivant un 423, `compteARebours` vaut encore `0` (sa valeur précédente, la mise
  // à jour posée par le premier effet n'est pas encore visible du second) — un effet de nettoyage
  // séparé lisait donc cette valeur non rafraîchie et effaçait l'erreur INSTANTANÉMENT, avant même
  // le premier tick. Constaté en test (`EcranBornePointage.spec.tsx`, scénario 423).
  useEffect(() => {
    if (erreur?.type !== 'verrouille' || !erreur.resteSecondes) {
      setCompteARebours(0);
      return undefined;
    }
    setCompteARebours(erreur.resteSecondes);
    const intervalle = setInterval(() => {
      setCompteARebours((valeur) => {
        if (valeur <= 1) {
          clearInterval(intervalle);
          setErreur(undefined);
          return 0;
        }
        return valeur - 1;
      });
    }, 1000);
    return () => clearInterval(intervalle);
  }, [erreur]);

  /* ---------------------------------------------------------------------------------------- */
  /* Panneau du technicien identifié — démarrer / arrêter / mettre en pause                    */
  /* ---------------------------------------------------------------------------------------- */

  async function demarrerEtSuivre(
    cible:
      | {
          readonly nature: 'productif_ligne';
          readonly ordreReparationId: string;
          readonly ligneOrId: string;
          readonly siteId: string;
        }
      | {
          readonly nature: 'productif_or';
          readonly ordreReparationId: string;
          readonly siteId: string;
        }
      | {
          readonly nature: 'indirect';
          readonly activiteIndirecte: ActiviteIndirecte;
          readonly siteId: string;
        },
  ) {
    if (!technicienId) return;
    setErreurAction(undefined);
    try {
      const entree = construireEntreeDemarrageBorne(
        { technicienId, debutLe: new Date().toISOString() },
        cible,
      );
      await demarrer.mutateAsync({ entree, idempotencyKey: genererCleIdempotence() });
    } catch (erreurCapturee) {
      setErreurAction(messageErreur(erreurCapturee, t));
      throw erreurCapturee;
    }
  }

  function handleChoisirLigne(or: ReponseOrdreReparation, ligne: ReponseLigneOr) {
    setOrSelectionneId(undefined);
    reinitialiserInactivite();
    void demarrerEtSuivre({
      nature: 'productif_ligne',
      ordreReparationId: or.id,
      ligneOrId: ligne.id,
      siteId: or.siteId,
    });
  }

  function handleChoisirOrEntier(or: ReponseOrdreReparation) {
    setOrSelectionneId(undefined);
    reinitialiserInactivite();
    void demarrerEtSuivre({ nature: 'productif_or', ordreReparationId: or.id, siteId: or.siteId });
  }

  function handleDemarrerActiviteIndirecte(activite: ActiviteIndirecte) {
    if (!siteId) return;
    reinitialiserInactivite();
    void demarrerEtSuivre({ nature: 'indirect', activiteIndirecte: activite, siteId });
  }

  async function handleArreter() {
    if (!pointageOuvert.data || !technicienId) return;
    reinitialiserInactivite();
    setErreurAction(undefined);
    const p = pointageOuvert.data;
    try {
      await arreter.mutateAsync({
        id: p.id,
        technicienId,
        siteId: p.siteId,
        entree: { finLe: new Date().toISOString() },
        idempotencyKey: genererCleIdempotence(),
      });
    } catch (erreurCapturee) {
      setErreurAction(messageErreur(erreurCapturee, t));
    }
  }

  async function handlePause() {
    if (!pointageOuvert.data || !technicienId) return;
    reinitialiserInactivite();
    setErreurAction(undefined);
    setEnChainage(true);
    const p = pointageOuvert.data;
    try {
      await arreter.mutateAsync({
        id: p.id,
        technicienId,
        siteId: p.siteId,
        entree: { finLe: new Date().toISOString() },
        idempotencyKey: genererCleIdempotence(),
      });
      await demarrerEtSuivre({ nature: 'indirect', activiteIndirecte: 'pause', siteId: p.siteId });
    } catch (erreurCapturee) {
      setErreurAction(messageErreur(erreurCapturee, t));
    } finally {
      setEnChainage(false);
    }
  }

  const enTraitement = demarrer.isPending || arreter.isPending || enChainage;

  /* ---------------------------------------------------------------------------------------- */
  /* Rendu                                                                                      */
  /* ---------------------------------------------------------------------------------------- */

  if (sessionEnAttente) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="sr-only">{t('pointage:identification.titre')}</h1>
        <EtatChargement lignes={4} />
      </div>
    );
  }

  if (sessionEnErreur || !session) {
    return (
      <EtatErreur
        titre={t('pointage:identification.erreur.titre')}
        description={t('pointage:identification.erreur.session')}
      />
    );
  }

  if (!siteId) {
    // Un compte `poste_atelier` est TOUJOURS scopé à exactement un site (contrainte SQL
    // `utilisateur_site_compte_de_service_chk`, voir `pin.controller.ts`) — cette branche ne
    // devrait jamais s'atteindre en usage normal ; état vide honnête plutôt qu'un écran cassé si
    // un compte de service est un jour mal configuré.
    return (
      <EtatVide
        titre={t('pointage:identification.erreur.titre')}
        description={t('pointage:siteRequis.description')}
      />
    );
  }

  return (
    <div
      className="flex min-h-[70vh] flex-col items-center justify-center gap-8"
      onPointerDown={identifie ? reinitialiserInactivite : undefined}
    >
      {!identifie ? (
        <div className="flex flex-col items-center gap-6 text-center">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {t('pointage:identification.titre')}
            </h1>
            <p className="mt-2 texte-corps text-muted-foreground">
              {t('pointage:identification.saisisseCode')}
            </p>
          </div>

          {erreur ? (
            <Alert
              variant={erreur.type === 'verrouille' ? 'avertissement' : 'destructive'}
              className="max-w-sm"
            >
              <AlertDescription className="flex flex-col items-center gap-1 text-center">
                {/* Deux `<span>` distincts, pas un `<br/>` au milieu d'un seul bloc de texte : un
                 *  bloc de texte fragmenté par un `<br/>` concatène ses deux phrases en un seul
                 *  `textContent` sans espace pour Testing Library (`findByText` ne peut alors plus
                 *  cibler la première phrase seule) — et c'est aussi la lecture la plus naturelle
                 *  pour un lecteur d'écran (deux annonces, pas une phrase soudée). */}
                <span>{erreur.message}</span>
                {erreur.type === 'verrouille' && compteARebours > 0 ? (
                  <span>
                    {t('pointage:identification.pave.reessayerDans', { secondes: compteARebours })}
                  </span>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <PaveNumerique
            longueur={code.length}
            longueurMax={LONGUEUR_PIN}
            desactive={clavierVerrouille}
            onChiffre={ajouterChiffre}
            onEffacer={effacer}
            onValider={validerManuel}
          />
        </div>
      ) : (
        <div className="flex w-full max-w-2xl flex-col gap-6">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t('pointage:identification.bonjour', { prenom: identifie.prenom })}
            </h1>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-14 text-base"
              onClick={revenirEcranNeutre}
            >
              {t('pointage:identification.terminer')}
            </Button>
          </div>

          {pointageOuvert.isPending || mesOrdres.isPending ? <EtatChargement lignes={4} /> : null}

          {pointageOuvert.isError ? (
            <EtatErreur
              titre={t('pointage:technicien.erreur.titre')}
              description={messageErreur(pointageOuvert.error, t)}
              onReessayer={() => void pointageOuvert.refetch()}
            />
          ) : null}

          {!pointageOuvert.isPending && !pointageOuvert.isError ? (
            pointageOuvert.data ? (
              <CartePointageEnCours
                pointage={pointageOuvert.data}
                libelleCible={libelleCiblePointageGenerique(pointageOuvert.data, t)}
                onArreter={() => void handleArreter()}
                onPause={
                  pointageOuvert.data.nature === 'productif_ligne' ||
                  pointageOuvert.data.nature === 'productif_or'
                    ? () => void handlePause()
                    : undefined
                }
                // Pas de « Reprendre » sur la borne : à la différence de `EcranPointageTechnicien`
                // (mémoire de la dernière cible pendant la vie de l'onglet), une borne est
                // PARTAGÉE — ne rien retenir d'une identité à l'autre est le comportement honnête,
                // même dégradation assumée que le F5 sur l'écran personnel.
                onReprendre={undefined}
                enTraitement={enTraitement}
                messageErreur={erreurAction}
              />
            ) : (
              <>
                {erreurAction ? (
                  <EtatErreur
                    titre={t('pointage:technicien.erreur.titre')}
                    description={erreurAction}
                  />
                ) : null}

                <Card>
                  <CardHeader>
                    <CardTitle className="texte-titre-section">
                      {t('pointage:technicien.mesOrs.titre')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {mesOrdres.isError ? (
                      <EtatErreur
                        titre={t('pointage:technicien.erreur.titre')}
                        description={messageErreur(mesOrdres.error, t)}
                        onReessayer={() => void mesOrdres.refetch()}
                      />
                    ) : (mesOrdres.data ?? []).length === 0 ? (
                      <EtatVide titre={t('pointage:vide.aucunOr')} description="" />
                    ) : (
                      <div className="flex flex-col gap-3">
                        {(mesOrdres.data ?? []).map((or) => (
                          <button
                            key={or.id}
                            type="button"
                            disabled={enTraitement}
                            onClick={() => {
                              reinitialiserInactivite();
                              setOrSelectionneId(or.id);
                            }}
                            className="flex min-h-[64px] flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="flex flex-col gap-1">
                              <span className="font-medium">{or.numero}</span>
                              <IdentiteVehicule vehicule={or.vehicule} taillePlaque="sm" />
                              <IdentiteClient client={or.client} />
                            </div>
                            <span className="texte-libelle text-muted-foreground">
                              {t('pointage:technicien.mesOrs.lignesAssignees', {
                                count: compterLignesAssigneesPointables(or, technicienId as string),
                              })}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="texte-titre-section">
                      {t('pointage:activites.titre')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {ACTIVITES_INDIRECTES.map((activite) => (
                        <Button
                          key={activite}
                          size="lg"
                          variant="outline"
                          className="h-16 text-base"
                          disabled={enTraitement}
                          onClick={() => handleDemarrerActiviteIndirecte(activite)}
                        >
                          {libelleActiviteIndirecte(activite, t)}
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            )
          ) : null}

          <DialogueChoixCiblePointage
            ouvert={Boolean(orSelectionneId)}
            onFermer={() => setOrSelectionneId(undefined)}
            technicienId={technicienId as string}
            requeteOr={requeteOrSelectionne}
            onChoisirLigne={handleChoisirLigne}
            onChoisirOrEntier={handleChoisirOrEntier}
            enDemarrage={demarrer.isPending}
          />
        </div>
      )}
    </div>
  );
}
