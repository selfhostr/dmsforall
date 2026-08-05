import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';

import type { ReponseFinancierTableauBord } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { formaterMontant } from '@/lib/formats';

interface Props {
  readonly resultat: UseQueryResult<ReponseFinancierTableauBord>;
}

function Indicateur({ valeur, libelle }: { readonly valeur: string; readonly libelle: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="tabular-nums text-3xl font-semibold leading-none">{valeur}</span>
      <span className="text-sm text-muted-foreground">{libelle}</span>
    </div>
  );
}

/**
 * Bloc « Financier » — RÉSERVÉ `direction`/`comptable` (RF-115, `admin` EXCLU). Le composant
 * appelant (`EcranTableauBord.tsx`) ne monte CE composant que pour un rôle autorisé
 * (`peutVoirFinancierTableauBord(role) ? <BlocFinancierTableauBord/> : null`) — jamais rendu vide,
 * grisé ou en erreur pour un rôle non autorisé, il est simplement ABSENT du DOM. Ce n'est PAS un
 * bug à corriger : RF-115 est une séparation des pouvoirs délibérée.
 *
 * Aucune notion de marge ici (absente du contrat, `ReponseFinancierTableauBord`) — rien n'est
 * inventé au-delà de ce que l'API expose.
 */
export function BlocFinancierTableauBord({ resultat }: Props) {
  const { t } = useTranslation(['tableauBord', 'commun']);
  const { data, isPending, isError, error, refetch } = resultat;

  if (isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('tableauBord:financier.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          <EtatChargement lignes={3} />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('tableauBord:financier.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          <EtatErreur
            titre={t('tableauBord:financier.erreur.titre')}
            description={messageErreur(error, t)}
            onReessayer={() => void refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('tableauBord:financier.titre')}</h2>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <Indicateur
              valeur={formaterMontant(data.chiffreAffaires.totalTtcCentimes)}
              libelle={t('tableauBord:financier.chiffreAffaires.libelle')}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {t('tableauBord:financier.chiffreAffaires.detail', {
                ht: formaterMontant(data.chiffreAffaires.totalHtCentimes),
                tva: formaterMontant(data.chiffreAffaires.totalTvaCentimes),
                nombreDocuments: data.chiffreAffaires.nombreDocuments,
              })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <Indicateur
              valeur={formaterMontant(data.encaissementsCentimes)}
              libelle={t('tableauBord:financier.encaissements.libelle')}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <Indicateur
              valeur={formaterMontant(data.encoursClientsCentimes)}
              libelle={t('tableauBord:financier.encoursClients.libelle')}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
