import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { messageErreur } from '@/api/erreurs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { useOrdreReparation } from '@/hooks/atelier/useOrdreReparation';
import { formaterMontant } from '@/lib/formats';

import { EnTeteOrdreReparation } from './EnTeteOrdreReparation';
import { ListeLignesOrdreReparation } from './ListeLignesOrdreReparation';
import { PanneauActionsOr } from './PanneauActionsOr';

/**
 * Fiche d'un ordre de réparation — le cœur du produit : en-tête (véhicule/client/statut), lignes
 * de travail, totaux, et les actions RÉELLEMENT disponibles pour l'appelant courant
 * (`or.actionsDisponibles`, §7.7 — jamais une liste devinée depuis le statut, voir
 * `PanneauActionsOr`). `GET /ordres-reparation/{id}` renvoie le DOCUMENT COMPLET (D-10) : une
 * seule requête bloque l'écran entier, aucune sous-requête secondaire à gérer séparément.
 *
 * `:orId` — convention assumée en l'absence de câblage de `src/routes/` à ce jour (agent dédié),
 * même paramètre que celui déjà utilisé par `EcranFicheClient.tsx`/`EcranFicheVehicule.tsx` pour
 * leurs propres ressources ; à ajuster ici si le nom réel diffère une fois le routage posé.
 */
export function EcranFicheOrdreReparation() {
  const { t } = useTranslation(['or', 'commun']);
  const { orId } = useParams<{ orId: string }>();

  const requete = useOrdreReparation(orId);

  if (requete.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="sr-only">{t('or:titre')}</h1>
        <EtatChargement lignes={8} />
      </div>
    );
  }

  if (requete.isError) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="sr-only">{t('or:titre')}</h1>
        <EtatErreur
          titre={t('or:fiche.erreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      </div>
    );
  }

  const or = requete.data;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">{t('or:titre')}</h1>

      <EnTeteOrdreReparation or={or} />

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('or:actions.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PanneauActionsOr or={or} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('or:lignes.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ListeLignesOrdreReparation lignes={or.lignes} lignesTronquees={or.lignesTronquees} />
        </CardContent>
      </Card>

      {or.totauxParPayeur && or.totauxParPayeur.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="texte-titre-section">{t('or:totaux.titre')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 texte-corps sm:grid-cols-3">
              {or.totauxParPayeur.map((totaux) => (
                <div key={totaux.payeur} className="contents">
                  <dt className="text-muted-foreground">{t(`or:lignes.payeurs.${totaux.payeur}`)}</dt>
                  <dd className="col-span-2 font-medium text-foreground sm:col-span-1">{formaterMontant(totaux.montantTtcCentimes)}</dd>
                </div>
              ))}
              {or.totalValideCentimes !== undefined ? (
                <div className="contents border-t pt-2">
                  <dt className="text-muted-foreground">{t('or:totaux.totalValide')}</dt>
                  <dd className="col-span-2 font-semibold text-foreground sm:col-span-1">{formaterMontant(or.totalValideCentimes)}</dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
