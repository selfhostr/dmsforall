import {
  Ban,
  Calendar,
  CheckCircle2,
  Circle,
  HelpCircle,
  KeyRound,
  Lock,
  PackageSearch,
  Receipt,
  Search,
  Truck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { EtatAfficheOrdreReparation } from '@dfa/shared';

import { BadgeStatut, type FormeBadge, type TokenStatut } from './BadgeStatut';

interface EntreeStatutOr {
  /** Suffixe de la clé `or:statuts.<cle>` — casse camelCase du fichier de traduction, distincte
   *  de la valeur d'enum snake_case (`en_cours` -> `enCours`). */
  readonly cle: string;
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
}

/**
 * Mapping exhaustif et type-safe (sur le modèle de `lib/roles.ts`) : ajouter une valeur à
 * `ETATS_AFFICHES_ORDRE_REPARATION` fait échouer `tsc` avant d'atteindre un écran.
 *
 * Source normative — `docs/design-etape-1-atelier.md` §5.2, reprise **telle quelle** (12 lignes ;
 * le texte « 11 statuts » du même document est une erreur de rédaction, la table fait foi).
 * Consomme `EtatAfficheOrdreReparation` (12 valeurs), jamais `StatutOrdreReparation` (9 valeurs) :
 * un badge câblé sur le statut brut n'afficherait jamais les trois états d'attente
 * (`attente_accord`/`attente_pieces`/`attente_externe`), pourtant l'information la plus utile au
 * comptoir pour expliquer pourquoi une voiture ne bouge pas.
 */
const CONFIG_STATUT_OR: Readonly<Record<EtatAfficheOrdreReparation, EntreeStatutOr>> = {
  planifie: { cle: 'planifie', icone: Calendar, token: 'neutre', forme: 'contour' },
  ouvert: { cle: 'ouvert', icone: Circle, token: 'info', forme: 'plein' },
  en_cours: { cle: 'enCours', icone: Wrench, token: 'info', forme: 'plein' },
  attente_accord: { cle: 'attenteAccord', icone: HelpCircle, token: 'attention', forme: 'plein' },
  attente_pieces: {
    cle: 'attentePieces',
    icone: PackageSearch,
    token: 'attention',
    forme: 'plein',
  },
  attente_externe: { cle: 'attenteExterne', icone: Truck, token: 'attention', forme: 'plein' },
  controle: { cle: 'controle', icone: Search, token: 'attention', forme: 'plein' },
  termine: { cle: 'termine', icone: CheckCircle2, token: 'succes', forme: 'plein' },
  facture: { cle: 'facture', icone: Receipt, token: 'succes', forme: 'plein' },
  restitue: { cle: 'restitue', icone: KeyRound, token: 'succes', forme: 'plein' },
  cloture: { cle: 'cloture', icone: Lock, token: 'terminal', forme: 'contour' },
  // `Ban` (cercle barré), jamais `Trash2` : le mot « supprimer » n'existe pas dans ce produit,
  // l'iconographie non plus (docs/design-etape-1-atelier.md §5.2).
  annule: { cle: 'annule', icone: Ban, token: 'danger', forme: 'contour' },
};

interface Props {
  readonly etat: EtatAfficheOrdreReparation;
  readonly className?: string;
}

/** Statut affiché d'un OR — un badge de la famille des badges de statut dédiés (§2 de
 *  docs/design-comptoir.md : les tokens `--statut-*` leur sont réservés, jamais consommés
 *  directement par un écran). Le rendu (forme + icône + mot, jamais la couleur seule — vérification
 *  daltonisme §5.5, `--statut-info` et `--statut-succes` restent séparables en protanopie) est
 *  porté par `BadgeStatut`, partagé avec ses pairs (`BadgeStatutDossierVente`,
 *  `BadgeStatutVehiculeStock`) ; seul le mapping `EtatAfficheOrdreReparation -> {icone, token,
 *  forme}` reste local à ce fichier. */
export function BadgeStatutOr({ etat, className }: Props) {
  const { t } = useTranslation('or');
  const config = CONFIG_STATUT_OR[etat];

  return (
    <BadgeStatut
      icone={config.icone}
      token={config.token}
      forme={config.forme}
      className={className}
    >
      {t(`or:statuts.${config.cle}`)}
    </BadgeStatut>
  );
}
