import type { ActionsSession } from '@/droits';
import { Pencil, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponseTauxHoraire, RoleUtilisateur } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { useListeTauxHoraires } from '@/hooks/parametrage/useListeTauxHoraires';
import { formaterDate, formaterMontant } from '@/lib/formats';

import { DialogueTauxHoraire } from './DialogueTauxHoraire';
import { peutModifierParametrage } from './droits';

interface Props {
  readonly actions: ActionsSession;
}

export function OngletTauxHoraires({ actions }: Props) {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const requete = useListeTauxHoraires();
  const peutEcrire = peutModifierParametrage(actions);

  const [dialogueOuvert, setDialogueOuvert] = useState(false);
  const [tauxEnEdition, setTauxEnEdition] = useState<ReponseTauxHoraire | undefined>(undefined);

  const lignes = useMemo(
    () => requete.data?.pages.flatMap((page) => page.donnees) ?? [],
    [requete.data],
  );

  const ouvrirCreation = () => {
    setTauxEnEdition(undefined);
    setDialogueOuvert(true);
  };
  const ouvrirEdition = (tauxHoraire: ReponseTauxHoraire) => {
    setTauxEnEdition(tauxHoraire);
    setDialogueOuvert(true);
  };

  const colonnes: ColonneComptoir<ReponseTauxHoraire>[] = [
    {
      id: 'code',
      libelle: t('parametrage:referentiels.tauxHoraires.champs.code'),
      rendu: (t2) => <span className="font-medium">{t2.code}</span>,
    },
    {
      id: 'libelle',
      libelle: t('parametrage:referentiels.tauxHoraires.champs.libelle'),
      rendu: (t2) => t2.libelle,
    },
    {
      id: 'montant',
      libelle: t('parametrage:referentiels.tauxHoraires.champs.montant'),
      alignement: 'droite',
      rendu: (t2) => <span className="tabular-nums">{formaterMontant(t2.montantCentimes)}</span>,
    },
    {
      id: 'valideDuLe',
      libelle: t('parametrage:referentiels.tauxHoraires.champs.valideDuLe'),
      rendu: (t2) => (
        <span className="tabular-nums text-muted-foreground">{formaterDate(t2.valideDuLe)}</span>
      ),
    },
    {
      id: 'valideAuLe',
      libelle: t('parametrage:referentiels.tauxHoraires.champs.valideAuLe'),
      rendu: (t2) => (
        <span className="tabular-nums text-muted-foreground">
          {t2.valideAuLe ? formaterDate(t2.valideAuLe) : t('parametrage:referentiels.enCours')}
        </span>
      ),
    },
    ...(peutEcrire
      ? [
          {
            id: 'actions',
            libelle: '',
            actions: true,
            alignement: 'droite',
            rendu: (t2: ReponseTauxHoraire) => (
              <Button variant="ghost" size="sm" onClick={() => ouvrirEdition(t2)}>
                <Pencil aria-hidden className="h-4 w-4" />
                {t('commun:actions.modifier')}
              </Button>
            ),
          } satisfies ColonneComptoir<ReponseTauxHoraire>,
        ]
      : []),
  ];

  const contenuVide = (
    <EtatVidePremierUsage
      titre={t('parametrage:referentiels.tauxHoraires.vide.titre')}
      description={t('parametrage:referentiels.tauxHoraires.vide.description')}
      action={
        peutEcrire ? (
          <Button type="button" onClick={ouvrirCreation}>
            <Plus aria-hidden className="h-4 w-4" />
            {t('parametrage:referentiels.tauxHoraires.nouveau')}
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="texte-corps text-muted-foreground">
          {t('parametrage:referentiels.tauxHoraires.explication')}
        </p>
        {peutEcrire ? (
          <Button type="button" onClick={ouvrirCreation}>
            <Plus aria-hidden className="h-4 w-4" />
            {t('parametrage:referentiels.tauxHoraires.nouveau')}
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
            cleLigne={(tauxHoraire) => tauxHoraire.id}
            onOuvrirLigne={peutEcrire ? ouvrirEdition : undefined}
            libelleLigne={(tauxHoraire) =>
              t('commun:actions.ouvrirElement', { nom: tauxHoraire.libelle })
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

      <DialogueTauxHoraire
        ouvert={dialogueOuvert}
        onOuvertChange={setDialogueOuvert}
        tauxHoraire={tauxEnEdition}
      />
    </div>
  );
}
