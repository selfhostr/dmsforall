import { useTranslation } from 'react-i18next';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useModifierModules } from '@/hooks/parametrage/useModifierModules';
import { usePeut } from '@/droits';
import { useModules } from '@/hooks/parametrage/useModules';

import { ListeModules } from './ListeModules';

/**
 * Réglages > Modules : le garage retire ce qu'il n'utilise pas (`GET|PATCH
 * /parametres-entreprise/modules`). Chaque interrupteur enregistre aussitôt ; menus, onglets,
 * raccourcis et cartes de l'accueil suivent sans recharger. Rien n'est supprimé : réactiver
 * restaure tout. Le socle (accueil, clients et véhicules, facturation, réglages) n'est pas listé.
 */
export function EcranModules() {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const requete = useModules();
  const modifier = useModifierModules();
  const peutModifier = usePeut('parametrage.modules.modifier');

  return (
    <GabaritEcran titre={t('parametrage:modules.titre')}>
      {requete.isPending ? <EtatChargement lignes={6} /> : null}
      {requete.isError ? (
        <EtatErreur
          titre={t('parametrage:modules.erreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      ) : null}
      {requete.isSuccess ? (
        <Card>
          <CardHeader>
            <CardTitle className="texte-titre-section">
              {t('parametrage:modules.carte.titre')}
            </CardTitle>
            <p className="texte-corps text-muted-foreground">
              {t('parametrage:modules.carte.description')}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <ListeModules
              desactives={requete.data.modulesDesactives}
              desactiveTout={modifier.isPending}
              lectureSeule={!peutModifier}
              onChange={(modulesDesactives) =>
                modifier.mutate({ modulesDesactives: [...modulesDesactives] })
              }
            />
            {peutModifier ? null : (
              <p className="texte-corps text-foreground">{t('parametrage:modules.lectureSeule')}</p>
            )}
            <p className="texte-corps text-muted-foreground">{t('parametrage:modules.socle')}</p>
            {modifier.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{messageErreur(modifier.error, t)}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </GabaritEcran>
  );
}
