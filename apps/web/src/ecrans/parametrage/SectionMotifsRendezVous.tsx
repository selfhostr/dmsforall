import { Ban, CheckCircle2, Pencil, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import type { ReponseMotifRendezVous } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { useModifierMotifRendezVous } from '@/hooks/parametrage/useMotifsRendezVousGestion';
import { useMotifsRendezVous } from '@/hooks/rendez-vous/useMotifsRendezVous';

import { DialogueMotifRendezVous } from './DialogueMotifRendezVous';

export const ID_SECTION_MOTIFS_RDV = 'motifs-rendez-vous';

interface Props {
  readonly peutEcrire: boolean;
}

function libelleDuree(motif: ReponseMotifRendezVous, t: TFunction) {
  if (motif.dureeDefautMinutes !== null) {
    return t('parametrage:motifsRdv.duree.minutes', { count: motif.dureeDefautMinutes });
  }
  if (motif.heuresAtelierDefautCentiemes !== null) {
    return t('parametrage:motifsRdv.duree.heures', {
      heures: motif.heuresAtelierDefautCentiemes / 100,
    });
  }
  return t('parametrage:motifsRdv.duree.aucune');
}

/**
 * Motifs de rendez-vous du garage (« révision », « expertise MFK »…). Sans motif, aucun
 * rendez-vous ne peut être pris : le garage neuf reçoit des motifs par défaut de l'API, et le
 * patron peut ici en créer, les renommer (FR/DE/IT) et les désactiver — jamais les supprimer, un
 * rendez-vous passé peut s'y référer.
 */
export function SectionMotifsRendezVous({ peutEcrire }: Props) {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const requete = useMotifsRendezVous();
  const basculer = useModifierMotifRendezVous();
  const [dialogue, setDialogue] = useState<{ motif?: ReponseMotifRendezVous } | undefined>(
    undefined,
  );

  const motifs = requete.data ?? [];

  // Lien « #motifs-rendez-vous » (liste de démarrage) : react-router ne fait pas défiler seul.
  const { hash } = useLocation();
  const carte = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hash === `#${ID_SECTION_MOTIFS_RDV}`) carte.current?.scrollIntoView?.({ block: 'start' });
  }, [hash]);

  const colonnes: ColonneComptoir<ReponseMotifRendezVous>[] = [
    {
      id: 'libelle',
      libelle: t('parametrage:motifsRdv.champs.libelleFr'),
      rendu: (m) => (
        <span className={m.actif ? 'font-medium' : 'font-medium text-muted-foreground'}>
          {m.libelleFr}
        </span>
      ),
    },
    {
      id: 'duree',
      libelle: t('parametrage:motifsRdv.colonnes.duree'),
      rendu: (m) => <span className="tabular-nums">{libelleDuree(m, t)}</span>,
    },
    {
      id: 'statut',
      libelle: t('parametrage:motifsRdv.colonnes.statut'),
      rendu: (m) =>
        m.actif ? (
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {t('parametrage:motifsRdv.statut.actif')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Ban className="h-4 w-4" aria-hidden="true" />
            {t('parametrage:motifsRdv.statut.desactive')}
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
            rendu: (m: ReponseMotifRendezVous) => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => setDialogue({ motif: m })}>
                  <Pencil aria-hidden className="h-4 w-4" />
                  {t('commun:actions.modifier')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={basculer.isPending}
                  onClick={() => basculer.mutate({ id: m.id, entree: { actif: !m.actif } })}
                >
                  {m.actif ? (
                    <Ban aria-hidden className="h-4 w-4" />
                  ) : (
                    <RotateCcw aria-hidden className="h-4 w-4" />
                  )}
                  {m.actif
                    ? t('parametrage:motifsRdv.actions.desactiver')
                    : t('parametrage:motifsRdv.actions.reactiver')}
                </Button>
              </div>
            ),
          } satisfies ColonneComptoir<ReponseMotifRendezVous>,
        ]
      : []),
  ];

  const boutonNouveau = peutEcrire ? (
    <Button type="button" onClick={() => setDialogue({})}>
      <Plus aria-hidden className="h-4 w-4" />
      {t('parametrage:motifsRdv.nouveau')}
    </Button>
  ) : undefined;

  return (
    <Card id={ID_SECTION_MOTIFS_RDV} ref={carte}>
      <CardHeader>
        <CardTitle className="texte-titre-section">
          {t('parametrage:motifsRdv.titre')}
          <span aria-hidden="true" className="ml-0.5">
            *
          </span>
          <span className="sr-only"> ({t('parametrage:obligatoire.sr')})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <p className="texte-corps text-muted-foreground">
            {t('parametrage:motifsRdv.auMoinsUn')}
          </p>
          {motifs.length > 0 ? boutonNouveau : null}
        </div>

        {basculer.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{messageErreur(basculer.error, t)}</AlertDescription>
          </Alert>
        ) : null}

        {requete.isError ? (
          <EtatErreur
            titre={t('parametrage:motifsRdv.erreur.titre')}
            description={messageErreur(requete.error, t)}
            onReessayer={() => void requete.refetch()}
          />
        ) : (
          <TableComptoir
            colonnes={colonnes}
            lignes={motifs}
            cleLigne={(m) => m.id}
            enChargement={requete.isLoading}
            contenuVide={
              <EtatVidePremierUsage
                titre={t('parametrage:motifsRdv.vide.titre')}
                description={t('parametrage:motifsRdv.vide.description')}
                action={boutonNouveau}
              />
            }
          />
        )}

        {dialogue ? (
          <DialogueMotifRendezVous
            key={dialogue.motif?.id ?? 'nouveau'}
            ouvert
            onOuvertChange={(ouvert) => {
              if (!ouvert) setDialogue(undefined);
            }}
            motif={dialogue.motif}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
