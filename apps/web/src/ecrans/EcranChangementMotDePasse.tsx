import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { z } from 'zod';

import { LONGUEUR_MOT_DE_PASSE_MIN } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LimiteErreurEcran } from '@/composants/layout/LimiteErreurEcran';
import { SelecteurLangue } from '@/composants/layout/SelecteurLangue';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useChangerMotDePasse } from '@/hooks/useChangerMotDePasse';
import { useDeconnexion } from '@/hooks/useDeconnexion';
import { useSession } from '@/hooks/useSession';
import { EcranVerificationSession } from '@/ecrans/systeme/EcranVerificationSession';

export const CHEMIN_CHANGEMENT_MOT_DE_PASSE = '/changer-mot-de-passe';

const schemaFormulaire = z
  .object({
    motDePasseActuel: z.string().min(1),
    nouveauMotDePasse: z.string().min(LONGUEUR_MOT_DE_PASSE_MIN).max(256),
    confirmation: z.string(),
  })
  .refine((v) => v.nouveauMotDePasse === v.confirmation, { path: ['confirmation'] });
type Formulaire = z.infer<typeof schemaFormulaire>;

/**
 * Issue #58 : premier écran d'un employé dont la direction a créé l'accès. Tant que le mot de
 * passe temporaire n'est pas remplacé, le serveur refuse tout le reste (403) ; cet écran n'en est
 * que le confort. Une personne sans obligation (ou déconnectée) n'a rien à faire ici.
 */
export function EcranChangementMotDePasse() {
  const { t } = useTranslation(['auth', 'validation', 'erreurs']);
  const { data: session, isPending } = useSession();
  const changement = useChangerMotDePasse();
  const deconnexion = useDeconnexion();
  const form = useForm<Formulaire>({
    resolver: zodResolver(schemaFormulaire),
    defaultValues: { motDePasseActuel: '', nouveauMotDePasse: '', confirmation: '' },
  });

  if (isPending) return <EcranVerificationSession />;
  if (!session) return <Navigate to="/login" replace />;
  if (!session.motDePasseAChanger) return <Navigate to="/" replace />;

  const enCours = changement.isPending;
  const erreurs = form.formState.errors;
  const soumettre = form.handleSubmit((v) => {
    changement.mutate(
      { motDePasseActuel: v.motDePasseActuel, nouveauMotDePasse: v.nouveauMotDePasse },
      { onError: () => form.setValue('motDePasseActuel', '') },
    );
  });

  return (
    <GabaritEcran
      titre={t('auth:changement.titre')}
      titreVisible={false}
      className="min-h-dvh items-center justify-center p-4"
    >
      <div className="w-full max-w-[420px] space-y-4">
        <div className="flex justify-end">
          <SelecteurLangue />
        </div>
        <LimiteErreurEcran>
          <Card>
            <CardHeader>
              <CardTitle>{t('auth:changement.titre')}</CardTitle>
              <CardDescription>
                {t('auth:changement.explication', { prenom: session.utilisateur.prenom })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={soumettre} noValidate className="space-y-4">
                {changement.error ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    <AlertTitle>{t('auth:changement.erreur')}</AlertTitle>
                    <AlertDescription>{messageErreur(changement.error, t)}</AlertDescription>
                  </Alert>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="motDePasseActuel">{t('auth:changement.champs.actuel')}</Label>
                  <Input
                    id="motDePasseActuel"
                    type="password"
                    autoComplete="current-password"
                    readOnly={enCours}
                    aria-invalid={erreurs.motDePasseActuel ? true : undefined}
                    {...form.register('motDePasseActuel')}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nouveauMotDePasse">{t('auth:changement.champs.nouveau')}</Label>
                  <Input
                    id="nouveauMotDePasse"
                    type="password"
                    autoComplete="new-password"
                    readOnly={enCours}
                    aria-invalid={erreurs.nouveauMotDePasse ? true : undefined}
                    aria-describedby="nouveauMotDePasse-aide"
                    {...form.register('nouveauMotDePasse')}
                  />
                  <p
                    id="nouveauMotDePasse-aide"
                    className={
                      erreurs.nouveauMotDePasse
                        ? 'texte-corps text-destructive'
                        : 'texte-corps text-muted-foreground'
                    }
                  >
                    {t('auth:changement.aide', { longueur: LONGUEUR_MOT_DE_PASSE_MIN })}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmation">{t('auth:changement.champs.confirmation')}</Label>
                  <Input
                    id="confirmation"
                    type="password"
                    autoComplete="new-password"
                    readOnly={enCours}
                    aria-invalid={erreurs.confirmation ? true : undefined}
                    aria-describedby={erreurs.confirmation ? 'confirmation-erreur' : undefined}
                    {...form.register('confirmation')}
                  />
                  {erreurs.confirmation ? (
                    <p id="confirmation-erreur" className="texte-corps text-destructive">
                      {t('auth:changement.differents')}
                    </p>
                  ) : null}
                </div>

                <Button type="submit" className="w-full" disabled={enCours}>
                  {enCours ? t('auth:changement.enCours') : t('auth:changement.action')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => deconnexion.mutate()}
                >
                  {t('auth:deconnexion.action')}
                </Button>
              </form>
            </CardContent>
          </Card>
        </LimiteErreurEcran>
      </div>
    </GabaritEcran>
  );
}
