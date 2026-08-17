import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Eye, EyeOff, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { schemaConnexion, type EntreeConnexion } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelecteurLangue } from '@/composants/layout/SelecteurLangue';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useConnexion } from '@/hooks/useConnexion';

/** Points de contrat non négociables (voir contrats-etape-0.md §5) :
 *  - sélecteur de langue accessible AVANT connexion (rendu au-dessus de la carte, dans le
 *    flux/tab order avant les champs) ;
 *  - champs `readOnly` (pas `disabled`) pendant l'envoi : ils restent focusables/lisibles et
 *    participent toujours à la soumission, contrairement à `disabled` ;
 *  - e-mail conservé après un échec, mot de passe effacé (hygiène + le message ne révèle
 *    jamais lequel des deux champs est en cause) ;
 *  - alerte réseau visuellement distincte de l'alerte identifiants (icône + variante) ;
 *  - `autocomplete` username/current-password ; soumission native à Entrée via <form>. */
export function EcranConnexion() {
  const { t } = useTranslation(['auth', 'commun', 'validation', 'erreurs']);
  const [motDePasseVisible, setMotDePasseVisible] = useState(false);
  const connexion = useConnexion();

  const form = useForm<EntreeConnexion>({
    resolver: zodResolver(schemaConnexion),
    defaultValues: { email: '', motDePasse: '' },
  });

  const soumettre = form.handleSubmit((valeurs) => {
    connexion.mutate(valeurs, {
      onError: () => {
        form.setValue('motDePasse', '');
        form.setFocus('motDePasse');
      },
    });
  });

  const enCours = connexion.isPending;
  const erreur = connexion.error;
  const estErreurReseau = erreur instanceof ErreurReseau;

  return (
    // Hors de la coquille `AppShell` (route `/login`, `RoutePublique` — pas de barre latérale ni
    // d'onglets) : la détection automatique du gabarit ne trouve aucun libellé de navigation à
    // comparer et rendrait donc le h1 VISIBLE par défaut (règle §3 du contrat GabaritEcran) — ce
    // qui DOUBLERAIT ici le titre affiché par `CardTitle` juste en dessous (« Connexion » deux
    // fois à l'écran). Cas réel, mesuré : `titreVisible={false}` forcé pour garder le h1 dans le
    // DOM (lecteur d'écran) sans le montrer, `CardTitle` restant le seul titre VISIBLE de l'écran.
    <GabaritEcran
      titre={t('auth:connexion.titre')}
      titreVisible={false}
      className="min-h-dvh items-center justify-center bg-muted/30 p-4"
    >
      <div className="w-full max-w-[420px] space-y-4">
        <div className="flex justify-end">
          <SelecteurLangue />
        </div>

        <Card>
          <CardHeader>
            <div className="texte-titre-section leading-none">{t('auth:connexion.titre')}</div>
            <CardDescription>{t('auth:connexion.sousTitre')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={soumettre} noValidate className="space-y-4">
              {erreur ? (
                <Alert variant={estErreurReseau ? 'avertissement' : 'destructive'}>
                  {estErreurReseau ? (
                    <WifiOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                  )}
                  <AlertTitle>
                    {estErreurReseau ? t('erreurs:reseau.titre') : t('erreurs:inattendue.titre')}
                  </AlertTitle>
                  <AlertDescription>{messageErreur(erreur, t)}</AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="email">{t('auth:connexion.champs.email.libelle')}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder={t('auth:connexion.champs.email.exemple')}
                  readOnly={enCours}
                  aria-invalid={form.formState.errors.email ? true : undefined}
                  aria-describedby={form.formState.errors.email ? 'email-erreur' : undefined}
                  {...form.register('email')}
                />
                {form.formState.errors.email ? (
                  <p id="email-erreur" className="text-sm text-destructive">
                    {t('validation:email.invalide')}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="motDePasse">{t('auth:connexion.champs.motDePasse.libelle')}</Label>
                <div className="relative">
                  <Input
                    id="motDePasse"
                    type={motDePasseVisible ? 'text' : 'password'}
                    autoComplete="current-password"
                    readOnly={enCours}
                    className="pr-11"
                    aria-invalid={form.formState.errors.motDePasse ? true : undefined}
                    aria-describedby={
                      form.formState.errors.motDePasse ? 'motDePasse-erreur' : undefined
                    }
                    {...form.register('motDePasse')}
                  />
                  <button
                    type="button"
                    onClick={() => setMotDePasseVisible((valeur) => !valeur)}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground"
                    aria-label={
                      motDePasseVisible
                        ? t('auth:connexion.champs.motDePasse.masquer')
                        : t('auth:connexion.champs.motDePasse.afficher')
                    }
                  >
                    {motDePasseVisible ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
                {form.formState.errors.motDePasse ? (
                  <p id="motDePasse-erreur" className="text-sm text-destructive">
                    {t('validation:requis')}
                  </p>
                ) : null}
              </div>

              <Button type="submit" className="w-full" disabled={enCours}>
                {enCours
                  ? t('auth:connexion.actions.enCours')
                  : t('auth:connexion.actions.seConnecter')}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                {t('auth:connexion.aide.motDePasseOublie')}
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </GabaritEcran>
  );
}
