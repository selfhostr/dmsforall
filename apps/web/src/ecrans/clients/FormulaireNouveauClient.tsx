import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm, type DefaultValues, type FieldPath, type Resolver } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { z } from 'zod';

import {
  schemaCreationClient,
  type EntreeCreationClient,
  type ReponseClient,
  type TypeClient,
} from '@dfa/shared';

import { ErreurApi, ErreurReseau, messageErreur, messageErreurChamp } from '@/api/erreurs';
import { useCleIdempotence } from '@/api/idempotence';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { BandeauBrouillon } from '@/composants/motifs/BandeauBrouillon';
import { effacerBrouillon, lireBrouillon } from '@/hooks/brouillon/brouillon';
import { useSauvegardeBrouillon } from '@/hooks/brouillon/useSauvegardeBrouillon';
import { useCreerClient } from '@/hooks/clients/useCreerClient';
import {
  useDoublonsClients,
  type CriteresDoublonsClients,
} from '@/hooks/clients/useDoublonsClients';
import { useValeurDebouncee } from '@/hooks/commun/useValeurDebouncee';
import { useLangue } from '@/hooks/useLangue';
import { cn } from '@/lib/utils';
import { chemins } from '@/routes/chemins';

interface Props {
  /** État d'ouverture du tiroir qui héberge ce formulaire (`EcranListeClients`). Piloté par le
   *  PARENT (jamais interne) : sert de déclencheur à la réinitialisation ci-dessous, exactement
   *  comme `DialogueModifierDossierVente` (`ecrans/ventes/dossiers/`) — même patron, copié plutôt
   *  que réinventé. Sans lui, une tentative échouée laisse ses valeurs dans le formulaire : la
   *  même instance de tiroir peut rester montée d'une ouverture à l'autre (fermeture puis
   *  réouverture rapides, avant la fin de l'animation de sortie de `SheetContent`), et une
   *  nouvelle saisie s'insère alors dans l'ancienne plutôt que de la remplacer — défaut réel
   *  constaté en test navigateur, avec un client corrompu créé en base. */
  readonly ouvert: boolean;
  /** Reçoit la fiche COMPLÈTE (pas seulement l'id) — issue #79 : `EcranListeClients` en a besoin
   *  pour transmettre `numeroClient`/`nomAffiche` à `EcranFicheClient` via l'état de navigation,
   *  seul moyen de distinguer, en cas d'échec de LECTURE juste après la création, « le client
   *  Rossier Jean a bien été créé (CL-000013), seul l'affichage a échoué » d'un vrai échec de
   *  création — voir `EcranFicheClient.tsx`. */
  readonly onCree: (client: ReponseClient) => void;
}

/** Transforme une saisie vide en `undefined` — nécessaire pour tout champ
 *  `schemaTexteCourt.nullish()` (`@dfa/shared`) : `nullish()` accepte `null`/`undefined`, jamais
 *  une chaîne vide (qui échoue `min(1)`). Sans ce garde-fou, un champ facultatif laissé vide
 *  produirait une erreur de validation plutôt que d'être simplement omis. */
function videVersIndefini(valeur: string): string | undefined {
  return valeur === '' ? undefined : valeur;
}

/** Valeurs SAISIES (pré-validation zod) du formulaire, PAS `EntreeCreationClient` (le résultat
 *  APRÈS transformation zod — `.default()`, `.superRefine()` appliqués). `zodResolver` (zod 4,
 *  `@hookform/resolvers/zod`) type le formulaire sur `z.input<Schema>` pour les valeurs de champ
 *  et sur `z.output<Schema>` (= `EntreeCreationClient`) uniquement pour le résultat transmis à
 *  `handleSubmit` — les deux DIVERGENT dès qu'un champ porte `.default(...)` (ex. `poObligatoire`,
 *  `telephones`) : optionnel en entrée, garanti présent en sortie. Utiliser `EntreeCreationClient`
 *  ici (comme avant l'ajout de `.superRefine(validerNpaSelonPays)` sur `adressePrincipale`,
 *  packages/shared/src/contrats/atelier/client.ts) fait diverger le type déduit de `useForm` de
 *  celui produit par `zodResolver`, et `tsc` refuse la valeur de retour du resolver. */
type ValeursSaisieFormulaire = z.input<typeof schemaCreationClient>;

/**
 * Un bloc adresse où RIEN n'a été saisi (formulaire resté tel que `valeursParDefaut` l'a posé)
 * compte comme AUCUNE adresse — RF-59, voir le commentaire de
 * `schemaCreationClient.adressePrincipale` (`packages/shared/src/contrats/atelier/client.ts`).
 * `pays` est exclu du test : il vaut toujours `'CH'` depuis `valeursParDefaut`, ce n'est jamais une
 * saisie de l'utilisateur — le compter ferait qu'aucune adresse n'est jamais « vide ». Une saisie
 * PARTIELLE (ex. seul le NPA rempli) n'est PAS vide ici : elle repart telle quelle vers la
 * validation zod, qui la refuse normalement (facultatif ne veut pas dire permissif).
 */
function adresseEstVide(adresse: ValeursSaisieFormulaire['adressePrincipale']): boolean {
  if (!adresse) return true;
  return (
    !adresse.rue?.trim() &&
    !adresse.complement?.trim() &&
    !adresse.npa?.trim() &&
    !adresse.localite?.trim()
  );
}

/** Clé de brouillon (issue #78) — UNE SEULE, jamais paramétrée par site/utilisateur : un seul
 *  tiroir « Nouveau client » peut être ouvert à la fois dans l'application (voir
 *  `hooks/brouillon/brouillon.ts` pour la doctrine sessionStorage). Exportée pour que
 *  `EcranListeClients` (le parent qui rend `SheetContent`) puisse, SANS dupliquer la forme du
 *  brouillon, décider si une fermeture non explicite (Échap, clic hors du panneau) doit être
 *  bloquée — voir `aUnBrouillonNouveauClientEnCours` ci-dessous. */
export const CLE_BROUILLON_NOUVEAU_CLIENT = 'client-nouveau';

/** Champs couverts par le brouillon (issue #78, verbatim terrain : « Nom, prénom, téléphone,
 *  rue : tout parti. ») — l'identité, le moyen de contact et l'adresse, c'est-à-dire tout ce
 *  qu'un réceptionniste tape avant de cliquer « Créer le client ». Volontairement PAS `email`/
 *  `ide`/langue de correspondance à part `langueCorrespondance` (nécessaire pour reconstruire des
 *  valeurs de formulaire valides) : portée alignée sur l'incident réel, pas un brouillon
 *  générique de tout le formulaire. */
interface ValeursBrouillonNouveauClient {
  readonly type: TypeClient;
  // `| null` en plus de `| undefined` : `form.watch(...)` renvoie le type BRUT
  // `z.input<schemaCreationClient>` (`nullish()` accepte les deux), pas la forme déjà normalisée
  // — voir `videVersIndefini`/`resolverClient`, qui n'entrent en jeu qu'à la soumission, jamais à
  // chaque frappe.
  readonly nom?: string | null;
  readonly prenom?: string | null;
  readonly raisonSociale?: string | null;
  readonly ide?: string | null;
  readonly email?: string | null;
  readonly langueCorrespondance: EntreeCreationClient['langueCorrespondance'];
  readonly telephoneSaisi: string;
  readonly adressePrincipale?: ValeursSaisieFormulaire['adressePrincipale'];
}

/** Un brouillon où AUCUN des champs couverts n'a de contenu réel compte comme une ABSENCE de
 *  brouillon (même doctrine que `adresseEstVide` ci-dessus, réutilisée pour le sous-champ
 *  adresse) : sans ce garde-fou, `useSauvegardeBrouillon` réécrirait un brouillon « vide » dès la
 *  première ouverture du tiroir (aucune saisie), et `BandeauBrouillon` annoncerait la reprise...
 *  de rien à la prochaine ouverture — voir le même correctif sur `FormulaireNouvelOrdreReparation`
 *  (issue #77). */
function brouillonEstVide(valeurs: ValeursBrouillonNouveauClient): boolean {
  return (
    !valeurs.nom?.trim() &&
    !valeurs.prenom?.trim() &&
    !valeurs.raisonSociale?.trim() &&
    !valeurs.ide?.trim() &&
    !valeurs.email?.trim() &&
    !valeurs.telephoneSaisi.trim() &&
    adresseEstVide(valeurs.adressePrincipale)
  );
}

/**
 * Lue par `EcranListeClients` (le parent qui rend `SheetContent`, propriétaire de la fermeture du
 * tiroir) pour décider si une fermeture NON explicite — touche Échap, clic sur la zone grisée
 * hors du panneau — doit être BLOQUÉE (issue #78 : les deux ferment le tiroir par défaut chez
 * Radix, sans confirmation, et ont fait perdre nom/prénom/téléphone/rue d'un réceptionniste en
 * plein comptoir ; mesuré en navigateur, pas supposé — les deux gestes closent bien
 * `SheetContent` aujourd'hui). Relit `sessionStorage` à chaque appel plutôt que de dupliquer un
 * état React entre les deux composants : c'est la même source de vérité que
 * `useSauvegardeBrouillon` écrit plus bas, sans mécanisme de synchronisation séparé. Le bouton de
 * fermeture visible (`SheetContent`, coin supérieur droit) n'est PAS concerné par ce garde-fou —
 * un clic dessus reste une fermeture EXPLICITE, toujours autorisée : le filet de rattrapage est
 * alors le brouillon restauré à la prochaine ouverture (`BandeauBrouillon` ci-dessous), pas un
 * blocage de la fermeture elle-même.
 */
export function aUnBrouillonNouveauClientEnCours(): boolean {
  const brouillon = lireBrouillon<ValeursBrouillonNouveauClient>(CLE_BROUILLON_NOUVEAU_CLIENT);
  return brouillon !== undefined && !brouillonEstVide(brouillon.valeurs);
}

/** Champs texte facultatifs (`schemaTexteCourt.nullish()`, voir `videVersIndefini`) que
 *  `form.reset()` peut poser à `''` SANS passer par le `onChange` de `register()` (voir le
 *  commentaire de `resolverClient` ci-dessous) — la liste que `resolverClient` doit normaliser
 *  avant de déléguer à `zodResolver`. */
const CHAMPS_TEXTE_NULLISH = ['nom', 'prenom', 'raisonSociale', 'ide', 'email'] as const;

/**
 * Enveloppe `zodResolver(schemaCreationClient)` plutôt que de l'utiliser tel quel — DEUX
 * normalisations, pour la même raison de fond : un champ non contrôlé (`register`) réinitialisé
 * par `form.reset(valeurs)` prend la valeur `valeurs` TELLE QUELLE dans le DOM, sans jamais
 * repasser par le `onChange` de `register()` (donc sans jamais repasser par `videVersIndefini`,
 * qui ne s'applique QU'à une saisie clavier réelle) :
 *
 * 1. `adressePrincipale` reste un OBJET (jamais `undefined`) tant qu'aucun champ n'a remplacé les
 *    valeurs par défaut — un client sans adresse soumettrait `{ rue: '', npa: '', localite: '',
 *    pays: 'CH' }`, que `schemaAdresseClientBase` refuse (`rue`/`npa`/`localite` en `min(1)`) —
 *    exactement le blocage que `.optional()` vient de lever côté contrat. Ne réécrit QUE le cas
 *    entièrement vide, jamais un cas partiel.
 * 2. `CHAMPS_TEXTE_NULLISH` (issue #78) — `valeursParDefaut`/`valeursDepuisBrouillon` posent CES
 *    champs à `''` (jamais `undefined`, jamais une clé omise) précisément pour que
 *    `form.reset()` vide bien le NŒUD DOM d'un champ resté monté d'une réouverture à l'autre
 *    (« Ignorer le brouillon » sans changer de type, notamment) — mesuré en test : `undefined` ou
 *    une clé absente laissent le `.value` DOM déjà tapé tel quel, SEUL `''` le vide réellement.
 *    Mais `''` heurte `.nullish()` (accepte `null`/`undefined`, jamais `''`) — sans ce second
 *    correctif, un client PARTICULIER ne se créait plus du tout : `raisonSociale`/`ide` (jamais
 *    rendus en mode particulier, donc jamais retapés) restaient à `''` jusqu'à la validation zod
 *    de la soumission suivante, qui échouait SILENCIEUSEMENT (`handleSubmit` sans `onInvalid`, ni
 *    message affiché — un champ MASQUÉ n'a nulle part où montrer son erreur).
 */
const resolverClient: Resolver<ValeursSaisieFormulaire, unknown, EntreeCreationClient> = (
  valeurs,
  contexte,
  options,
) => {
  const valeursNormalisees: ValeursSaisieFormulaire = { ...valeurs };
  for (const champ of CHAMPS_TEXTE_NULLISH) {
    if (valeursNormalisees[champ] === '') valeursNormalisees[champ] = undefined;
  }
  const valeursValidees = adresseEstVide(valeursNormalisees.adressePrincipale)
    ? { ...valeursNormalisees, adressePrincipale: undefined }
    : valeursNormalisees;
  return zodResolver(schemaCreationClient)(valeursValidees, contexte, options);
};

/** Valeurs par défaut du formulaire — fonction, pas un objet constant : `langueCorrespondance`
 *  dépend de la langue courante au moment de l'appel, et cette fonction est réappelée à CHAQUE
 *  ouverture du tiroir (voir l'effet de réinitialisation ci-dessous), pas seulement au montage.
 *
 *  Retour explicitement typé `DefaultValues<ValeursSaisieFormulaire>` : sans cette annotation, TS
 *  infère le type de retour depuis le seul littéral (`type: 'particulier'` resterait figé, pas
 *  élargi à `TypeClient`), et `useForm<T>` infère alors T depuis ce littéral trop étroit plutôt
 *  que depuis `zodResolver(schemaCreationClient)` — tout le formulaire perd `nom`, `email`, `ide`,
 *  etc. (absents des valeurs par défaut, donc absents du type déduit). */
function valeursParDefaut(
  langueCourante: EntreeCreationClient['langueCorrespondance'],
): DefaultValues<ValeursSaisieFormulaire> {
  return {
    type: 'particulier',
    // `''` explicite (jamais omis, jamais `undefined`) sur `CHAMPS_TEXTE_NULLISH` — seule valeur
    // qui fait réellement réinitialiser le NŒUD DOM d'un champ non contrôlé resté monté d'une
    // réouverture à l'autre (mesuré en test : une clé absente OU `undefined` laissent le `.value`
    // DOM déjà tapé tel quel). `resolverClient` ci-dessus neutralise le risque inverse (`''` heurte
    // `.nullish()`) en la reconvertissant en `undefined` juste avant validation — voir son
    // commentaire pour l'historique complet de ce correctif (issue #78).
    nom: '',
    prenom: '',
    raisonSociale: '',
    ide: '',
    email: '',
    langueCorrespondance: langueCourante,
    adressePrincipale: { rue: '', npa: '', localite: '', pays: 'CH' },
    telephones: [],
    poObligatoire: false,
  };
}

/** Reconstruit des valeurs de formulaire depuis un brouillon restauré (issue #78) — même rôle que
 *  `valeursParDefaut` ci-dessus, pour le cas où une saisie antérieure existe. `telephones`/
 *  `poObligatoire` restent posés comme `valeursParDefaut` (jamais couverts par le brouillon, voir
 *  le commentaire de `ValeursBrouillonNouveauClient`) : `telephoneSaisi` est restauré à part, en
 *  état local, exactement comme au premier rendu (voir plus bas). `CHAMPS_TEXTE_NULLISH` repliés
 *  sur `''` (jamais omis) pour la même raison que `valeursParDefaut` — `resolverClient` s'occupe de
 *  la reconversion avant validation. */
function valeursDepuisBrouillon(
  brouillon: ValeursBrouillonNouveauClient,
): DefaultValues<ValeursSaisieFormulaire> {
  return {
    type: brouillon.type,
    langueCorrespondance: brouillon.langueCorrespondance,
    nom: brouillon.nom ?? '',
    prenom: brouillon.prenom ?? '',
    raisonSociale: brouillon.raisonSociale ?? '',
    ide: brouillon.ide ?? '',
    email: brouillon.email ?? '',
    adressePrincipale: brouillon.adressePrincipale ?? {
      rue: '',
      npa: '',
      localite: '',
      pays: 'CH',
    },
    telephones: [],
    poObligatoire: false,
  };
}

/**
 * Formulaire de création client (RM-01, RM-05) — au comptoir, pas d'assistant multi-étapes :
 * un seul écran, l'identité minimale + adresse + un moyen de contact. Les champs avancés
 * (conditions commerciales, groupe, PO obligatoire) restent modifiables depuis la fiche après
 * création, hors périmètre de ce formulaire de première saisie.
 *
 * Doublon (RM-05, CT-01) : aperçu live non bloquant (`useDoublonsClients`, debounce 400 ms) sous
 * les champs d'identité, PUIS confirmation en deux temps à la soumission si des candidats
 * subsistent (`AvertissementConfirmable`, jamais `RefusBloquant` — deux frères à la même adresse
 * restent deux clients légitimes).
 */
export function FormulaireNouveauClient({ ouvert, onCree }: Props) {
  const { t } = useTranslation(['clients', 'commun', 'validation', 'erreurs']);
  const { langue: langueCourante, languesDisponibles } = useLangue();
  const idempotence = useCleIdempotence();
  const creerClient = useCreerClient();
  // Rendu sous la même route que EcranListeClients (sheet) : mêmes paramètres de requête, même
  // règle (routes/chemins.ts) — le lien « Voir » vers un doublon ne doit pas faire perdre le site.
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

  const [telephoneSaisi, setTelephoneSaisi] = useState('');
  const [entreeEnAttente, setEntreeEnAttente] = useState<EntreeCreationClient | null>(null);
  // Issue #78 : horodatage du brouillon restauré, `null` tant qu'aucun brouillon non vide n'a été
  // repris — pilote UNIQUEMENT `BandeauBrouillon` ci-dessous, jamais la validation. Posé par
  // l'effet de réinitialisation ci-dessous (qui relit `sessionStorage` à CHAQUE ouverture, y
  // compris la toute première), jamais par un état initial paresseux : voir son commentaire.
  const [brouillonRepriseLe, setBrouillonRepriseLe] = useState<string | null>(null);

  // Générique explicite (`ValeursSaisieFormulaire`, puis `unknown` pour le contexte, puis
  // `EntreeCreationClient` pour les valeurs TRANSFORMÉES reçues par `handleSubmit`) : voir le
  // commentaire de `ValeursSaisieFormulaire` ci-dessus. Sans lui, `tsc` doit choisir entre le
  // type déduit de `resolver` (entrée) et celui de `defaultValues` (qui pourrait, par erreur,
  // redevenir la sortie) — les rendre explicites élimine toute ambiguïté d'inférence.
  const form = useForm<ValeursSaisieFormulaire, unknown, EntreeCreationClient>({
    resolver: resolverClient,
    defaultValues: valeursParDefaut(langueCourante),
  });

  const type = form.watch('type');
  const nom = form.watch('nom');
  const prenom = form.watch('prenom');
  const raisonSociale = form.watch('raisonSociale');
  const ide = form.watch('ide');
  const email = form.watch('email');
  const langueCorrespondance = form.watch('langueCorrespondance');
  const adressePrincipale = form.watch('adressePrincipale');
  const npa = adressePrincipale?.npa;

  // Aperçu live de doublon (RM-05, CT-01) — même hook que `EcranDoublonsClients.tsx`, même
  // patron `useMemo` (référence stable) + `useValeurDebouncee` (hooks/commun/). 400ms, PLUS LENT
  // que la recherche standard (300ms) : un avertissement de doublon qui clignote à chaque frappe
  // serait plus gênant qu'utile — délai conservé tel quel, jamais uniformisé sur 300ms.
  const critereCandidat = useMemo<CriteresDoublonsClients>(
    () => ({
      nom: (type === 'entreprise' ? raisonSociale : nom) || undefined,
      npa: npa || undefined,
      email: email || undefined,
      telephoneMobile: telephoneSaisi || undefined,
      ide: ide || undefined,
    }),
    [type, nom, raisonSociale, npa, email, telephoneSaisi, ide],
  );
  const [criteres, reinitialiserCriteres] = useValeurDebouncee(critereCandidat, 400);

  useEffect(() => {
    if (!ouvert) return;
    // Issue #78 (mesuré en navigateur : Échap et un clic sur la zone grisée hors du panneau
    // ferment tous deux `SheetContent` par défaut, sans confirmation, et emportent nom/prénom/
    // téléphone/rue avec eux) — relu à CHAQUE ouverture, pas seulement au montage, pour couvrir
    // aussi bien la première ouverture qu'une réouverture après une fermeture accidentelle : si un
    // brouillon non vide existe, il REMPLACE les valeurs par défaut plutôt que de les effacer.
    // `EcranListeClients` bloque déjà la fermeture accidentelle elle-même
    // (`aUnBrouillonNouveauClientEnCours`) : ceci est le filet de rattrapage pour tout ce qui lui
    // échapperait malgré tout (fermeture explicite par le bouton visible, rechargement de page).
    const brouillon = lireBrouillon<ValeursBrouillonNouveauClient>(CLE_BROUILLON_NOUVEAU_CLIENT);
    const aBrouillon = brouillon !== undefined && !brouillonEstVide(brouillon.valeurs);
    form.reset(
      aBrouillon ? valeursDepuisBrouillon(brouillon.valeurs) : valeursParDefaut(langueCourante),
    );
    setTelephoneSaisi(aBrouillon ? brouillon.valeurs.telephoneSaisi : '');
    setBrouillonRepriseLe(aBrouillon ? brouillon.enregistreLe : null);
    setEntreeEnAttente(null);
    // Levier de reset (`hooks/commun/useValeurDebouncee`) : sans lui, l'aperçu de doublon de la
    // tentative PRÉCÉDENTE resterait affiché jusqu'à 400ms après la réouverture du tiroir — un
    // avertissement périmé pour un client qui n'a plus rien à voir avec la nouvelle saisie.
    reinitialiserCriteres();
    creerClient.reset();
    idempotence.regenerer();
    // Réinitialise à CHAQUE ouverture (pas seulement au montage) : même patron que
    // `DialogueModifierDossierVente` (ecrans/ventes/dossiers/) — la même instance de tiroir peut
    // rester montée d'une fermeture à l'autre (ex. fermeture puis réouverture avant la fin de
    // l'animation de sortie de `SheetContent`), et sans cet effet une tentative échouée laisse ses
    // valeurs dans le formulaire : la saisie suivante s'insère dans l'ancienne au lieu de la
    // remplacer (défaut réel constaté en test navigateur, client corrompu créé en base).
    // `idempotence.regenerer()` fait partie de cette réinitialisation : une réouverture est un
    // abandon explicite de la tentative précédente (api/idempotence.ts, en-tête du fichier), la
    // clé ne doit donc pas survivre — sinon une nouvelle saisie, distincte, rejouerait l'ancienne
    // clé et le serveur la refuserait comme `IDEMPOTENCE_CONFLIT`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert]);

  // Sauvegarde AUTOMATIQUE à chaque changement de l'un des champs couverts (issue #78) — voir
  // `ValeursBrouillonNouveauClient` pour la justification de cette portée précise. Actif dès le
  // montage (clé constante, jamais `undefined`) : le tiroir n'existe QUE pour une création, il n'y
  // a donc jamais de cas où ce brouillon ne devrait PAS s'écrire (contrairement à
  // `FormulaireNouvelOrdreReparation`, dont la clé dépend d'un véhicule pas toujours connu).
  useSauvegardeBrouillon<ValeursBrouillonNouveauClient>(CLE_BROUILLON_NOUVEAU_CLIENT, {
    type,
    nom,
    prenom,
    raisonSociale,
    ide,
    email,
    langueCorrespondance,
    telephoneSaisi,
    adressePrincipale,
  });

  /** Rejet EXPLICITE du brouillon repris (exigence n°2, issue #78 — mêmes mots que le correctif
   *  jumeau sur `FormulaireNouvelOrdreReparation`, issue #77) : `BandeauBrouillon` sans ce geste ne
   *  ferait qu'annoncer la reprise, jamais permettre de l'écarter. */
  function ignorerBrouillon() {
    effacerBrouillon(CLE_BROUILLON_NOUVEAU_CLIENT);
    form.reset(valeursParDefaut(langueCourante));
    setTelephoneSaisi('');
    setBrouillonRepriseLe(null);
  }

  const doublons = useDoublonsClients(criteres);
  const candidats = doublons.data?.candidats ?? [];
  const premierCandidat = candidats[0];

  const creer = (entree: EntreeCreationClient) => {
    creerClient.mutate(
      { entree, idempotencyKey: idempotence.cle },
      {
        onSuccess: (reponse) => {
          idempotence.regenerer();
          // Effacé UNIQUEMENT sur un succès serveur confirmé (exigence n°1, issue #78) : un client
          // créé avec succès rend le brouillon local obsolète — le laisser vivre ferait resurgir
          // l'identité du CLIENT PRÉCÉDENT dans le tiroir suivant, envoyée sans relecture parce
          // qu'on croirait reconnaître sa propre saisie (même risque que celui déjà écarté sur
          // `FormulaireNouvelOrdreReparation`, issue #77). Jamais sur un simple échec (réseau ou
          // refus serveur) : l'utilisateur doit encore pouvoir corriger et renvoyer sans retaper.
          effacerBrouillon(CLE_BROUILLON_NOUVEAU_CLIENT);
          onCree(reponse.donnees);
        },
        onError: (erreurMutation) => {
          // §3.5 règle 5 : une erreur de champ (`ProblemeDetail.erreurs[]`) est réinjectée dans
          // react-hook-form pour s'afficher SOUS le champ fautif, exactement comme une erreur de
          // validation locale — au lieu de mourir dans le bandeau générique ci-dessous. Défaut réel
          // constaté en test navigateur : un IDE ou une adresse refusés par le serveur (doublon
          // d'adresse active, format zod) ne montraient RIEN sur le champ concerné, seulement
          // « Certaines informations sont incorrectes. » en haut de formulaire.
          if (erreurMutation instanceof ErreurApi) {
            for (const champErreur of erreurMutation.erreursChamp) {
              form.setError(champErreur.champ as FieldPath<ValeursSaisieFormulaire>, {
                type: 'server',
                message: messageErreurChamp(champErreur, t),
              });
            }
          }
        },
      },
    );
  };

  const soumettre = form.handleSubmit((valeurs) => {
    const entree: EntreeCreationClient = {
      ...valeurs,
      telephones: telephoneSaisi.trim() ? [{ valeur: telephoneSaisi.trim(), principal: true }] : [],
    };
    if (candidats.length > 0) {
      setEntreeEnAttente(entree);
      return;
    }
    creer(entree);
  });

  const confirmerMalgreDoublon = () => {
    if (entreeEnAttente) creer(entreeEnAttente);
    setEntreeEnAttente(null);
  };

  const enCours = creerClient.isPending;
  const erreur = creerClient.error;
  const estErreurReseau = erreur instanceof ErreurReseau;

  return (
    <form onSubmit={soumettre} noValidate className="space-y-groupe">
      {/* Issue #78 : signale ET permet de rejeter une saisie restaurée — un formulaire qui se
       *  remplit tout seul sans le dire ferait douter de ce qu'on est en train d'envoyer.
       *  `BandeauBrouillon` (partagé) ne porte pas de bouton de rejet lui-même (présentation
       *  seule) : le geste vit ici, même patron que `FormulaireNouvelOrdreReparation` (issue #77). */}
      {brouillonRepriseLe ? (
        <div className="flex items-center gap-2">
          <BandeauBrouillon repriseLe={brouillonRepriseLe} className="flex-1" />
          <Button type="button" variant="outline" size="sm" onClick={ignorerBrouillon}>
            {t('clients:formulaireNouveau.brouillon.ignorer')}
          </Button>
        </div>
      ) : null}

      {erreur ? (
        <Alert variant={estErreurReseau ? 'avertissement' : 'destructive'}>
          {estErreurReseau ? (
            <WifiOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
          )}
          <AlertTitle>
            {t(estErreurReseau ? 'erreurs:reseau.titre' : 'erreurs:inattendue.titre')}
          </AlertTitle>
          <AlertDescription>{messageErreur(erreur, t)}</AlertDescription>
          {/* Issue #79 : une panne réseau pendant `POST /clients` ne dit rien sur ce qui s'est
           *  réellement passé côté serveur — la création a pu aboutir sans que l'accusé de
           *  réception arrive. Cliquer de nouveau sur « Créer le client » est SÛR dans ce tiroir
           *  précisément parce que la clé d'idempotence (`api/idempotence.ts`) n'est régénérée
           *  qu'après un succès confirmé ou une fermeture explicite (voir plus haut) : un rejeu
           *  porte donc la MÊME clé, que le serveur reconnaît plutôt que de créer un second
           *  client. Sans cette précision, le seul message affiché (« vérifiez votre connexion »)
           *  laisse croire que rien n'a été tenté et pousse à retaper ailleurs — exactement le
           *  quasi-doublon rapporté sur le client Rossier (issue #79). */}
          {estErreurReseau ? (
            <p className="mt-2 texte-libelle text-muted-foreground">
              {t('clients:formulaireNouveau.reessaiSansDoublon')}
            </p>
          ) : null}
        </Alert>
      ) : null}

      <div className="flex flex-col items-start gap-2">
        <Label>{t('clients:liste.filtres.type')}</Label>
        {/* Bordure structurelle : contour d'un contrôle de saisie (bascule particulier/
         *  entreprise, `role="group"` de boutons). */}
        <div role="group" className="inline-flex overflow-hidden rounded-md border">
          {(['particulier', 'entreprise'] as const satisfies readonly TypeClient[]).map(
            (valeur) => (
              <button
                key={valeur}
                type="button"
                aria-pressed={type === valeur}
                onClick={() => form.setValue('type', valeur, { shouldValidate: true })}
                className={cn(
                  'h-11 px-4 texte-corps font-medium transition-colors',
                  type === valeur
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-foreground hover:bg-muted',
                )}
              >
                {t(`clients:liste.types.${valeur}`)}
              </button>
            ),
          )}
        </div>
      </div>

      {type === 'particulier' ? (
        // `key` DISTINCT du bloc « entreprise » ci-dessous : sans lui, React voit deux `<Input>`
        // non contrôlés à la MÊME position d'arbre lors du basculement de `type` (ex. après
        // `form.reset()` à la réouverture, défaut 1) et réutilise le NŒUD DOM existant plutôt que
        // d'en monter un nouveau — l'ancien texte tapé dans « Raison sociale » restait alors
        // visible comme valeur brute de l'input « Nom » (React ne réinitialise jamais `.value`
        // d'un champ non contrôlé lors d'une simple mise à jour de props). Constaté en écrivant le
        // test de non-régression du défaut 1 : sans ce `key`, il échouait avec exactement ce
        // symptôme, sur un champ pourtant déjà vidé par `form.reset()`.
        <div key="identite-particulier" className="grid grid-cols-1 gap-groupe sm:grid-cols-2">
          <div className="space-y-champ">
            <Label htmlFor="nc-prenom">{t('clients:identite.prenom')}</Label>
            <Input
              id="nc-prenom"
              readOnly={enCours}
              {...form.register('prenom', { setValueAs: videVersIndefini })}
            />
          </div>
          <div className="space-y-champ">
            <Label htmlFor="nc-nom">{t('clients:identite.nom')}</Label>
            <Input
              id="nc-nom"
              readOnly={enCours}
              aria-invalid={form.formState.errors.nom ? true : undefined}
              aria-describedby={form.formState.errors.nom ? 'nc-nom-erreur' : undefined}
              {...form.register('nom', { setValueAs: videVersIndefini })}
            />
            {form.formState.errors.nom ? (
              <p id="nc-nom-erreur" className="texte-corps text-destructive">
                {form.formState.errors.nom.type === 'server'
                  ? form.formState.errors.nom.message
                  : t('validation:requis')}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div key="identite-entreprise" className="grid grid-cols-1 gap-groupe sm:grid-cols-2">
          <div className="space-y-champ">
            <Label htmlFor="nc-raison-sociale">{t('clients:identite.raisonSociale')}</Label>
            <Input
              id="nc-raison-sociale"
              readOnly={enCours}
              aria-invalid={form.formState.errors.raisonSociale ? true : undefined}
              aria-describedby={
                form.formState.errors.raisonSociale ? 'nc-raison-sociale-erreur' : undefined
              }
              {...form.register('raisonSociale', { setValueAs: videVersIndefini })}
            />
            {form.formState.errors.raisonSociale ? (
              <p id="nc-raison-sociale-erreur" className="texte-corps text-destructive">
                {form.formState.errors.raisonSociale.type === 'server'
                  ? form.formState.errors.raisonSociale.message
                  : t('validation:requis')}
              </p>
            ) : null}
          </div>
          <div className="space-y-champ">
            <Label htmlFor="nc-ide">{t('clients:identite.ide')}</Label>
            <Input
              id="nc-ide"
              readOnly={enCours}
              placeholder="CHE-123.456.789"
              aria-invalid={form.formState.errors.ide ? true : undefined}
              aria-describedby={form.formState.errors.ide ? 'nc-ide-erreur' : undefined}
              {...form.register('ide', { setValueAs: videVersIndefini })}
            />
            {form.formState.errors.ide ? (
              // Défaut 2 corrigé ici : un IDE mal formé (ex. « 12345 ») échouait `schemaIde`
              // (regex zod) SANS jamais afficher son erreur — `handleSubmit` refuse silencieusement
              // de soumettre (aucune requête réseau), et rien ne le montre au garagiste. Le message
              // zod natif n'étant pas traduit (§ commentaire de `messageErreurChamp`), on retombe
              // sur le générique existant plutôt que d'afficher un texte anglais brut.
              <p id="nc-ide-erreur" className="texte-corps text-destructive">
                {form.formState.errors.ide.type === 'server'
                  ? form.formState.errors.ide.message
                  : t('erreurs:codes.VALIDATION_ECHOUEE')}
              </p>
            ) : null}
          </div>
        </div>
      )}

      <fieldset className="space-y-groupe">
        <legend className="mb-2 texte-libelle font-medium text-foreground">
          {t('clients:formulaireNouveau.adresse')}
        </legend>
        <div className="space-y-champ">
          <Label htmlFor="nc-rue">{t('clients:adresses.champs.rue')}</Label>
          <Input
            id="nc-rue"
            readOnly={enCours}
            aria-invalid={form.formState.errors.adressePrincipale?.rue ? true : undefined}
            aria-describedby={
              form.formState.errors.adressePrincipale?.rue ? 'nc-rue-erreur' : undefined
            }
            {...form.register('adressePrincipale.rue')}
          />
          {form.formState.errors.adressePrincipale?.rue ? (
            <p id="nc-rue-erreur" className="texte-corps text-destructive">
              {form.formState.errors.adressePrincipale.rue.type === 'server'
                ? form.formState.errors.adressePrincipale.rue.message
                : t('validation:requis')}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-[6rem_1fr] gap-groupe">
          <div className="space-y-champ">
            <Label htmlFor="nc-npa">{t('clients:adresses.champs.npa')}</Label>
            <Input
              id="nc-npa"
              readOnly={enCours}
              aria-invalid={form.formState.errors.adressePrincipale?.npa ? true : undefined}
              aria-describedby={
                form.formState.errors.adressePrincipale?.npa ? 'nc-npa-erreur' : undefined
              }
              {...form.register('adressePrincipale.npa')}
            />
            {form.formState.errors.adressePrincipale?.npa ? (
              <p id="nc-npa-erreur" className="texte-corps text-destructive">
                {form.formState.errors.adressePrincipale.npa.type === 'server'
                  ? form.formState.errors.adressePrincipale.npa.message
                  : t('validation:requis')}
              </p>
            ) : null}
          </div>
          <div className="space-y-champ">
            <Label htmlFor="nc-localite">{t('clients:adresses.champs.localite')}</Label>
            <Input
              id="nc-localite"
              readOnly={enCours}
              aria-invalid={form.formState.errors.adressePrincipale?.localite ? true : undefined}
              aria-describedby={
                form.formState.errors.adressePrincipale?.localite ? 'nc-localite-erreur' : undefined
              }
              {...form.register('adressePrincipale.localite')}
            />
            {form.formState.errors.adressePrincipale?.localite ? (
              <p id="nc-localite-erreur" className="texte-corps text-destructive">
                {form.formState.errors.adressePrincipale.localite.type === 'server'
                  ? form.formState.errors.adressePrincipale.localite.message
                  : t('validation:requis')}
              </p>
            ) : null}
          </div>
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-groupe sm:grid-cols-2">
        <div className="space-y-champ">
          <Label htmlFor="nc-telephone">{t('clients:identite.telephone')}</Label>
          <Input
            id="nc-telephone"
            type="tel"
            readOnly={enCours}
            value={telephoneSaisi}
            onChange={(evenement) => setTelephoneSaisi(evenement.target.value)}
          />
        </div>
        <div className="space-y-champ">
          <Label htmlFor="nc-email">{t('clients:identite.email')}</Label>
          <Input
            id="nc-email"
            type="email"
            readOnly={enCours}
            aria-invalid={form.formState.errors.email ? true : undefined}
            aria-describedby={form.formState.errors.email ? 'nc-email-erreur' : undefined}
            {...form.register('email', { setValueAs: videVersIndefini })}
          />
          {form.formState.errors.email ? (
            <p id="nc-email-erreur" className="texte-corps text-destructive">
              {form.formState.errors.email.type === 'server'
                ? form.formState.errors.email.message
                : t('validation:email.invalide')}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-champ sm:w-1/2 sm:pr-2">
        <Label htmlFor="nc-langue">{t('clients:identite.langue')}</Label>
        <Select
          value={form.watch('langueCorrespondance')}
          onValueChange={(valeur) =>
            form.setValue(
              'langueCorrespondance',
              valeur as EntreeCreationClient['langueCorrespondance'],
            )
          }
        >
          <SelectTrigger id="nc-langue" aria-label={t('clients:identite.langue')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {languesDisponibles.map((code) => (
              <SelectItem key={code} value={code}>
                {t(`commun:langues.${code}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {candidats.length > 0 ? (
        // Bordure structurelle : encart d'alerte (doublons potentiels détectés à la saisie).
        <div className="space-y-groupe rounded-md border border-statut-attention bg-statut-attention-fond p-carte">
          <p className="texte-libelle font-semibold text-foreground">
            {t('clients:doublons.titre')}
          </p>
          <ul className="space-y-groupe">
            {candidats.map((candidat) => (
              <li
                key={candidat.clientId}
                className="flex items-center justify-between gap-3 texte-corps"
              >
                <span className="min-w-0 truncate">
                  {candidat.nom} · {t(`clients:doublons.criteres.${candidat.critere}`)} ·{' '}
                  {t('clients:doublons.score')} {Math.round(candidat.score * 100)} %
                </span>
                <Link
                  to={chemins.clients.detail(candidat.clientId, site)}
                  className="shrink-0 texte-libelle font-medium text-primary underline"
                >
                  {t('clients:doublons.voir')}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={enCours}>
          {enCours ? t('commun:chargement.enCours') : t('clients:actions.creer')}
        </Button>
      </div>

      <AvertissementConfirmable
        ouvert={entreeEnAttente !== null}
        onOuvertChange={(ouvert) => {
          if (!ouvert) setEntreeEnAttente(null);
        }}
        titre={t('clients:doublons.titre')}
        description={
          premierCandidat
            ? `${t('clients:doublons.clientSimiliaire')} — ${premierCandidat.nom} (${premierCandidat.numeroClient}).`
            : t('clients:doublons.clientSimiliaire')
        }
        libelleConfirmation={t('clients:doublons.creerQuandMeme')}
        onConfirmer={confirmerMalgreDoublon}
        enCours={enCours}
      />
    </form>
  );
}
