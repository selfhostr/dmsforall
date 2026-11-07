import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import {
  ACTIVITES_INDIRECTES,
  type ActiviteIndirecte,
  type EntreeDemarragePointage,
  type ReponseLigneOr,
  type ReponseOrdreReparation,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useMarquerLignesRealisees } from '@/hooks/atelier/useActionsLigneOr';
import { useOrdreReparation } from '@/hooks/atelier/useOrdreReparation';
import {
  calculerCumulSecondesCible,
  cibleCumulDepuisPointage,
  useCumulsPointagesJour,
} from '@/hooks/pointage/cumul-cible-jour';
import { compterLignesAssigneesPointables } from '@/hooks/pointage/lignes-assignees';
import { trierParEcheance } from '@/hooks/pointage/ordres-du-jour';
import { useArreterPointage } from '@/hooks/pointage/useArreterPointage';
import { useDemarrerPointage } from '@/hooks/pointage/useDemarrerPointage';
import { useDerniereCiblePointage } from '@/hooks/pointage/useDerniereCiblePointage';
import { useMesOrdresAssignes } from '@/hooks/pointage/useMesOrdresAssignes';
import { usePointageOuvertTechnicien } from '@/hooks/pointage/usePointageOuvertTechnicien';
import { useSiteCourant } from '@/hooks/site/ContexteSiteCourant';
import { useSession } from '@/hooks/useSession';
import { genererUuid } from '@/lib/uuid';

import { BandeauLigneARealiser } from './BandeauLigneARealiser';
import { BandeauReprisePointage } from './BandeauReprisePointage';
import { CarteOrDuJour } from './CarteOrDuJour';
import { CartePointageEnCours } from './CartePointageEnCours';
import { DialogueChoixCiblePointage } from './DialogueChoixCiblePointage';
import { peutDemarrerPointage, peutMarquerLigneRealisee } from './droits';
import {
  libelleActiviteIndirecte,
  libelleCiblePointage,
  libelleCiblePointageTechnicien,
  messageErreurPointage,
} from './libelles';
import { SelecteurOrOuvert } from './SelecteurOrOuvert';
import { SelecteurSitePointage } from './SelecteurSitePointage';

/**
 * Libellé RICHE (numéro d'OR + désignation de ligne) du geste qui vient TOUT JUSTE de démarrer ce
 * pointage DEPUIS CET ÉCRAN — polish d'affichage UNIQUEMENT, à ne pas confondre avec la mémoire de
 * reprise (voir `useDerniereCiblePointage` plus bas, désormais servie par le serveur, P-34).
 *
 * POURQUOI CE PETIT ÉTAT SURVIT à la bascule serveur : `useDemarrerPointage` pose un pointage
 * OPTIMISTE dont `ordreReparationNumero`/`ligneOrDesignation` valent `null` (résolus par le serveur
 * seulement — voir son en-tête), le temps que `requeteOrPointageActuel` (ou la vraie réponse
 * `POST /pointages`) arrive. Sans repli, `libelleCiblePointageTechnicien` retomberait sur un texte
 * générique (« OR (sans ligne précise) ») pendant cette fenêtre, un flash déjà corrigé (défaut 2)
 * qu'il ne faut pas réintroduire. Ce repli est purement un choix d'AFFICHAGE synchrone connu du
 * clic (`or.numero`/`ligne.designation` capturés par l'appelant) — il ne joue AUCUN rôle dans la
 * reprise après une activité indirecte, qui vient maintenant exclusivement de
 * `useDerniereCiblePointage`.
 */
interface CibleJusteChoisie {
  readonly ordreReparationId: string;
  /** `null` pour une cible « OR entier », même convention que `ReponsePointage.ligneOrId`. */
  readonly ligneOrId: string | null;
  readonly libelle: string;
}

function construireEntreeDemarrage(
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
  if (cible.nature === 'productif_ligne') {
    return {
      id,
      siteId: cible.siteId,
      technicienId: base.technicienId,
      debutLe: base.debutLe,
      source: 'ecran_atelier',
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
      source: 'ecran_atelier',
      nature: 'productif_or',
      ordreReparationId: cible.ordreReparationId,
    };
  }
  return {
    id,
    siteId: cible.siteId,
    technicienId: base.technicienId,
    debutLe: base.debutLe,
    source: 'ecran_atelier',
    nature: 'indirect',
    activiteIndirecte: cible.activiteIndirecte,
  };
}

/**
 * Écran de pointage du technicien — le plus important du module (voir le brief de livraison) :
 * voir ses OR du jour, démarrer/mettre en pause/reprendre/changer de cible/arrêter un pointage,
 * chrono qui défile. Pensé tablette d'atelier : peu de texte, cibles tactiles à 72 px minimum
 * (RM-72tactile, voir la docstring de `CartePointageEnCours`), un seul état affiché à la fois
 * (soit « en train de pointer », soit « à choisir quoi pointer », jamais les deux mélangés — sauf
 * pendant un « Changer », voir `changementCibleOuvert` plus bas, qui superpose délibérément les
 * deux le temps du choix ; « choisir quoi pointer » lui-même est désormais une vue PLEIN ÉCRAN,
 * voir l'early return sur `orSelectionneId` plus bas, plus une modale flottante).
 *
 * REFONTE ERGONOMIQUE (14.08.2026, `docs/proposition-refonte-pointage.md`) : bandeau de reprise
 * stationnaire en tête d'écran (`BandeauReprisePointage`) dès qu'une activité INDIRECTE
 * QUELCONQUE est en cours (plus seulement `pause` — voir `reprisePossible` plus bas, partagé avec
 * le bouton « Reprendre » de `CartePointageEnCours` : les deux ne divergent JAMAIS) ; cumul « deux
 * nombres » du jour sur la cible affichée à côté du chrono (`hooks/pointage/cumul-cible-jour.ts`).
 *
 * MÉMOIRE DE LA CIBLE DE REPRISE — SOURCE SERVEUR (P-34, 14.08.2026) : la cible proposée par le
 * bandeau/bouton « Reprendre » vient de `GET /pointages/dernier-du-jour`
 * (`useDerniereCiblePointage`), plus d'un `useState` local. Cette bascule est le point structurant
 * du module — voir `docs/proposition-refonte-pointage.md` §1.4/§7 : un état volatile ne pouvait
 * JAMAIS fonctionner en mode borne (chaque identification PIN y recharge l'écran), et ne survivait
 * pas non plus à un F5 en mode personnel. Trois états explicites de cette requête : en chargement
 * (`derniereCible.isPending`, `cibleReprise` alors `undefined` -> `reprisePossible` reste `false`,
 * le bandeau n'apparaît donc QU'UNE FOIS la réponse connue, jamais avant — aucun sursaut de mise en
 * page) ; vide (`cibleReprise === null`, cas NORMAL, pas une erreur -> pas de bandeau) ; erreur
 * (`derniereCible.isError`, `cibleReprise` reste `undefined` -> repli identique au chargement,
 * SILENCIEUX : ne pas pouvoir reprendre n'empêche jamais de démarrer un nouveau pointage, aucun
 * `EtatErreur` dédié pour ce complément non bloquant, même doctrine que `cumulsJour` ci-dessous).
 * Invalidée après CHAQUE démarrage et arrêt (`useDemarrerPointage`/`useArreterPointage`,
 * `onSettled`) — le bandeau reflète donc la réalité sans recharger la page.
 *
 * `technicienId` = l'utilisateur SESSION courant, jamais un paramètre de route ni de requête :
 * chaque technicien pointe pour lui-même (voir l'en-tête de `pointage.api.ts` — le PIN décrit par
 * le contrat n'est PAS implémenté côté serveur à ce jour, ce module s'appuie donc entièrement sur
 * la session applicative normale, même mécanisme que tout autre écran protégé).
 *
 * DÉCISION #148 (« la Direction ne peut pas pointer ») — investigation tranchée, à ne pas rouvrir :
 * `direction`/`chef_atelier`/`admin` ONT déjà `atelier.pointage.demarrer` (`matrice-droits.ts`,
 * `DROITS_POINTAGE_PAR_ROLE`), et `ServicePointage.exigerDroitCiblerAutrui` laisse toujours passer
 * un pointage sur SOI-MÊME quel que soit le rôle — la Direction PEUT pointer pour elle-même dès
 * aujourd'hui, ce n'est PAS un problème de droit. Plus largement, `ServicePointage.demarrer` ne
 * vérifie JAMAIS qu'`entree.technicienId` est « assigné » à l'OR/la ligne ciblée : seuls comptent
 * le site et le statut pointable de la cible (`estOrPointable`/`estLignePointable`,
 * `regles-pointage.ts`) — pointer sur N'IMPORTE QUEL OR ouvert est légal côté serveur pour
 * quiconque a `atelier.pointage.demarrer`, assigné ou non. Le VRAI défaut était que « Mes OR du
 * jour » (`useMesOrdresAssignes`) est un filtre de CONFORT purement côté FRONT (une commodité pour
 * le cas courant, jamais une règle métier) — un rôle d'encadrement, qui n'a normalement AUCUNE
 * ligne d'OR assignée, se heurtait donc à un mur décoratif : liste vide, aucune explication, aucun
 * autre chemin proposé. Corrigé par : un message vide EXPLICITE (`pointage:vide.aucunOr` +
 * `aucunOrDescription`, au lieu d'un texte muet) et `SelecteurOrOuvert` (« Toutes les OR ouvertes »,
 * `./SelecteurOrOuvert.tsx`), qui réutilise EXACTEMENT le même chemin de démarrage que « Mes OR »
 * (`orSelectionneId` -> `DialogueChoixCiblePointage` -> `handleChoisirLigne`/`handleChoisirOrEntier`)
 * — aucune mécanique de démarrage dupliquée, seule la SOURCE de la liste change.
 */
export function EcranPointageTechnicien() {
  const { t } = useTranslation(['pointage', 'commun']);
  const { data: session } = useSession();
  const technicien = session?.utilisateur;
  const actions = session?.actions;

  const [searchParams, setSearchParams] = useSearchParams();
  const siteParam = searchParams.get('site') ?? undefined;
  const sitesActifs = (session?.sites ?? []).filter((site) => site.actif);
  const { preferenceSiteId } = useSiteCourant();
  // Site des activités indirectes (pause, nettoyage…), dans l'ordre : `?site=` explicite, site
  // unique du tenant, dernier site choisi sur ce poste (préférence), puis — plus bas, une fois
  // « Mes OR » chargées — le site commun de tous mes OR. Le sélecteur de site n'apparaît que si
  // AUCUN de ces repères ne tranche.
  const preferenceActive = sitesActifs.find((site) => site.id === preferenceSiteId)?.id;
  const siteConnu =
    siteParam ?? (sitesActifs.length === 1 ? sitesActifs[0]?.id : undefined) ?? preferenceActive;

  const [orSelectionneId, setOrSelectionneId] = useState<string | undefined>(undefined);
  const [cibleJusteChoisie, setCibleJusteChoisie] = useState<CibleJusteChoisie | undefined>(
    undefined,
  );
  const [erreurAction, setErreurAction] = useState<string | undefined>(undefined);
  const [avertissementAction, setAvertissementAction] = useState<string | undefined>(undefined);
  const [enChainage, setEnChainage] = useState(false);
  // Ligne dont le pointage vient d'être ARRÊTÉ (bouton « Arrêter » seulement, pas pause/changer) :
  // propose de la marquer réalisée en un geste. `fait` -> confirmation seule.
  const [ligneAFinir, setLigneAFinir] = useState<
    | {
        readonly ordreReparationId: string;
        readonly ligneOrId: string;
        readonly libelle: string;
        readonly fait: boolean;
      }
    | undefined
  >(undefined);
  const [erreurRealisation, setErreurRealisation] = useState<string | undefined>(undefined);
  const marquerRealisee = useMarquerLignesRealisees(ligneAFinir?.ordreReparationId ?? '');
  // Correctif #148 : `undefined` = pas encore de choix EXPLICITE de l'utilisateur, la visibilité
  // suit alors `mesOrdres` (repliée par défaut, révélée automatiquement dès que « Mes OR du jour »
  // se révèle vide — voir `toutesOrOuvertesVisible` plus bas) ; `true`/`false` = l'utilisateur a
  // lui-même actionné le bouton « Afficher »/« Masquer », ce choix explicite prime alors sur le
  // repli automatique (ex. il rouvre la recherche même après avoir reçu ses propres OR).
  const [toutesOrOuvertesManuel, setToutesOrOuvertesManuel] = useState<boolean | undefined>(
    undefined,
  );
  // Correctif #117 : révèle le sélecteur de cible (Mes OR / Toutes les OR / activités indirectes)
  // MÊME QUAND un pointage est déjà en cours — voir `onChanger` de `CartePointageEnCours`.
  const [changementCibleOuvert, setChangementCibleOuvert] = useState(false);

  const pointageOuvert = usePointageOuvertTechnicien(technicien?.id);
  const mesOrdres = useMesOrdresAssignes(technicien?.id);
  const sitesDeMesOrdres = new Set((mesOrdres.data ?? []).map((or) => or.siteId));
  // Site retenu pour les activités indirectes. Quatrième repère : si tous mes OR du jour sont au
  // MÊME site, c'est là que je travaille — inutile de redemander un site.
  const siteId = siteConnu ?? (sitesDeMesOrdres.size === 1 ? [...sitesDeMesOrdres][0] : undefined);
  const requeteOrSelectionne = useOrdreReparation(orSelectionneId);
  // Défaut 2 (repli après F5) : le document OR de la cible du pointage OUVERT, dérivé du
  // `ordreReparationId` renvoyé par l'API elle-même (`pointageOuvert.data`), jamais d'un état
  // client — voir `libelleCiblePointageTechnicien` (`./libelles.ts`) pour le détail. `undefined`
  // désactive la requête (activité indirecte, ou pointage pas encore chargé).
  const requeteOrPointageActuel = useOrdreReparation(
    pointageOuvert.data?.ordreReparationId ?? undefined,
  );
  // Point 6 (« deux nombres ») : cumul du jour sur la cible du SEGMENT COURANT (celui affiché par
  // `CartePointageEnCours`, qui peut être `indirect`) — voir l'en-tête de `cumul-cible-jour.ts`.
  // NE COUVRE PLUS le cumul de la cible de REPRISE (bandeau) : `GET /pointages/dernier-du-jour`
  // rend désormais directement `cumulSecondesDuJour` sur sa cible, voir `derniereCible` ci-dessous
  // — deux calculs distincts, jamais fusionnés en un seul par accident (source différente de
  // chacun : liste de pointages ici, cible unique côté serveur là-bas).
  const cumulsJour = useCumulsPointagesJour(technicien?.id);
  // Mémoire de reprise SERVEUR (P-34) — voir la docstring de tête pour les trois états explicites.
  const derniereCible = useDerniereCiblePointage(technicien?.id);

  const demarrer = useDemarrerPointage();
  const arreter = useArreterPointage();

  if (!technicien) {
    return (
      <GabaritEcran titre={t('pointage:technicien.titreEcran')}>
        <EtatChargement lignes={4} />
      </GabaritEcran>
    );
  }

  // Capturé en `const` APRÈS la garde ci-dessus : TypeScript ne propage pas le rétrécissement de
  // `technicien` (non-`undefined`) dans les fonctions imbriquées définies plus bas (`function foo()
  // {…}`), même si `technicien` lui-même n'est jamais réassigné — une simple limitation du contrôle
  // de flux du compilateur sur les frontières de fonction, pas une incertitude réelle à l'exécution.
  const technicienId = technicien.id;

  async function demarrerEtMemoriser(
    cible:
      | {
          readonly nature: 'productif_ligne';
          readonly ordreReparationId: string;
          readonly ligneOrId: string;
          readonly siteId: string;
          readonly libelle: string;
        }
      | {
          readonly nature: 'productif_or';
          readonly ordreReparationId: string;
          readonly siteId: string;
          readonly libelle: string;
        }
      | {
          readonly nature: 'indirect';
          readonly activiteIndirecte: ActiviteIndirecte;
          readonly siteId: string;
        },
  ) {
    setErreurAction(undefined);
    setAvertissementAction(undefined);
    setLigneAFinir(undefined);
    try {
      // `construireEntreeDemarrage` DOIT rester à l'intérieur de ce `try` : c'est une fonction
      // synchrone qui peut lever (ex. génération d'identifiant, voir `@/lib/uuid`), et rien ne
      // distingue à l'appel une erreur de construction d'une erreur réseau/API — les deux doivent
      // remonter à l'utilisateur via `setErreurAction`, jamais disparaître en promesse rejetée
      // non observée (les appelants invoquent cette fonction via `void demarrerEtMemoriser(...)`).
      const entree = construireEntreeDemarrage(
        { technicienId, debutLe: new Date().toISOString() },
        cible,
      );
      const reponse = await demarrer.mutateAsync({
        entree,
        idempotencyKey: genererCleIdempotence(),
      });
      // Correctif #117 : démarrer PENDANT qu'un pointage est déjà ouvert (geste « Changer ») fait
      // clôturer ce dernier en cascade côté serveur (RM-89/90) — un SEUL appel `demarrer`, jamais
      // un `arreter` explicite depuis cet écran (voir `handleChoisirLigne`/`handleChoisirOrEntier`/
      // `handleDemarrerActiviteIndirecte` ci-dessous, tous appellent directement cette fonction).
      // `reponse.avertissements` porte alors `POINTAGE_CLOTURE_AUTOMATIQUE` — affiché tel quel via
      // le catalogue partagé `erreurs:codes.<CODE>` (même convention que `messageErreur`, pas de
      // clé dupliquée dans le namespace `pointage`).
      if (reponse.avertissements.some((a) => a.code === 'POINTAGE_CLOTURE_AUTOMATIQUE')) {
        setAvertissementAction(t('erreurs:codes.POINTAGE_CLOTURE_AUTOMATIQUE'));
      }
      // Referme le sélecteur de changement de cible, s'il était ouvert — no-op sinon (flux normal
      // « Mes OR »/activités quand aucun pointage n'était en cours).
      setChangementCibleOuvert(false);
      // Polish d'affichage UNIQUEMENT (voir la docstring de `CibleJusteChoisie`) — la mémoire de
      // REPRISE, elle, vient désormais du serveur (`useDerniereCiblePointage`, invalidée par
      // `useDemarrerPointage`/`useArreterPointage`), jamais posée ici.
      if (cible.nature === 'productif_ligne') {
        setCibleJusteChoisie({
          ordreReparationId: cible.ordreReparationId,
          ligneOrId: cible.ligneOrId,
          libelle: cible.libelle,
        });
      } else if (cible.nature === 'productif_or') {
        setCibleJusteChoisie({
          ordreReparationId: cible.ordreReparationId,
          ligneOrId: null,
          libelle: cible.libelle,
        });
      }
    } catch (erreur) {
      // Issue #152 : NE PLUS RE-LANCER ici — même correctif, même cause qu'`EcranBornePointage.
      // demarrerEtSuivre` (voir sa docstring pour l'investigation complète, non répétée ici) :
      // `handleChoisirLigne`/`handleChoisirOrEntier`/`handleDemarrerActiviteIndirecte` invoquent
      // cette fonction via `void demarrerEtMemoriser(...)`, qui n'observe jamais un rejet — un
      // `throw` ici devenait un rejet de promesse NON RATTRAPÉ, cassant l'écran de sélection.
      // `setErreurAction` ci-dessus reste la seule garantie utile ; `handlePause`/`handleReprendre`
      // (les deux appelants qui `await`) portent leur propre `finally` inconditionnel.
      setErreurAction(messageErreurPointage(erreur, t));
    }
  }

  function handleChoisirLigne(or: ReponseOrdreReparation, ligne: ReponseLigneOr) {
    setOrSelectionneId(undefined);
    void demarrerEtMemoriser({
      nature: 'productif_ligne',
      ordreReparationId: or.id,
      ligneOrId: ligne.id,
      siteId: or.siteId,
      libelle: t('pointage:technicien.cible.ligne', {
        numero: or.numero,
        designation: ligne.designation,
      }),
    });
  }

  function handleChoisirOrEntier(or: ReponseOrdreReparation) {
    setOrSelectionneId(undefined);
    void demarrerEtMemoriser({
      nature: 'productif_or',
      ordreReparationId: or.id,
      siteId: or.siteId,
      libelle: t('pointage:technicien.cible.or', { numero: or.numero }),
    });
  }

  function handleDemarrerActiviteIndirecte(activite: ActiviteIndirecte) {
    if (!siteId) return;
    void demarrerEtMemoriser({ nature: 'indirect', activiteIndirecte: activite, siteId });
  }

  async function handleArreter() {
    if (!pointageOuvert.data) return;
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
      setErreurRealisation(undefined);
      if (
        p.nature === 'productif_ligne' &&
        p.ordreReparationId &&
        p.ligneOrId &&
        peutMarquerLigneRealisee(actions)
      ) {
        setLigneAFinir({
          ordreReparationId: p.ordreReparationId,
          ligneOrId: p.ligneOrId,
          libelle: libelleCiblePointage(p, t),
          fait: false,
        });
      }
      // Un pointage « Changer » resté ouvert n'a plus de sens une fois qu'il n'y a plus AUCUN
      // pointage en cours — sans ce reset, un « Changer » démarré puis un « Arrêter » explicite
      // laisserait le sélecteur ouvert en mémoire, prêt à réapparaître au prochain démarrage.
      setChangementCibleOuvert(false);
    } catch (erreur) {
      setErreurAction(messageErreurPointage(erreur, t));
    }
  }

  async function handleMarquerRealisee() {
    if (!ligneAFinir) return;
    setErreurRealisation(undefined);
    try {
      await marquerRealisee.mutateAsync([ligneAFinir.ligneOrId]);
      setLigneAFinir({ ...ligneAFinir, fait: true });
    } catch (erreur) {
      setErreurRealisation(messageErreur(erreur, t));
    }
  }

  async function handlePause() {
    if (!pointageOuvert.data) return;
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
      await demarrerEtMemoriser({
        nature: 'indirect',
        activiteIndirecte: 'pause',
        siteId: p.siteId,
      });
    } catch (erreur) {
      setErreurAction(messageErreurPointage(erreur, t));
    } finally {
      setEnChainage(false);
    }
  }

  async function handleReprendre() {
    const cible = derniereCible.data;
    if (!pointageOuvert.data || !cible) return;
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
      // `cible.ligneOrId` n'est `string | null` que par la forme du contrat (`null ⇔ type ===
      // "or"", garanti côté serveur) — vérifié quand même à l'exécution plutôt que supposé : un
      // contrat de LECTURE reste un contrat, pas une preuve (même doctrine que
      // `libelleCiblePointage`, `./libelles.ts`), repli honnête sur « OR entier » si jamais démenti.
      if (cible.type === 'ligne' && cible.ligneOrId) {
        await demarrerEtMemoriser({
          nature: 'productif_ligne',
          ordreReparationId: cible.ordreReparationId,
          ligneOrId: cible.ligneOrId,
          siteId: cible.siteId,
          libelle: cible.libelle,
        });
      } else {
        await demarrerEtMemoriser({
          nature: 'productif_or',
          ordreReparationId: cible.ordreReparationId,
          siteId: cible.siteId,
          libelle: cible.libelle,
        });
      }
    } catch (erreur) {
      setErreurAction(messageErreurPointage(erreur, t));
    } finally {
      setEnChainage(false);
    }
  }

  const enTraitement = demarrer.isPending || arreter.isPending || enChainage;

  if (pointageOuvert.isPending || mesOrdres.isPending) {
    return (
      <GabaritEcran titre={t('pointage:technicien.titreEcran')}>
        <EtatChargement lignes={5} />
      </GabaritEcran>
    );
  }

  if (pointageOuvert.isError) {
    return (
      <GabaritEcran titre={t('pointage:technicien.titreEcran')}>
        <EtatErreur
          titre={t('pointage:technicien.erreur.titre')}
          description={messageErreur(pointageOuvert.error, t)}
          onReessayer={() => void pointageOuvert.refetch()}
        />
      </GabaritEcran>
    );
  }

  // Vue plein écran « Que pointez-vous ? » (point 3) : remplace ENTIÈREMENT l'écran, qu'on vienne
  // du flux normal (« Mes OR »/« Toutes les OR ouvertes ») ou du correctif #117 (« Changer »
  // pendant un pointage en cours) — les deux chemins passent par le même `setOrSelectionneId`.
  // Placé APRÈS les gardes de chargement/erreur ci-dessus (l'utilisateur ne peut matériellement
  // choisir un OR qu'une fois l'écran normal déjà rendu), mais AVANT tout le reste du rendu.
  // Titre porté par CE gabarit (pas par `DialogueChoixCiblePointage`, qui ne pose plus son propre
  // `h1` — un seul niveau 1 par état d'écran, chantier « titres doublés »).
  if (orSelectionneId) {
    return (
      <GabaritEcran titre={t('pointage:technicien.choisirCible.titre')}>
        <DialogueChoixCiblePointage
          onFermer={() => setOrSelectionneId(undefined)}
          technicienId={technicienId}
          requeteOr={requeteOrSelectionne}
          onChoisirLigne={handleChoisirLigne}
          onChoisirOrEntier={handleChoisirOrEntier}
          enDemarrage={demarrer.isPending}
        />
      </GabaritEcran>
    );
  }

  const pointageActuel = pointageOuvert.data;

  // Libellé de la cible EN COURS : le geste qui vient d'être fait DEPUIS CET ÉCRAN
  // (`cibleJusteChoisie`, polish d'affichage — voir sa docstring) s'il correspond exactement au
  // pointage productif actuellement ouvert ; sinon dérivé de la RÉPONSE API du document OR
  // (`requeteOrPointageActuel`, voir sa déclaration plus haut) — jamais un état local qui ne
  // survivrait pas à un F5 (défaut 2 : avant ce correctif, un rechargement pendant un pointage en
  // cours perdait la cible et retombait sur le texte générique « OR (sans ligne précise) » alors
  // que le serveur la connaît parfaitement).
  let libelleCibleActuelle = pointageActuel
    ? libelleCiblePointageTechnicien(pointageActuel, requeteOrPointageActuel.data, t)
    : '';
  if (pointageActuel && cibleJusteChoisie) {
    const memeCible =
      pointageActuel.ordreReparationId === cibleJusteChoisie.ordreReparationId &&
      pointageActuel.ligneOrId === cibleJusteChoisie.ligneOrId;
    if (memeCible) libelleCibleActuelle = cibleJusteChoisie.libelle;
  }

  // Correctif #148 : repli automatique quand « Mes OR du jour » est chargée et vide, sauf choix
  // EXPLICITE de l'utilisateur (voir la déclaration de `toutesOrOuvertesManuel` plus haut).
  const toutesOrOuvertesVisible = toutesOrOuvertesManuel ?? (mesOrdres.data ?? []).length === 0;

  // Bloc de choix de cible — partagé par DEUX emplacements : le flux normal (`!pointageActuel`,
  // inchangé) et le correctif #117 « Changer » (`pointageActuel && changementCibleOuvert`), pour
  // qu'un technicien change de cible SANS d'abord arrêter. Un seul bloc, jamais deux copies.
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
                  desactive={!peutDemarrerPointage(actions) || enTraitement}
                  siteNom={
                    sitesActifs.length > 1
                      ? sitesActifs.find((site) => site.id === or.siteId)?.nom
                      : undefined
                  }
                  lignesAssignees={compterLignesAssigneesPointables(or, technicienId)}
                  onChoisir={() => setOrSelectionneId(or.id)}
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
            onClick={() => setToutesOrOuvertesManuel(!toutesOrOuvertesVisible)}
          >
            {toutesOrOuvertesVisible
              ? t('pointage:toutesLesOr.masquer')
              : t('pointage:toutesLesOr.afficher')}
          </Button>
        </CardHeader>
        {toutesOrOuvertesVisible ? (
          <CardContent>
            <SelecteurOrOuvert
              siteId={siteId}
              onChoisirOr={(orId) => setOrSelectionneId(orId)}
              disabled={!peutDemarrerPointage(actions) || enTraitement}
            />
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('pointage:activites.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!siteId ? (
            <SelecteurSitePointage
              onChoisir={(valeur) => {
                const parametres = new URLSearchParams(searchParams);
                parametres.set('site', valeur);
                setSearchParams(parametres);
              }}
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {ACTIVITES_INDIRECTES.map((activite) => (
                <Button
                  key={activite}
                  size="lg"
                  variant="outline"
                  className="min-h-[72px] texte-annexe"
                  disabled={!peutDemarrerPointage(actions) || enTraitement}
                  onClick={() => handleDemarrerActiviteIndirecte(activite)}
                >
                  {libelleActiviteIndirecte(activite, t)}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );

  // Point 5 (bandeau de reprise) : possible dès qu'une activité INDIRECTE quelconque est en cours
  // ET qu'une cible productive est mémorisée CÔTÉ SERVEUR (`derniereCible`, P-34) — plus seulement
  // `pause` (voir la docstring de tête, « étendue de la reprise »). `cible` reste `undefined` tant
  // que la requête n'a pas abouti OU si elle échoue (repli silencieux, voir la docstring de tête) —
  // dans les deux cas `reprisePossible` vaut `false`, jamais de bandeau prématuré ni d'erreur
  // affichée pour ce complément non bloquant. Même condition que `onReprendre` de
  // `CartePointageEnCours` plus bas : les deux affichages du même geste ne doivent JAMAIS diverger.
  const cibleReprise = derniereCible.data;
  const reprisePossible = pointageActuel?.nature === 'indirect' && Boolean(cibleReprise);

  // Point 6 (« deux nombres ») : cumul du jour sur la cible du segment COURANT, dérivé de
  // `cumulsJour` (une seule requête, voir sa déclaration). `undefined` tant que la requête n'a pas
  // abouti ou que la nature du pointage ne se résout à aucune cible connue (repli défensif) —
  // `CartePointageEnCours` traite déjà `undefined`/`0` comme « rien à afficher ».
  const cibleSegmentCourant = pointageActuel ? cibleCumulDepuisPointage(pointageActuel) : undefined;
  const cumulSegmentCourant =
    cibleSegmentCourant && cumulsJour.pointages
      ? calculerCumulSecondesCible(cumulsJour.pointages, cibleSegmentCourant)
      : undefined;

  return (
    <GabaritEcran titre={t('pointage:technicien.titreEcran')}>
      {reprisePossible && pointageActuel && cibleReprise ? (
        <BandeauReprisePointage
          cibleLibelle={cibleReprise.libelle}
          interrompuDepuisLe={pointageActuel.debutLe}
          cumulAujourdhuiSecondes={cibleReprise.cumulSecondesDuJour}
          onReprendre={() => void handleReprendre()}
          enTraitement={enTraitement}
        />
      ) : null}

      {pointageActuel ? (
        <CartePointageEnCours
          pointage={pointageActuel}
          libelleCible={libelleCibleActuelle}
          onArreter={() => void handleArreter()}
          onPause={
            pointageActuel.nature === 'productif_ligne' || pointageActuel.nature === 'productif_or'
              ? () => void handlePause()
              : undefined
          }
          onReprendre={reprisePossible ? () => void handleReprendre() : undefined}
          onChanger={
            peutDemarrerPointage(actions)
              ? () => setChangementCibleOuvert((valeur) => !valeur)
              : undefined
          }
          enTraitement={enTraitement}
          messageErreur={erreurAction}
          avertissement={avertissementAction}
          cumulAujourdhuiSecondes={cumulSegmentCourant}
        />
      ) : null}

      {!pointageActuel && ligneAFinir ? (
        <BandeauLigneARealiser
          libelle={ligneAFinir.libelle}
          fait={ligneAFinir.fait}
          enCours={marquerRealisee.isPending}
          messageErreur={erreurRealisation}
          onMarquer={() => void handleMarquerRealisee()}
          onPlusTard={() => setLigneAFinir(undefined)}
        />
      ) : null}

      {!pointageActuel ? (
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

      {pointageActuel && changementCibleOuvert ? (
        <div className="flex flex-col gap-6">
          <h2 className="texte-titre-section">{t('pointage:technicien.choisirCible.titre')}</h2>
          {blocChoixCible}
        </div>
      ) : null}
    </GabaritEcran>
  );
}
