import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import {
  STATUTS_CONSIGNE_ECHANGE_STANDARD,
  TRI_DEFAUT_CONSIGNES,
  type FiltresConsignes,
  type ReponseConsigneEchangeStandard,
  type StatutConsigneEchangeStandard,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
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
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVideFiltre } from '@/composants/motifs/EtatVideFiltre';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useConsignes } from '@/hooks/pieces/useConsignes';
import { useMarquerRetourConsigne } from '@/hooks/pieces/useMarquerRetourConsigne';
import { useSession } from '@/hooks/useSession';
import { formaterDate, formaterMontant } from '@/lib/formats';

import { BadgeStatutConsigne } from './BadgeStatutConsigne';
import { peutRetournerConsigne } from './droits';
import { messageErreurMutation } from './messages-erreur-mutation';

/**
 * Suivi des consignes d'échange standard (RP-37 → RP-42, §6.4, §7.7) — « une consigne jamais
 * rendue est de l'argent qui dort ». Défaut sur `en_attente_retour_fournisseur` : c'est le statut
 * qui appelle une action, contrairement à `EcranReservationsPieces` où `active` est le défaut pour
 * la même raison. Ne solde JAMAIS une consigne automatiquement (RP-41) : la seule action possible
 * ici est le geste EXPLICITE du magasinier constatant le retour physique chez le fournisseur.
 *
 * Chantier « uniformisation pièces » (25.08.2026) : PAS de passage sur `BarreFiltres`, décision
 * DÉLIBÉRÉE — `ReponseConsigneEchangeStandard` (`pieces/consigne.ts`) ne porte QUE des identifiants
 * bruts (`articleId`, `ordreReparationId`, `ligneOrId`), aucun champ textuel joint (contrairement à
 * `ReponseReservationPiece`, qui expose `articleDesignation`/`ordreReparationNumero` — voir
 * `EcranReservationsPieces`, migré lui). Un montant et deux dates ne sont pas des cibles de
 * recherche texte pertinentes. Ajouter `q` ici exigerait donc de joindre `article`/`ordre_reparation`
 * au SQL sans aucun besoin garagiste identifié — une recherche qui ne cherche rien de plus que les
 * deux filtres déjà exacts (`statut`, `ancienneteJoursMin`) serait pire qu'une absence de
 * recherche. Le bouton « Effacer les filtres » reste aligné visuellement sur `BarreFiltres` (même
 * icône, même style) pour la cohérence du comptoir, sans le champ de recherche.
 */
export function EcranConsignesPieces() {
  const { t } = useTranslation(['pieces', 'commun']);
  const { data: session } = useSession();
  const role = session?.utilisateur.role;

  const [statut, setStatut] = useState<StatutConsigneEchangeStandard | undefined>(
    'en_attente_retour_fournisseur',
  );
  const [ancienneteSaisie, setAncienneteSaisie] = useState('');
  const [consigneAConfirmer, setConsigneAConfirmer] = useState<string | null>(null);

  const marquerRetour = useMarquerRetourConsigne();

  const ancienneteJoursMin =
    ancienneteSaisie.trim() === '' ? undefined : Number.parseInt(ancienneteSaisie, 10);
  const filtres: FiltresConsignes = useMemo(
    () => ({
      statut: statut ? [statut] : undefined,
      ancienneteJoursMin:
        ancienneteJoursMin !== undefined && !Number.isNaN(ancienneteJoursMin)
          ? ancienneteJoursMin
          : undefined,
      tri: TRI_DEFAUT_CONSIGNES,
      limite: 50,
    }),
    [statut, ancienneteJoursMin],
  );

  const {
    consignes,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useConsignes(filtres);

  const filtresActifs = statut !== undefined || ancienneteSaisie.trim() !== '';
  function effacerFiltres() {
    setStatut(undefined);
    setAncienneteSaisie('');
  }

  const colonnes: ColonneComptoir<ReponseConsigneEchangeStandard>[] = [
    {
      id: 'article',
      libelle: t('pieces:consignes.article'),
      rendu: (consigne) => (
        <Link
          to={`/pieces/articles/${consigne.articleId}`}
          className="texte-corps font-medium text-primary underline"
          onClick={(e) => e.stopPropagation()}
        >
          {t('pieces:reservations.voirArticle')}
        </Link>
      ),
    },
    {
      id: 'or',
      libelle: t('pieces:consignes.ordreReparation'),
      rendu: (consigne) => (
        <Link
          to={`/ordres-reparation/${consigne.ordreReparationId}`}
          className="texte-corps font-medium text-primary underline"
          onClick={(e) => e.stopPropagation()}
        >
          {t('pieces:reservations.voirOr')}
        </Link>
      ),
    },
    {
      id: 'montant',
      libelle: t('pieces:consignes.montant'),
      alignement: 'droite',
      rendu: (consigne) => (
        <span className="tabular-nums">{formaterMontant(consigne.montantConsigneTtcCentimes)}</span>
      ),
    },
    {
      id: 'statut',
      libelle: t('pieces:consignes.statut'),
      rendu: (consigne) => <BadgeStatutConsigne statut={consigne.statut} />,
    },
    {
      id: 'creeLe',
      libelle: t('pieces:consignes.creeLe'),
      alignement: 'droite',
      rendu: (consigne) => formaterDate(consigne.creeLe),
    },
    {
      id: 'actions',
      libelle: '',
      actions: true,
      rendu: (consigne) => {
        if (consigne.statut !== 'en_attente_retour_fournisseur' || !peutRetournerConsigne(role))
          return null;
        return (
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setConsigneAConfirmer(consigne.id)}
            >
              {t('pieces:consignes.actions.marquerRetour')}
            </Button>
          </div>
        );
      },
    },
  ];

  if (isPending) {
    return (
      <GabaritEcran titre={t('pieces:consignes.titre')}>
        <EtatChargement lignes={6} />
      </GabaritEcran>
    );
  }

  if (isError) {
    return (
      <GabaritEcran titre={t('pieces:consignes.titre')}>
        <EtatErreur
          titre={t('pieces:consignes.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      </GabaritEcran>
    );
  }

  return (
    <GabaritEcran titre={t('pieces:consignes.titre')}>
      <div className="flex flex-wrap items-end gap-groupe">
        <div className="flex flex-col gap-champ max-w-xs">
          <Label htmlFor="filtre-statut-consigne">{t('pieces:consignes.statut')}</Label>
          <Select
            value={statut ?? 'toutes'}
            onValueChange={(valeur) =>
              setStatut(valeur === 'toutes' ? undefined : (valeur as StatutConsigneEchangeStandard))
            }
          >
            <SelectTrigger id="filtre-statut-consigne" aria-label={t('pieces:consignes.statut')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="toutes">
                {t('pieces:reservations.filtres.statutToutes')}
              </SelectItem>
              {STATUTS_CONSIGNE_ECHANGE_STANDARD.map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {t(`pieces:consignes.statuts.${valeur}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-champ max-w-[220px]">
          <Label htmlFor="filtre-anciennete-consigne">
            {t('pieces:consignes.anciennes.anciennete')}
          </Label>
          <Input
            id="filtre-anciennete-consigne"
            type="number"
            min={0}
            inputMode="numeric"
            value={ancienneteSaisie}
            onChange={(evenement) => setAncienneteSaisie(evenement.target.value)}
          />
        </div>

        <Button type="button" variant="ghost" disabled={!filtresActifs} onClick={effacerFiltres}>
          <X aria-hidden className="h-4 w-4" />
          {t('commun:actions.effacerFiltres')}
        </Button>
      </div>

      <TableComptoir
        colonnes={colonnes}
        lignes={consignes}
        cleLigne={(consigne) => consigne.id}
        contenuVide={
          filtresActifs ? (
            <EtatVideFiltre
              titre={t('pieces:consignes.titre')}
              description={t('pieces:consignes.vide')}
              onEffacerFiltres={effacerFiltres}
            />
          ) : (
            <EtatVidePremierUsage
              titre={t('pieces:consignes.titre')}
              description={t('pieces:consignes.vide')}
            />
          )
        }
      />

      <BoutonChargerPlus
        aChargerPlus={Boolean(hasNextPage)}
        enChargement={isFetchingNextPage}
        onChargerPlus={() => void fetchNextPage()}
      />

      <AvertissementConfirmable
        ouvert={consigneAConfirmer !== null}
        onOuvertChange={(ouvert) => {
          if (!ouvert) setConsigneAConfirmer(null);
        }}
        titre={t('pieces:consignes.confirmations.marquerRetourTitre')}
        description={t('pieces:consignes.confirmations.marquerRetourDescription')}
        libelleConfirmation={t('pieces:consignes.actions.marquerRetour')}
        enCours={marquerRetour.isPending}
        messageErreur={marquerRetour.isError ? messageErreurMutation(marquerRetour.error, t) : null}
        onConfirmer={() => {
          if (!consigneAConfirmer) return;
          // Ferme la modale seulement sur succès (issue #63, correctif de cause racine) : un échec
          // la laisse ouverte, `messageErreur` ci-dessus l'affiche DANS la modale plutôt que sous
          // l'overlay où il restait invisible.
          marquerRetour.mutate(consigneAConfirmer, {
            onSuccess: () => setConsigneAConfirmer(null),
          });
        }}
      />
    </GabaritEcran>
  );
}
