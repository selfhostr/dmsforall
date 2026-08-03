import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import {
  STATUTS_COMMANDE_FOURNISSEUR,
  TRI_DEFAUT_COMMANDES_FOURNISSEUR,
  type FiltresCommandesFournisseur,
  type ReponseCommandeFournisseur,
  type StatutCommandeFournisseur,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVideFiltre } from '@/composants/motifs/EtatVideFiltre';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { useListeCommandesFournisseur } from '@/hooks/pieces/useListeCommandesFournisseur';
import { useSession } from '@/hooks/useSession';
import { formaterDate } from '@/lib/formats';

import { peutEcrireCommandeFournisseur } from './droits';

const VARIANTE_BADGE_STATUT: Record<StatutCommandeFournisseur, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  brouillon: 'outline',
  envoyee: 'default',
  partiellement_recue: 'secondary',
  recue: 'secondary',
  cloturee: 'secondary',
  annulee: 'destructive',
};

/**
 * Liste des commandes fournisseur (RP-26 → RP-31, §6.2, priorité 1 du lot) — filtres statut,
 * fournisseur, site, et le raccourci « avec reliquat » (§6.3 de `commande-fournisseur.ts`, sucre
 * équivalent à `statut: ['envoyee','partiellement_recue']`, documenté explicitement côté contrat).
 * `ReponseCommandeFournisseur` ne porte aucun libellé de fournisseur/site embarqué — même remarque
 * que `EcranReservationsPieces` : le fournisseur est un lien cliquable, le site est résolu depuis
 * la session (liste COMPLÈTE, contrairement aux fournisseurs qui peuvent être paginés).
 */
export function EcranListeCommandesFournisseur() {
  const { t } = useTranslation(['pieces', 'commun']);
  const navigate = useNavigate();
  const { data: session } = useSession();
  const role = session?.utilisateur.role;
  const sites = session?.sites ?? [];

  const [statut, setStatut] = useState<StatutCommandeFournisseur | undefined>(undefined);
  const [avecReliquat, setAvecReliquat] = useState(false);

  const filtres: FiltresCommandesFournisseur = useMemo(
    () => ({
      statut: statut ? [statut] : undefined,
      avecReliquat: avecReliquat ? true : undefined,
      tri: TRI_DEFAUT_COMMANDES_FOURNISSEUR,
      limite: 50,
    }),
    [statut, avecReliquat],
  );

  const { commandes, isPending, isError, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useListeCommandesFournisseur(filtres);

  const nomSite = (siteId: string) => sites.find((site) => site.id === siteId)?.nom ?? siteId;

  const filtresActifs = statut !== undefined || avecReliquat;
  function effacerFiltres() {
    setStatut(undefined);
    setAvecReliquat(false);
  }

  const colonnes: ColonneComptoir<ReponseCommandeFournisseur>[] = [
    {
      id: 'date',
      libelle: t('pieces:commandes.dateCommande'),
      rendu: (commande) => (
        <div className="flex flex-col">
          <span className="font-medium">{formaterDate(commande.dateCommande)}</span>
          {commande.reference ? <span className="texte-libelle text-muted-foreground">{commande.reference}</span> : null}
        </div>
      ),
    },
    {
      id: 'site',
      libelle: t('pieces:commandes.site'),
      rendu: (commande) => nomSite(commande.siteId),
    },
    {
      id: 'fournisseur',
      libelle: t('pieces:commandes.fournisseur'),
      rendu: (commande) => (
        <Link
          to={`/pieces/fournisseurs/${commande.fournisseurId}`}
          className="texte-corps font-medium text-primary underline"
          onClick={(e) => e.stopPropagation()}
        >
          {t('pieces:commandes.voirFournisseur')}
        </Link>
      ),
    },
    {
      id: 'origine',
      libelle: t('pieces:commandes.origine'),
      rendu: (commande) => t(`pieces:commandes.origines.${commande.origine}`),
    },
    {
      id: 'statut',
      libelle: t('pieces:commandes.statut'),
      rendu: (commande) => <Badge variant={VARIANTE_BADGE_STATUT[commande.statut]}>{t(`pieces:commandes.statuts.${commande.statut}`)}</Badge>,
    },
  ];

  if (isPending) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pieces:commandes.titre')}</h1>
        <EtatChargement lignes={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pieces:commandes.titre')}</h1>
        <EtatErreur titre={t('pieces:commandes.erreur.titre')} description={messageErreur(error, t)} onReessayer={() => void refetch()} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pieces:commandes.titre')}</h1>
        {peutEcrireCommandeFournisseur(role) ? (
          <Button onClick={() => navigate('/pieces/commandes-fournisseur/nouvelle')}>{t('pieces:commandes.actions.creer')}</Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5 max-w-xs">
          <Label htmlFor="filtre-statut-commande">{t('pieces:commandes.statut')}</Label>
          <Select value={statut ?? 'tous'} onValueChange={(valeur) => setStatut(valeur === 'tous' ? undefined : (valeur as StatutCommandeFournisseur))}>
            <SelectTrigger id="filtre-statut-commande" aria-label={t('pieces:commandes.statut')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">{t('pieces:commandes.filtres.statutTous')}</SelectItem>
              {STATUTS_COMMANDE_FOURNISSEUR.map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {t(`pieces:commandes.statuts.${valeur}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-center gap-2 texte-corps pb-2">
          <Checkbox checked={avecReliquat} onCheckedChange={(coche) => setAvecReliquat(coche === true)} />
          {t('pieces:commandes.filtres.avecReliquat')}
        </label>
      </div>

      <TableComptoir
        colonnes={colonnes}
        lignes={commandes}
        cleLigne={(commande) => commande.id}
        onOuvrirLigne={(commande) => navigate(`/pieces/commandes-fournisseur/${commande.id}`)}
        contenuVide={
          filtresActifs ? (
            <EtatVideFiltre titre={t('pieces:commandes.titre')} description={t('pieces:commandes.vide')} onEffacerFiltres={effacerFiltres} />
          ) : (
            <EtatVidePremierUsage
              titre={t('pieces:commandes.titre')}
              description={t('pieces:commandes.vide')}
              action={
                peutEcrireCommandeFournisseur(role) ? (
                  <Button onClick={() => navigate('/pieces/commandes-fournisseur/nouvelle')}>{t('pieces:commandes.actions.creer')}</Button>
                ) : undefined
              }
            />
          )
        }
      />

      <BoutonChargerPlus aChargerPlus={Boolean(hasNextPage)} enChargement={isFetchingNextPage} onChargerPlus={() => void fetchNextPage()} />
    </div>
  );
}
