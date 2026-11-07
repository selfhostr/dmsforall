import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';

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
import { useOrdreReparation } from '@/hooks/atelier/useOrdreReparation';
import {
  calculerCumulSecondesCible,
  cibleCumulDepuisPointage,
  useCumulsPointagesJour,
} from '@/hooks/pointage/cumul-cible-jour';
import { estHorsSite, trierParEcheance } from '@/hooks/pointage/ordres-du-jour';
import { useArreterPointage } from '@/hooks/pointage/useArreterPointage';
import { useDemarrerPointage } from '@/hooks/pointage/useDemarrerPointage';
import { useDerniereCiblePointage } from '@/hooks/pointage/useDerniereCiblePointage';
import { useIdentificationPin } from '@/hooks/pointage/useIdentificationPin';
import { useMesOrdresAssignes } from '@/hooks/pointage/useMesOrdresAssignes';
import { usePointageOuvertTechnicien } from '@/hooks/pointage/usePointageOuvertTechnicien';
import { useSession } from '@/hooks/useSession';
import { genererUuid } from '@/lib/uuid';

import { BandeauReprisePointage } from './BandeauReprisePointage';
import { CartePointageEnCours } from './CartePointageEnCours';
import { DialogueChoixCiblePointage } from './DialogueChoixCiblePointage';
import { CarteOrDuJour } from './CarteOrDuJour';
import { libelleActiviteIndirecte, libelleCiblePointage, messageErreurPointage } from './libelles';
import { PaveNumerique } from './PaveNumerique';
import { SelecteurOrOuvert } from './SelecteurOrOuvert';

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
 * partagée » du pointage (RM-113 → RM-115, RM-129, choix produit du 03.08.2026, NE PAS ROUVRIR).
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
 * DÉCISION #148 (« la Direction ne peut pas pointer ») — même correctif, même cause, mêmes
 * conséquences qu'`EcranPointageTechnicien.tsx` (voir sa docstring de tête pour l'investigation
 * complète, non répétée ici) : « Mes OR du jour » n'a JAMAIS été une condition côté serveur, un
 * simple filtre de confort côté front. Un technicien identifié par PIN dont le rôle réel est
 * `direction`/`chef_atelier` — normalement sans aucune ligne assignée — se heurtait au même mur
 * décoratif sur la borne. Même correctif ici : message vide explicite + `SelecteurOrOuvert`
 * (« Toutes les OR ouvertes »), aucun rôle côté front à vérifier sur CET écran puisque la borne
 * n'expose de toute façon aucune notion de rôle du technicien identifié (seul `technicienId` est
 * connu, voir `ReponseIdentificationPin`) — le serveur reste l'arbitre final, comme toujours.
 *
 * MODE DU SITE (borne partagée vs session personnelle) : non exposé côté API au moment d'écrire
 * cet écran — recherché dans `apps/api/src/parametrage/` et le schéma `site`, AUCUN paramètre de
 * ce type n'y existe (seul `poste_atelier`, un RÔLE de compte, existe déjà). Cet écran est donc
 * rendu ATTEIGNABLE PAR SA ROUTE (`/pointage/borne`) sans dépendre d'un paramétrage de site — un
 * garage qui choisit le mode borne y navigue directement (lien de menu ou favori sur la tablette
 * murale). Signalé au coordinateur : si le paramètre de site est ajouté plus tard côté API, cet
 * écran devra probablement devenir la destination conditionnelle d'une redirection automatique.
 *
 * SITE DE LA BORNE — DÉCISION DE CONCEPTION du 14.08.2026, NE PAS ROUVRIR : le site vient désormais
 * EXCLUSIVEMENT de `ReponseIdentificationPin.siteId` (résolu par le serveur depuis
 * `pin_pointage.site_id`, jamais d'un paramètre de requête) — plus de `session.sites[0]?.id`, plus
 * aucun sélecteur possible sur cet écran. Conséquence directe : le site n'est connu qu'APRÈS une
 * identification réussie, jamais avant — le pavé de saisie du PIN, lui, ne dépend JAMAIS du site
 * (voir le rendu plus bas, aucune garde de site avant `identifie`). Un technicien qui tape son code
 * n'a donc plus jamais à choisir son site : la borne le déduit du PIN, une fois pour toutes.
 *
 * MÉMOIRE DE LA CIBLE DE REPRISE (P-34, 14.08.2026) : comme `EcranPointageTechnicien`, la cible du
 * bandeau/bouton « Reprendre » vient de `GET /pointages/dernier-du-jour`
 * (`useDerniereCiblePointage`, `pourAutrui: true` ICI — la borne identifie un AUTRE technicien que
 * le compte de service de sa propre session, voir l'en-tête du contrat, § « technicienId en QUERY,
 * OPTIONNEL »). C'est précisément le scénario qui rendait l'ancienne mémoire LOCALE inutilisable en
 * mode borne (chaque identification PIN rechargeait l'écran, voir
 * `docs/proposition-refonte-pointage.md` §1.4) : la reprise fonctionne maintenant ICI AUSSI, plus
 * seulement sur l'écran personnel — bénéfice direct de la bascule serveur, pas une extension
 * d'ergonomie décidée par ce fichier.
 *
 * PAS DE `GabaritEcran` ICI (chantier « titres doublés », 17.08.2026, décision MESURÉE — voir
 * `AppShell.tsx` : `poste_atelier`, le compte réel de cet écran, n'a NI barre latérale NI onglets
 * — seul `EnTete` reste ; `chef_atelier`/`admin`, qui y accèdent en mise en service, VOIENT la
 * rangée d'onglets/vues, mais aucun de ces titres — « Qui êtes-vous ? », « Bonjour {prénom} », « Que
 * pointez-vous ? » — ne recoupe jamais « Pointage »/« Borne d'atelier » : la détection automatique
 * du gabarit ne masquerait donc RIEN ici, le h1 resterait visible dans tous les cas. La composition
 * plein écran centrée (pavé tactile mural, gants, lu à distance) est en outre incompatible avec la
 * rangée titre+actions imposée par `GabaritEcran` — signalé au coordinateur, pas retenu comme
 * périmètre de ce chantier. Les trois `h1` ci-dessous restent donc posés à la main, mais
 * COHÉRENTS entre eux (toujours visibles, jamais `sr-only` au chargement puis visibles ensuite).
 */
export function EcranBornePointage() {
  const { t } = useTranslation(['pointage', 'commun']);
  const { isPending: sessionEnAttente, isError: sessionEnErreur, data: session } = useSession();

  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<EtatErreurIdentification | undefined>(undefined);
  const [compteARebours, setCompteARebours] = useState(0);
  const [identifie, setIdentifie] = useState<ReponseIdentificationPin | undefined>(undefined);
  const [orSelectionneId, setOrSelectionneId] = useState<string | undefined>(undefined);
  const [erreurAction, setErreurAction] = useState<string | undefined>(undefined);
  const [avertissementAction, setAvertissementAction] = useState<string | undefined>(undefined);
  const [enChainage, setEnChainage] = useState(false);
  // Mêmes trois états, même doctrine que `EcranPointageTechnicien.tsx` (correctifs #148/#117) —
  // voir ses commentaires de déclaration pour le détail, non répété ici.
  const [toutesOrOuvertesManuel, setToutesOrOuvertesManuel] = useState<boolean | undefined>(
    undefined,
  );
  const [changementCibleOuvert, setChangementCibleOuvert] = useState(false);

  const identification = useIdentificationPin();
  const technicienId = identifie?.technicienId;
  // Site de la borne = site RÉSOLU PAR LE PIN (décision 14.08.2026, voir la docstring de tête) —
  // `undefined` tant que personne n'est identifié, TOUJOURS défini une fois `identifie` posé
  // (`ReponseIdentificationPin.siteId` est un champ requis du contrat, jamais `null`/absent).
  const siteId = identifie?.siteId;

  const pointageOuvert = usePointageOuvertTechnicien(technicienId);
  const mesOrdres = useMesOrdresAssignes(technicienId, { comptage: 'document' });
  const requeteOrSelectionne = useOrdreReparation(orSelectionneId);
  // Véhicule de l'OR pointé (affiché en grand sur la carte « en cours ») : document OR de la cible
  // du pointage OUVERT, jamais un état local. `undefined` -> requête inerte (activité indirecte).
  const requeteOrPointageActuel = useOrdreReparation(
    pointageOuvert.data?.ordreReparationId ?? undefined,
  );
  // Nom d'un site connu de la session. Une borne n'en connaît qu'UN (le sien) : pour l'OR d'un
  // autre site, `undefined` -> l'étiquette générique « Autre site », jamais un nom inventé.
  const nomSite = (id: string): string | undefined =>
    session?.sites.find((candidat) => candidat.id === id)?.nom;
  // Point 6 (« deux nombres ») — même mécanique qu'`EcranPointageTechnicien` : voir l'en-tête de
  // `cumul-cible-jour.ts`. Couvre le cumul du SEGMENT COURANT (`cumulSegmentCourant` plus bas),
  // jamais celui de la cible de REPRISE — `useDerniereCiblePointage` rend directement le sien.
  const cumulsJour = useCumulsPointagesJour(technicienId);
  // Mémoire de reprise SERVEUR (P-34) — `pourAutrui: true` : cet écran identifie un AUTRE
  // technicien que le compte de service de sa propre session (voir la docstring de tête).
  const derniereCible = useDerniereCiblePointage(technicienId, { pourAutrui: true });

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
    setAvertissementAction(undefined);
    // Borne PARTAGÉE : un « Changer » ou une recherche élargie laissés ouverts par le technicien
    // précédent ne doivent JAMAIS survivre au changement d'identité. La mémoire de reprise, elle,
    // n'a RIEN à réinitialiser ici : elle vient du serveur (`useDerniereCiblePointage`), scopée par
    // `technicienId` — une nouvelle identification change la clé de cache, jamais son contenu.
    setChangementCibleOuvert(false);
    setToutesOrOuvertesManuel(undefined);
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
    setAvertissementAction(undefined);
    try {
      const entree = construireEntreeDemarrageBorne(
        { technicienId, debutLe: new Date().toISOString() },
        cible,
      );
      const reponse = await demarrer.mutateAsync({
        entree,
        idempotencyKey: genererCleIdempotence(),
      });
      // Correctif #117 : même mécanique qu'`EcranPointageTechnicien.demarrerEtMemoriser` — un
      // SEUL appel `demarrer` suffit à changer de cible même si un pointage est déjà `en_cours`,
      // le serveur referme l'ancien en cascade (RM-89/90) et le signale via cet avertissement.
      if (reponse.avertissements.some((a) => a.code === 'POINTAGE_CLOTURE_AUTOMATIQUE')) {
        setAvertissementAction(t('erreurs:codes.POINTAGE_CLOTURE_AUTOMATIQUE'));
      }
      setChangementCibleOuvert(false);
    } catch (erreurCapturee) {
      // Issue #152 : NE PLUS RE-LANCER ici. `handleChoisirLigne`/`handleChoisirOrEntier`/
      // `handleDemarrerActiviteIndirecte` appellent cette fonction via `void demarrerEtSuivre(...)`
      // (fire-and-forget délibéré — fermer immédiatement la vue « Que pointez-vous ? » sans
      // attendre la réponse serveur, RM-115) : un appelant `void` n'observe JAMAIS la promesse
      // rejetée qu'un `throw` ici produirait, ce qui la transforme en rejet de promesse NON
      // RATTRAPÉ — constaté en test navigateur réel (deux techniciens qui cliquent au même instant
      // sur une borne PARTAGÉE, cas normal, pas un cas rare) : l'écran de sélection « cassait ».
      // `setErreurAction` ci-dessus AFFICHE déjà l'erreur à l'utilisateur — c'est la seule chose que
      // ce correctif devait garantir. Les DEUX appelants qui `await` cette fonction
      // (`handlePause`/`handleReprendre`) n'ont besoin d'aucune propagation supplémentaire : ils
      // portent leur propre `finally` (nettoyage `enChainage`), inconditionnel qu'il y ait eu
      // rethrow ou non.
      setErreurAction(messageErreurPointage(erreurCapturee, t));
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
      setAvertissementAction(undefined);
      setChangementCibleOuvert(false);
    } catch (erreurCapturee) {
      setErreurAction(messageErreurPointage(erreurCapturee, t));
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
      setErreurAction(messageErreurPointage(erreurCapturee, t));
    } finally {
      setEnChainage(false);
    }
  }

  async function handleReprendre() {
    const cible = derniereCible.data;
    if (!pointageOuvert.data || !technicienId || !cible) return;
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
      // Même repli défensif qu'`EcranPointageTechnicien.handleReprendre` : `cible.ligneOrId` n'est
      // garanti non nul pour `type === 'ligne'` que PAR LE CONTRAT, pas par le compilateur.
      if (cible.type === 'ligne' && cible.ligneOrId) {
        await demarrerEtSuivre({
          nature: 'productif_ligne',
          ordreReparationId: cible.ordreReparationId,
          ligneOrId: cible.ligneOrId,
          siteId: cible.siteId,
        });
      } else {
        await demarrerEtSuivre({
          nature: 'productif_or',
          ordreReparationId: cible.ordreReparationId,
          siteId: cible.siteId,
        });
      }
    } catch (erreurCapturee) {
      setErreurAction(messageErreurPointage(erreurCapturee, t));
    } finally {
      setEnChainage(false);
    }
  }

  const enTraitement = demarrer.isPending || arreter.isPending || enChainage;

  // Point 6 (« deux nombres ») : cumul du jour sur la cible du pointage OUVERT, même calcul
  // qu'`EcranPointageTechnicien` — voir l'en-tête de `cumul-cible-jour.ts`. Ne couvre pas le cumul
  // de la cible de REPRISE, rendu directement par `useDerniereCiblePointage` (`cumulSecondesDuJour`).
  const cibleSegmentCourant = pointageOuvert.data
    ? cibleCumulDepuisPointage(pointageOuvert.data)
    : undefined;
  const cumulSegmentCourant =
    cibleSegmentCourant && cumulsJour.pointages
      ? calculerCumulSecondesCible(cumulsJour.pointages, cibleSegmentCourant)
      : undefined;

  // Bandeau/bouton de reprise (P-34) — même condition qu'`EcranPointageTechnicien` : activité
  // INDIRECTE en cours ET cible productive connue du serveur. `cible` reste `undefined` tant que
  // la requête n'a pas abouti ou si elle échoue -> pas de bandeau prématuré, jamais d'erreur
  // affichée pour ce complément non bloquant (voir la docstring d'`useDerniereCiblePointage`).
  const cibleReprise = derniereCible.data;
  const reprisePossible = pointageOuvert.data?.nature === 'indirect' && Boolean(cibleReprise);

  /* ---------------------------------------------------------------------------------------- */
  /* Rendu                                                                                      */
  /* ---------------------------------------------------------------------------------------- */

  if (sessionEnAttente) {
    return (
      <div className="flex flex-col gap-6">
        {/* Visible, PAS `sr-only` (chantier « titres doublés ») : cohérent avec les autres états
         *  de cet écran (pavé neutre, panneau identifié) — l'en-tête ne doit jamais sauter entre
         *  deux états, voir la docstring de tête, § « pas de GabaritEcran ici ». */}
        <h1 className="texte-titre-page">{t('pointage:identification.titre')}</h1>
        <EtatChargement lignes={4} />
      </div>
    );
  }

  // Issue #159 — CORRECTIF, pas contournement : `RouteProtegee` (`routes/RouteProtegee.tsx`)
  // garde déjà cette route et distingue explicitement DEUX états que cet écran, lui, confondait
  // jusqu'ici sous un seul rendu (« session === null » ET « isError ») — exactement le genre de
  // confusion que CONTRIBUTING.md interdit (« absence de donnée ≠ valeur : "inconnu", "aucun", "interdit"
  // ne partagent jamais le même rendu »). `session === null` est une DONNÉE CONNUE — non connecté,
  // confirmé par le serveur (401 propre) — jamais une panne : la seule action juste est de renvoyer
  // vers `/login`, comme le fait `RouteProtegee` pour CHAQUE AUTRE route protégée. En pratique,
  // `RouteProtegee` démonte déjà `AppShell` (donc cet écran) avant que ce rendu ne soit jamais
  // atteint sur une navigation normale — mais cet écran a SA PROPRE requête `useSession()`
  // (nécessaire pour son propre spinner anti-flash), donc un cas RÉEL reste ouvert : la session
  // expire PENDANT qu'un technicien pointe (déconnexion serveur, TTL dépassé, ou l'action « Se
  // déconnecter » elle-même) — la requête de CET écran peut se résoudre à `null` un instant avant
  // que le démontage déclenché par `RouteProtegee` ne soit effectif. Avant ce correctif, cette
  // fenêtre affichait une carte d'erreur statique, SANS bouton, SANS redirection — la borne restait
  // bloquée sur un état mort tant que personne n'intervenait physiquement dessus (poste PARTAGÉ :
  // aucun technicien suivant ne peut alors pointer). Le second cas (`isError`, service
  // injoignable — PAS une session absente) garde son message dédié, inchangé.
  if (session === null) {
    return <Navigate to="/login" replace />;
  }

  if (sessionEnErreur || !session) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="texte-titre-page">{t('pointage:identification.titre')}</h1>
        <EtatErreur
          titre={t('pointage:identification.erreur.titre')}
          description={t('pointage:identification.erreur.session')}
        />
      </div>
    );
  }

  // PLUS DE GARDE `!siteId` ICI (décision 14.08.2026, voir la docstring de tête) : le site vient
  // désormais de l'identification PIN, pas de la session — il n'est simplement pas encore connu
  // avant `identifie`, ce qui n'empêche jamais le pavé de saisie de s'afficher (branche `!identifie`
  // du rendu plus bas). Le seul cas où `identifie` serait posé sans `siteId` violerait le contrat
  // `ReponseIdentificationPin` (champ requis) — pas un état à défendre côté écran.

  // Correctif #148 : même repli automatique qu'`EcranPointageTechnicien` — voir sa déclaration de
  // `toutesOrOuvertesManuel` pour le détail du tri-état.
  const toutesOrOuvertesVisible = toutesOrOuvertesManuel ?? (mesOrdres.data ?? []).length === 0;

  // Même bloc, partagé entre le flux normal (aucun pointage) et le correctif #117 (« Changer »
  // pendant un pointage en cours) — voir `EcranPointageTechnicien` pour le même patron (mécanique
  // identique, JSX propre à chaque écran, pas de duplication de la logique de démarrage).
  const blocChoixCible = (
    <>
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
            <EtatVide
              titre={t('pointage:vide.aucunOr')}
              description={t('pointage:vide.aucunOrDescription')}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {trierParEcheance(mesOrdres.data ?? []).map((or) => (
                <CarteOrDuJour
                  key={or.id}
                  or={or}
                  grand
                  desactive={enTraitement}
                  horsSite={estHorsSite(or, siteId)}
                  siteNom={nomSite(or.siteId)}
                  onChoisir={() => {
                    reinitialiserInactivite();
                    setOrSelectionneId(or.id);
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="texte-titre-section">{t('pointage:toutesLesOr.titre')}</CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="min-h-[72px]"
            onClick={() => {
              reinitialiserInactivite();
              setToutesOrOuvertesManuel(!toutesOrOuvertesVisible);
            }}
          >
            {toutesOrOuvertesVisible
              ? t('pointage:toutesLesOr.masquer')
              : t('pointage:toutesLesOr.afficher')}
          </Button>
        </CardHeader>
        {toutesOrOuvertesVisible ? (
          <CardContent className="flex flex-col gap-3">
            <p className="texte-corps text-muted-foreground">
              {t('pointage:toutesLesOr.siteBorne')}
            </p>
            <SelecteurOrOuvert
              siteId={siteId}
              onChoisirOr={(orId) => {
                reinitialiserInactivite();
                setOrSelectionneId(orId);
              }}
              disabled={enTraitement}
            />
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('pointage:activites.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ACTIVITES_INDIRECTES.map((activite) => (
              <Button
                key={activite}
                size="lg"
                variant="outline"
                className="min-h-[72px] texte-annexe"
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
  );

  return (
    <div
      // `.densite-tres-aeree` (index.css §Densités, « très aérée = pointage ») — SEUL écran du
      // pointage à la porter : borne murale, consultée debout avec des gants, à distance, jamais
      // assise devant un clavier. Les autres écrans du domaine (`EcranPointage` — journal/équipe,
      // `DialogueCloturePeriode`) restent sur le repli `densite-dense` : poste de travail, chef
      // d'atelier assis. Cascade par variables CSS custom properties sur toute la sous-arborescence
      // en DOM réel (`PaveNumerique`, `CartePointageEnCours`, et depuis la refonte plein écran
      // `DialogueChoixCiblePointage` — qui n'utilise plus de portail Radix, voir sa docstring) —
      // aucune classe dupliquée côté enfants.
      className="densite-tres-aeree flex min-h-[70vh] flex-col items-center justify-center gap-8"
      onPointerDown={identifie ? reinitialiserInactivite : undefined}
    >
      {!identifie ? (
        <div className="flex flex-col items-center gap-6 text-center">
          <div>
            <h1 className="texte-titre-page">{t('pointage:identification.titre')}</h1>
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
      ) : orSelectionneId ? (
        // Vue plein écran « Que pointez-vous ? » (point 3) : remplace ENTIÈREMENT le panneau du
        // technicien identifié, même patron que `EcranPointageTechnicien` — voir la docstring de
        // `DialogueChoixCiblePointage`. Rendue DANS cette sous-arborescence (ancêtre
        // `.densite-tres-aeree` juste au-dessus), plus de portail Radix à contourner : le prop
        // `densite` explicite qu'exigeait l'ancienne modale n'a donc plus lieu d'être.
        // `DialogueChoixCiblePointage` ne pose plus son propre `h1` (chantier « titres doublés ») —
        // porté ici, comme chez `EcranPointageTechnicien`.
        <div className="flex w-full max-w-2xl flex-col gap-6">
          <h1 className="texte-titre-page">{t('pointage:technicien.choisirCible.titre')}</h1>
          <DialogueChoixCiblePointage
            onFermer={() => setOrSelectionneId(undefined)}
            technicienId={technicienId as string}
            requeteOr={requeteOrSelectionne}
            onChoisirLigne={handleChoisirLigne}
            onChoisirOrEntier={handleChoisirOrEntier}
            enDemarrage={demarrer.isPending}
          />
        </div>
      ) : (
        <div className="flex w-full max-w-2xl flex-col gap-6">
          <div className="flex items-center justify-between gap-4">
            <h1 className="texte-titre-page">
              {t('pointage:identification.bonjour', { prenom: identifie.prenom })}
            </h1>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="min-h-[72px] texte-annexe"
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
            <>
              {reprisePossible && pointageOuvert.data && cibleReprise ? (
                <BandeauReprisePointage
                  cibleLibelle={cibleReprise.libelle}
                  interrompuDepuisLe={pointageOuvert.data.debutLe}
                  cumulAujourdhuiSecondes={cibleReprise.cumulSecondesDuJour}
                  onReprendre={() => void handleReprendre()}
                  enTraitement={enTraitement}
                />
              ) : null}

              {pointageOuvert.data ? (
                <CartePointageEnCours
                  pointage={pointageOuvert.data}
                  libelleCible={libelleCiblePointage(pointageOuvert.data, t)}
                  cumulAujourdhuiSecondes={cumulSegmentCourant}
                  grand
                  vehicule={requeteOrPointageActuel.data?.vehicule}
                  onArreter={() => void handleArreter()}
                  onPause={
                    pointageOuvert.data.nature === 'productif_ligne' ||
                    pointageOuvert.data.nature === 'productif_or'
                      ? () => void handlePause()
                      : undefined
                  }
                  // « Reprendre » sur la borne (P-34, 14.08.2026) : désormais possible — la mémoire
                  // de reprise vient du serveur (`useDerniereCiblePointage`, scopée par
                  // `technicienId`), elle survit donc à un changement d'identité PIN. Voir la
                  // docstring de tête, § « Mémoire de la cible de reprise ».
                  onReprendre={reprisePossible ? () => void handleReprendre() : undefined}
                  onChanger={() => {
                    reinitialiserInactivite();
                    setChangementCibleOuvert((valeur) => !valeur);
                  }}
                  enTraitement={enTraitement}
                  messageErreur={erreurAction}
                  avertissement={avertissementAction}
                />
              ) : null}

              {!pointageOuvert.data ? (
                <>
                  {erreurAction ? (
                    <EtatErreur
                      titre={t('pointage:technicien.erreur.titreAction')}
                      description={erreurAction}
                    />
                  ) : null}
                  {blocChoixCible}
                </>
              ) : null}

              {pointageOuvert.data && changementCibleOuvert ? (
                <div className="flex flex-col gap-6">
                  <h2 className="texte-titre-section">
                    {t('pointage:technicien.choisirCible.titre')}
                  </h2>
                  {blocChoixCible}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
