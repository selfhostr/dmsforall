import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { messageErreur } from '@/api/erreurs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';

/**
 * Forme minimale commune à `UseQueryResult` (TanStack Query) et `UseInfiniteQueryResult` — les
 * deux hooks source des blocs du tableau de bord (`useActiviteTableauBord`/`useFinancierTableauBord`
 * d'un côté, `useReservations`/`useReapprovisionnement`/`useListePointages` de l'autre, tous bâtis
 * sur `useListeCurseur`, `hooks/pagination-curseur.ts`). Structurel plutôt qu'importé : les deux
 * satisfont cette forme sans conversion, ce composant n'a pas besoin de savoir lequel il reçoit.
 */
export interface ResultatChiffreTableauBord<T> {
  readonly data: T | undefined;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly refetch: () => unknown;
}

interface Props<T> {
  readonly titre: string;
  readonly resultat: ResultatChiffreTableauBord<T>;
  readonly libelleErreur: string;
  readonly valeur: (donnees: T) => string;
  readonly description?: (donnees: T) => ReactNode;
  readonly lien?: { readonly to: string; readonly texte: string };
  /** DESIGN.md « densité » — rembourrage réduit (`--espace-carte-compacte`), réservé au contenu
   *  minimal que cette carte porte par nature (un chiffre, un titre, un libellé) : candidat
   *  explicitement cité par le socle. `false` par défaut, jamais activé pour ne pas changer le
   *  rendu des appelants existants sans le vouloir. */
  readonly compact?: boolean;
  /** Positionnement dans la grille de l'appelant (ex. `sm:col-span-2`) — jamais un style visuel,
   *  seulement du placement, cohérent avec la Card qui reste par ailleurs sans classe imposée par
   *  cet appelant. */
  readonly className?: string;
}

/**
 * Carte « chiffre net et gros » du tableau de bord par rôle — un seul indicateur, chargement /
 * erreur / donnée gérés une seule fois ici plutôt que recopiés dans chaque bloc de rôle (Direction,
 * Comptable, Chef d'atelier, Admin en partagent tous au moins un). Décomposition demandée par
 * `docs/design-tableau-bord-par-role.md` §6 : les anciens `BlocActiviteTableauBord`/
 * `BlocFinancierTableauBord` (deux blocs figés identiques pour tous) sont DÉMANTELÉS, leurs champs
 * redistribués un par un via ce sous-bloc réutilisable.
 *
 * Pas d'état « vide » distinct ici : une période/un site sans activité affiche un ZÉRO digne
 * (doctrine déjà appliquée par l'ancien `BlocActiviteTableauBord`, reprise telle quelle) — jamais
 * un message « aucune donnée » à la place d'un chiffre à zéro légitime.
 */
export function CarteChiffreRequete<T>({
  titre,
  resultat,
  libelleErreur,
  valeur,
  description,
  lien,
  compact = false,
  className,
}: Props<T>) {
  const { t } = useTranslation('commun');

  return (
    <Card compact={compact} className={className}>
      <CardHeader>
        <CardTitle>{titre}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {resultat.isPending ? (
          <EtatChargement lignes={2} />
        ) : resultat.isError ? (
          <EtatErreur
            titre={libelleErreur}
            description={messageErreur(resultat.error, t)}
            onReessayer={() => void resultat.refetch()}
          />
        ) : (
          <>
            <span className="texte-chiffre-geant tabular-nums font-semibold text-foreground">
              {valeur(resultat.data as T)}
            </span>
            {description ? (
              <p className="texte-libelle text-muted-foreground">
                {description(resultat.data as T)}
              </p>
            ) : null}
            {lien ? (
              <Link to={lien.to} className="texte-libelle font-medium text-primary underline">
                {lien.texte}
              </Link>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
