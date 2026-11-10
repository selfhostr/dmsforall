import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ServerCrash, WifiOff } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';

import { LONGUEUR_MOT_DE_PASSE_MIN, schemaPremierGarage } from '@dfa/shared';

import { ErreurApi, ErreurReseau, messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LimiteErreurEcran } from '@/composants/layout/LimiteErreurEcran';
import { SelecteurLangue } from '@/composants/layout/SelecteurLangue';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useCreerPremierGarage } from '@/hooks/useCreerPremierGarage';

const schemaFormulaire = schemaPremierGarage
  .extend({ confirmation: z.string() })
  .refine((v) => v.motDePasse === v.confirmation, { path: ['confirmation'] });
type Formulaire = z.input<typeof schemaFormulaire>;

type ChampServeur = 'garage' | 'email' | 'motDePasse' | 'codeInstallation';

/** Refus de saisie renvoyés par le serveur, rattachés à leur champ (codes de `creerGarage`). */
function champEnErreurServeur(erreur: unknown, champ: ChampServeur): boolean {
  if (!(erreur instanceof ErreurApi)) return false;
  if (champ === 'codeInstallation') return erreur.probleme.code === 'INSTALLATION_CODE_INVALIDE';
  return erreur.champErreur(champ) !== undefined;
}

/**
 * Premier écran d'une instance neuve : création du garage et de son premier compte (direction).
 * Le code d'installation, affiché dans les journaux de l'API au démarrage, prouve que la personne
 * a la main sur le serveur : sans lui, quiconque ouvrirait l'adresse en premier prendrait la place.
 * Après succès, la session est ouverte et l'assistant de démarrage s'ouvre sur le tableau de bord.
 */
export function EcranPremierGarage() {
  const { t } = useTranslation(['auth', 'validation', 'erreurs']);
  const creation = useCreerPremierGarage();

  const form = useForm<Formulaire>({
    resolver: zodResolver(schemaFormulaire),
    defaultValues: {
      garage: '',
      prenom: '',
      nom: '',
      email: '',
      motDePasse: '',
      confirmation: '',
      codeInstallation: '',
    },
  });

  const soumettre = form.handleSubmit(({ confirmation: _confirmation, ...entree }) => {
    creation.mutate(entree, {
      onError: () => {
        form.setValue('motDePasse', '');
        form.setValue('confirmation', '');
      },
    });
  });

  const enCours = creation.isPending;
  const erreur = creation.error;
  const erreurs = form.formState.errors;
  const dejaFaite =
    erreur instanceof ErreurApi && erreur.probleme.code === 'INSTALLATION_DEJA_FAITE';
  const serveur = erreur instanceof ErreurApi && erreur.probleme.status >= 500;
  const reseau = erreur instanceof ErreurReseau;

  const codeRefuse = champEnErreurServeur(erreur, 'codeInstallation');
  const garageRefuse = champEnErreurServeur(erreur, 'garage');
  const emailRefuse = champEnErreurServeur(erreur, 'email');
  const motDePasseRefuse = champEnErreurServeur(erreur, 'motDePasse');

  const messageGarage = erreurs.garage
    ? t('auth:installation.champs.garage.erreur')
    : garageRefuse
      ? t('auth:installation.erreurs.garageInvalide')
      : null;
  const messageEmail = erreurs.email
    ? t('validation:email.invalide')
    : emailRefuse
      ? t('validation:email.invalide')
      : null;
  const messageMotDePasse = erreurs.motDePasse
    ? t('auth:installation.champs.motDePasse.aide', { longueur: LONGUEUR_MOT_DE_PASSE_MIN })
    : motDePasseRefuse
      ? t('auth:installation.erreurs.motDePasseFaible')
      : null;
  const messageCode = erreurs.codeInstallation
    ? t('validation:requis')
    : codeRefuse
      ? t('erreurs:codes.INSTALLATION_CODE_INVALIDE')
      : null;

  return (
    <GabaritEcran
      titre={t('auth:installation.titre')}
      titreVisible={false}
      className="min-h-dvh items-center justify-center p-4"
    >
      <div className="w-full max-w-[480px] space-y-4">
        <div className="flex justify-end">
          <SelecteurLangue />
        </div>

        <LimiteErreurEcran>
          <Card>
            <CardHeader>
              <CardTitle>{t('auth:installation.carte.titre')}</CardTitle>
              <CardDescription>{t('auth:installation.sousTitre')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={soumettre} noValidate className="space-y-4">
                {erreur ? (
                  <Alert variant={reseau ? 'avertissement' : 'destructive'}>
                    {reseau ? (
                      <WifiOff className="h-4 w-4" aria-hidden="true" />
                    ) : serveur ? (
                      <ServerCrash className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    )}
                    <AlertTitle>
                      {reseau
                        ? t('erreurs:reseau.titre')
                        : serveur
                          ? t('erreurs:serveur.titre')
                          : t('auth:installation.erreurs.titre')}
                    </AlertTitle>
                    <AlertDescription>
                      {messageErreur(erreur, t)}
                      {dejaFaite ? (
                        <>
                          {' '}
                          <Link to="/login" replace className="underline">
                            {t('auth:installation.erreurs.versConnexion')}
                          </Link>
                        </>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="garage">{t('auth:installation.champs.garage.libelle')}</Label>
                  <Input
                    id="garage"
                    autoComplete="organization"
                    placeholder={t('auth:installation.champs.garage.exemple')}
                    readOnly={enCours}
                    aria-invalid={messageGarage ? true : undefined}
                    aria-describedby={messageGarage ? 'garage-erreur' : undefined}
                    {...form.register('garage')}
                  />
                  {messageGarage ? (
                    <p id="garage-erreur" className="texte-corps text-destructive">
                      {messageGarage}
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="prenom">{t('auth:installation.champs.prenom')}</Label>
                    <Input
                      id="prenom"
                      autoComplete="given-name"
                      readOnly={enCours}
                      aria-invalid={erreurs.prenom ? true : undefined}
                      aria-describedby={erreurs.prenom ? 'prenom-erreur' : undefined}
                      {...form.register('prenom')}
                    />
                    {erreurs.prenom ? (
                      <p id="prenom-erreur" className="texte-corps text-destructive">
                        {t('validation:requis')}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="nom">{t('auth:installation.champs.nom')}</Label>
                    <Input
                      id="nom"
                      autoComplete="family-name"
                      readOnly={enCours}
                      aria-invalid={erreurs.nom ? true : undefined}
                      aria-describedby={erreurs.nom ? 'nom-erreur' : undefined}
                      {...form.register('nom')}
                    />
                    {erreurs.nom ? (
                      <p id="nom-erreur" className="texte-corps text-destructive">
                        {t('validation:requis')}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">{t('auth:installation.champs.email.libelle')}</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    spellCheck={false}
                    placeholder={t('auth:installation.champs.email.exemple')}
                    readOnly={enCours}
                    aria-invalid={messageEmail ? true : undefined}
                    aria-describedby={messageEmail ? 'email-erreur' : undefined}
                    {...form.register('email')}
                  />
                  {messageEmail ? (
                    <p id="email-erreur" className="texte-corps text-destructive">
                      {messageEmail}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="motDePasse">
                    {t('auth:installation.champs.motDePasse.libelle')}
                  </Label>
                  <Input
                    id="motDePasse"
                    type="password"
                    autoComplete="new-password"
                    readOnly={enCours}
                    aria-invalid={messageMotDePasse ? true : undefined}
                    aria-describedby="motDePasse-aide"
                    {...form.register('motDePasse')}
                  />
                  <p
                    id="motDePasse-aide"
                    className={
                      messageMotDePasse
                        ? 'texte-corps text-destructive'
                        : 'texte-corps text-muted-foreground'
                    }
                  >
                    {messageMotDePasse ??
                      t('auth:installation.champs.motDePasse.aide', {
                        longueur: LONGUEUR_MOT_DE_PASSE_MIN,
                      })}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmation">{t('auth:installation.champs.confirmation')}</Label>
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
                      {t('auth:installation.differents')}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="codeInstallation">
                    {t('auth:installation.champs.code.libelle')}
                  </Label>
                  <Input
                    id="codeInstallation"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="XXXX-XXXX-XXXX"
                    readOnly={enCours}
                    aria-invalid={messageCode ? true : undefined}
                    aria-describedby={
                      messageCode
                        ? 'codeInstallation-aide codeInstallation-erreur'
                        : 'codeInstallation-aide'
                    }
                    {...form.register('codeInstallation')}
                  />
                  <p id="codeInstallation-aide" className="texte-corps text-muted-foreground">
                    {t('auth:installation.champs.code.aide')}{' '}
                    <code className="font-mono">docker compose logs api</code>
                  </p>
                  {messageCode ? (
                    <p id="codeInstallation-erreur" className="texte-corps text-destructive">
                      {messageCode}
                    </p>
                  ) : null}
                </div>

                <Button type="submit" className="w-full" disabled={enCours}>
                  {enCours ? t('auth:installation.enCours') : t('auth:installation.action')}
                </Button>
              </form>
            </CardContent>
          </Card>
        </LimiteErreurEcran>
      </div>
    </GabaritEcran>
  );
}
