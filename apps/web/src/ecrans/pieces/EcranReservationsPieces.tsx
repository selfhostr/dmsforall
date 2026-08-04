import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import {
  STATUTS_RESERVATION_PIECE,
  TRI_DEFAUT_RESERVATIONS,
  type FiltresReservations,
  type ReponseReservationPiece,
  type StatutReservationPiece,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVideFiltre } from '@/composants/motifs/EtatVideFiltre';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { useReservations } from '@/hooks/pieces/useReservations';
import { useSatisfaireReservation } from '@/hooks/pieces/useTransitionsReservation';
import { useSession } from '@/hooks/useSession';
import { formaterDateHeure } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { DialogueLiberationReservation } from './DialogueLiberationReservation';
import { peutLibererReservation, peutSatisfaireReservation } from './droits';
import { formaterQuantiteMillieme } from './utils';

const VARIANTE_BADGE_STATUT: Record<StatutReservationPiece, 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  satisfaite: 'secondary',
  liberee: 'outline',
};

/**
 * Vue transverse des réservations (RP-19 → RP-25, priorité 4 du brief) — « qu'est-ce qui est
 * réservé, pour qui, depuis quand ». `ReponseReservationPiece` (@dfa/shared) ne porte AUCUN champ
 * de désignation d'affichage (ni `numeroArticle`, ni le numéro d'OR) — seulement des identifiants
 * bruts (`articleId`, `ordreReparationId`) : cette table les rend donc CLIQUABLES vers la fiche
 * article et l'OR plutôt que d'inventer un libellé que le contrat ne fournit pas.
 */
export function EcranReservationsPieces() {
  const { t } = useTranslation(['pieces', 'commun']);
  const { data: session } = useSession();
  const role = session?.utilisateur.role;

  const [statut, setStatut] = useState<StatutReservationPiece | undefined>('active');
  const [reservationALiberer, setReservationALiberer] = useState<string | null>(null);

  const satisfaire = useSatisfaireReservation();

  const filtres: FiltresReservations = {
    statut: statut ? [statut] : undefined,
    tri: TRI_DEFAUT_RESERVATIONS,
    limite: 50,
  };
  const {
    reservations,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useReservations(filtres);

  const colonnes: ColonneComptoir<ReponseReservationPiece>[] = [
    {
      id: 'article',
      libelle: t('pieces:reservations.article'),
      rendu: (reservation) => (
        <Link
          to={chemins.pieces.articleDetail(reservation.articleId)}
          className="texte-corps font-medium text-primary underline"
          onClick={(e) => e.stopPropagation()}
        >
          {t('pieces:reservations.voirArticle')}
        </Link>
      ),
    },
    {
      id: 'or',
      libelle: t('pieces:reservations.ordreReparation'),
      rendu: (reservation) => (
        <Link
          to={`/ordres-reparation/${reservation.ordreReparationId}`}
          className="texte-corps font-medium text-primary underline"
          onClick={(e) => e.stopPropagation()}
        >
          {t('pieces:reservations.voirOr')}
        </Link>
      ),
    },
    {
      id: 'quantite',
      libelle: t('pieces:reservations.quantite'),
      alignement: 'droite',
      rendu: (reservation) => (
        <span className="tabular-nums">
          {formaterQuantiteMillieme(reservation.quantiteMillieme)}
        </span>
      ),
    },
    {
      id: 'statut',
      libelle: t('pieces:reservations.statut'),
      rendu: (reservation) => (
        <Badge variant={VARIANTE_BADGE_STATUT[reservation.statut]}>
          {t(`pieces:reservations.statuts.${reservation.statut}`)}
        </Badge>
      ),
    },
    {
      id: 'creeLe',
      libelle: t('pieces:reservations.creeLe'),
      alignement: 'droite',
      rendu: (reservation) => formaterDateHeure(reservation.creeLe),
    },
    {
      id: 'actions',
      libelle: '',
      actions: true,
      rendu: (reservation) => {
        if (reservation.statut !== 'active') return null;
        return (
          <div className="flex justify-end gap-2">
            {peutSatisfaireReservation(role) ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={satisfaire.isPending}
                onClick={() => satisfaire.mutate(reservation.id)}
              >
                {t('pieces:reservations.actions.satisfaire')}
              </Button>
            ) : null}
            {peutLibererReservation(role) ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setReservationALiberer(reservation.id)}
              >
                {t('pieces:reservations.actions.liberer')}
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  if (isPending) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pieces:reservations.titre')}</h1>
        <EtatChargement lignes={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pieces:reservations.titre')}</h1>
        <EtatErreur
          titre={t('pieces:reservations.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('pieces:reservations.titre')}</h1>

      <div className="flex flex-col gap-1.5 max-w-xs">
        <Label htmlFor="filtre-statut-reservation">{t('pieces:reservations.statut')}</Label>
        <Select
          value={statut ?? 'toutes'}
          onValueChange={(valeur) =>
            setStatut(valeur === 'toutes' ? undefined : (valeur as StatutReservationPiece))
          }
        >
          <SelectTrigger
            id="filtre-statut-reservation"
            aria-label={t('pieces:reservations.statut')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="toutes">{t('pieces:reservations.filtres.statutToutes')}</SelectItem>
            {STATUTS_RESERVATION_PIECE.map((valeur) => (
              <SelectItem key={valeur} value={valeur}>
                {t(`pieces:reservations.statuts.${valeur}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <TableComptoir
        colonnes={colonnes}
        lignes={reservations}
        cleLigne={(reservation) => reservation.id}
        contenuVide={
          statut ? (
            <EtatVideFiltre
              titre={t('pieces:reservations.titre')}
              description={t('pieces:reservations.vide')}
              onEffacerFiltres={() => setStatut(undefined)}
            />
          ) : (
            <EtatVidePremierUsage
              titre={t('pieces:reservations.titre')}
              description={t('pieces:reservations.vide')}
            />
          )
        }
      />

      <BoutonChargerPlus
        aChargerPlus={Boolean(hasNextPage)}
        enChargement={isFetchingNextPage}
        onChargerPlus={() => void fetchNextPage()}
      />

      <DialogueLiberationReservation
        reservationId={reservationALiberer}
        onFerme={() => setReservationALiberer(null)}
      />
    </div>
  );
}
