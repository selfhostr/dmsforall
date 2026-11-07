import type { ActionsSession } from '@/droits';
import { Pencil, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponsePrestation, RoleUtilisateur } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { useListePrestations } from '@/hooks/parametrage/useListePrestations';
import { useListeTauxHoraires } from '@/hooks/parametrage/useListeTauxHoraires';
import { formaterMontant } from '@/lib/formats';
import { useLangue } from '@/hooks/useLangue';

import { DialoguePrestation } from './DialoguePrestation';
import { peutModifierParametrage } from './droits';

interface Props {
  readonly actions: ActionsSession;
}

export function OngletPrestations({ actions }: Props) {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const { langue } = useLangue();
  const requete = useListePrestations();
  // Réutilise le cache de `useListeTauxHoraires` (même clé TanStack Query que dans l'onglet
  // Taux horaires) : pas de second aller-réseau si l'onglet a déjà été visité, et le select
  // `tauxHoraireCode` du dialogue reste à jour sans prop drilling entre les deux onglets.
  const requeteTauxHoraires = useListeTauxHoraires();
  const codesTauxHoraires = useMemo(
    () =>
      requeteTauxHoraires.data?.pages.flatMap((page) => page.donnees.map((th) => th.code)) ?? [],
    [requeteTauxHoraires.data],
  );
  const peutEcrire = peutModifierParametrage(actions);

  const [dialogueOuvert, setDialogueOuvert] = useState(false);
  const [prestationEnEdition, setPrestationEnEdition] = useState<ReponsePrestation | undefined>(
    undefined,
  );

  const lignes = useMemo(
    () => requete.data?.pages.flatMap((page) => page.donnees) ?? [],
    [requete.data],
  );

  const ouvrirCreation = () => {
    setPrestationEnEdition(undefined);
    setDialogueOuvert(true);
  };
  const ouvrirEdition = (prestation: ReponsePrestation) => {
    setPrestationEnEdition(prestation);
    setDialogueOuvert(true);
  };

  const colonnes: ColonneComptoir<ReponsePrestation>[] = [
    {
      id: 'code',
      libelle: t('parametrage:referentiels.prestations.champs.code'),
      rendu: (p) => <span className="font-medium">{p.code}</span>,
    },
    {
      id: 'designation',
      libelle: t('parametrage:referentiels.prestations.champs.designation'),
      rendu: (p) => p.designation[langue] || p.designation.fr,
    },
    {
      id: 'typeLigne',
      libelle: t('parametrage:referentiels.prestations.champs.typeLigne'),
      rendu: (p) => (
        <span className="text-muted-foreground">
          {t(`parametrage:referentiels.prestations.typesLigne.${p.typeLigne}`)}
        </span>
      ),
    },
    {
      id: 'prix',
      libelle: t('parametrage:referentiels.prestations.champs.prix'),
      alignement: 'droite',
      rendu: (p) => (
        <span className="tabular-nums">
          {p.prixCentimes !== null ? formaterMontant(p.prixCentimes) : '—'}
        </span>
      ),
    },
    {
      id: 'actif',
      libelle: t('parametrage:referentiels.prestations.champs.actif'),
      rendu: (p) =>
        p.actif ? (
          <Badge variant="secondary">{t('parametrage:referentiels.prestations.statutActif')}</Badge>
        ) : (
          <Badge variant="outline">{t('parametrage:referentiels.prestations.statutInactif')}</Badge>
        ),
    },
    ...(peutEcrire
      ? [
          {
            id: 'actions',
            libelle: '',
            actions: true,
            alignement: 'droite',
            rendu: (p: ReponsePrestation) => (
              <Button variant="ghost" size="sm" onClick={() => ouvrirEdition(p)}>
                <Pencil aria-hidden className="h-4 w-4" />
                {t('commun:actions.modifier')}
              </Button>
            ),
          } satisfies ColonneComptoir<ReponsePrestation>,
        ]
      : []),
  ];

  const contenuVide = (
    <EtatVidePremierUsage
      titre={t('parametrage:referentiels.prestations.vide.titre')}
      description={t('parametrage:referentiels.prestations.vide.description')}
      action={
        peutEcrire ? (
          <Button type="button" onClick={ouvrirCreation}>
            <Plus aria-hidden className="h-4 w-4" />
            {t('parametrage:referentiels.prestations.nouvelle')}
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="texte-corps text-muted-foreground">
          {t('parametrage:referentiels.prestations.explication')}
        </p>
        {peutEcrire ? (
          <Button type="button" onClick={ouvrirCreation}>
            <Plus aria-hidden className="h-4 w-4" />
            {t('parametrage:referentiels.prestations.nouvelle')}
          </Button>
        ) : null}
      </div>

      {requete.isError ? (
        <EtatErreur
          titre={t('erreurs:inattendue.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      ) : (
        <>
          <TableComptoir
            colonnes={colonnes}
            lignes={lignes}
            cleLigne={(prestation) => prestation.id}
            onOuvrirLigne={peutEcrire ? ouvrirEdition : undefined}
            libelleLigne={(prestation) =>
              t('commun:actions.ouvrirElement', {
                nom: prestation.designation[langue] || prestation.designation.fr,
              })
            }
            enChargement={requete.isLoading}
            contenuVide={contenuVide}
          />
          <BoutonChargerPlus
            aChargerPlus={requete.hasNextPage ?? false}
            enChargement={requete.isFetchingNextPage}
            onChargerPlus={() => void requete.fetchNextPage()}
          />
        </>
      )}

      <DialoguePrestation
        ouvert={dialogueOuvert}
        onOuvertChange={setDialogueOuvert}
        prestation={prestationEnEdition}
        codesTauxHoraires={codesTauxHoraires}
      />
    </div>
  );
}
