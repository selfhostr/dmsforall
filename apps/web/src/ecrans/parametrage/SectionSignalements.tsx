import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MODES_SIGNALEMENT, type ModeSignalement } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { useModifierParametresEntreprise } from '@/hooks/parametrage/useModifierParametresEntreprise';
import { useParametresEntreprise } from '@/hooks/parametrage/useParametresEntreprise';

/**
 * Réglage « Signalements » du garage : ce que fait le bouton « Signaler un problème » du menu du
 * profil. Enregistré dès qu'un choix est fait (un seul réglage, pas de formulaire à valider).
 * Même droit que le reste de « Mon garage » (`GET|PATCH /parametres-entreprise`).
 */
export function SectionSignalements() {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const requete = useParametresEntreprise();
  const modifier = useModifierParametresEntreprise();

  if (requete.isPending) return <EtatChargement lignes={2} />;
  if (requete.isError) {
    return (
      <EtatErreur
        titre={t('parametrage:signalements.erreur.titre')}
        description={messageErreur(requete.error, t)}
        onReessayer={() => void requete.refetch()}
      />
    );
  }

  const actuel: ModeSignalement = requete.data.modeSignalement;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">{t('parametrage:signalements.titre')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <fieldset className="space-y-1" aria-describedby="sig-reglage-aide">
          <legend className="sr-only">{t('parametrage:signalements.titre')}</legend>
          {MODES_SIGNALEMENT.map((mode) => (
            <label key={mode} className="flex min-h-11 items-center gap-2 texte-corps">
              <input
                type="radio"
                name="sig-mode"
                className="h-4 w-4"
                checked={actuel === mode}
                disabled={modifier.isPending}
                onChange={() => modifier.mutate({ modeSignalement: mode })}
              />
              {t(`parametrage:signalements.modes.${mode}`)}
            </label>
          ))}
        </fieldset>
        <p id="sig-reglage-aide" className="texte-corps text-muted-foreground">
          {t(`parametrage:signalements.aide.${actuel}`)}
        </p>
        {modifier.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{messageErreur(modifier.error, t)}</AlertDescription>
          </Alert>
        ) : null}
        {modifier.isSuccess && !modifier.isPending ? (
          <p className="flex items-center gap-1.5 texte-corps text-foreground" role="status">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {t('parametrage:signalements.enregistre')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
