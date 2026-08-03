import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  STATUTS_FOURNISSEUR,
  TRI_DEFAUT_FOURNISSEURS,
  type FiltresFournisseurs,
  type ReponseFournisseur,
  type StatutFournisseur,
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
import { useListeFournisseurs } from '@/hooks/pieces/useListeFournisseurs';
import { useSession } from '@/hooks/useSession';

import { peutEcrireFournisseur } from './droits';
import { FormulaireFournisseur } from './FormulaireFournisseur';
import { texteOuVide } from './utils';

const VARIANTE_BADGE_STATUT: Record<StatutFournisseur, 'default' | 'secondary'> = {
  actif: 'default',
  inactif: 'secondary',
};

/**
 * Liste des fournisseurs (RP-26, §1) — référentiel minimal (nom, coordonnées, délai habituel).
 * `schemaFiltresFournisseurs` ne porte AUCUN `q` (pas de recherche texte, contrairement à
 * `articles`) : seul un filtre statut est proposé, honnête sur ce que le contrat permet.
 */
export function EcranListeFournisseurs() {
  const { t } = useTranslation(['pieces', 'commun']);
  const navigate = useNavigate();
  const { data: session } = useSession();
  const role = session?.utilisateur.role;

  const [statut, setStatut] = useState<StatutFournisseur | undefined>('actif');
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);

  const filtres: FiltresFournisseurs = {
    statut: statut ? [statut] : undefined,
    tri: TRI_DEFAUT_FOURNISSEURS,
    limite: 50,
  };
  const {
    fournisseurs,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useListeFournisseurs(filtres);

  const colonnes: ColonneComptoir<ReponseFournisseur>[] = [
    {
      id: 'nom',
      libelle: t('pieces:fournisseurs.nom'),
      rendu: (fournisseur) => <span className="font-medium">{fournisseur.nom}</span>,
    },
    {
      id: 'coordonnees',
      libelle: t('pieces:fournisseurs.coordonnees'),
      rendu: (fournisseur) => (
        <div className="flex flex-col texte-libelle text-muted-foreground">
          <span>{texteOuVide(fournisseur.email)}</span>
          <span>{texteOuVide(fournisseur.telephone)}</span>
        </div>
      ),
    },
    {
      id: 'delai',
      libelle: t('pieces:fournisseurs.delaiHabituelJours'),
      alignement: 'droite',
      rendu: (fournisseur) => (
        <span className="tabular-nums">{texteOuVide(fournisseur.delaiHabituelJours)}</span>
      ),
    },
    {
      id: 'statut',
      libelle: t('pieces:fournisseurs.statut'),
      rendu: (fournisseur) => (
        <Badge variant={VARIANTE_BADGE_STATUT[fournisseur.statut]}>
          {t(`pieces:fournisseurs.statuts.${fournisseur.statut}`)}
        </Badge>
      ),
    },
  ];

  if (isPending) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pieces:fournisseurs.titre')}</h1>
        <EtatChargement lignes={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pieces:fournisseurs.titre')}</h1>
        <EtatErreur
          titre={t('pieces:fournisseurs.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pieces:fournisseurs.titre')}</h1>
        {peutEcrireFournisseur(role) ? (
          <Button onClick={() => setFormulaireOuvert(true)}>
            {t('pieces:fournisseurs.actions.ajouter')}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5 max-w-xs">
        <Label htmlFor="filtre-statut-fournisseur">{t('pieces:fournisseurs.statut')}</Label>
        <Select
          value={statut ?? 'tous'}
          onValueChange={(valeur) =>
            setStatut(valeur === 'tous' ? undefined : (valeur as StatutFournisseur))
          }
        >
          <SelectTrigger
            id="filtre-statut-fournisseur"
            aria-label={t('pieces:fournisseurs.statut')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tous">{t('pieces:fournisseurs.filtres.statutTous')}</SelectItem>
            {STATUTS_FOURNISSEUR.map((valeur) => (
              <SelectItem key={valeur} value={valeur}>
                {t(`pieces:fournisseurs.statuts.${valeur}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <TableComptoir
        colonnes={colonnes}
        lignes={fournisseurs}
        cleLigne={(fournisseur) => fournisseur.id}
        onOuvrirLigne={(fournisseur) => navigate(`/pieces/fournisseurs/${fournisseur.id}`)}
        contenuVide={
          statut ? (
            <EtatVideFiltre
              titre={t('pieces:fournisseurs.titre')}
              description={t('pieces:fournisseurs.vide')}
              onEffacerFiltres={() => setStatut(undefined)}
            />
          ) : (
            <EtatVidePremierUsage
              titre={t('pieces:fournisseurs.titre')}
              description={t('pieces:fournisseurs.vide')}
              action={
                peutEcrireFournisseur(role) ? (
                  <Button onClick={() => setFormulaireOuvert(true)}>
                    {t('pieces:fournisseurs.actions.ajouter')}
                  </Button>
                ) : undefined
              }
            />
          )
        }
      />

      <BoutonChargerPlus
        aChargerPlus={Boolean(hasNextPage)}
        enChargement={isFetchingNextPage}
        onChargerPlus={() => void fetchNextPage()}
      />

      <FormulaireFournisseur
        ouvert={formulaireOuvert}
        onOuvertChange={setFormulaireOuvert}
        onCree={(fournisseur) => navigate(`/pieces/fournisseurs/${fournisseur.id}`)}
      />
    </div>
  );
}
