import { zodResolver } from '@hookform/resolvers/zod';
import type { TFunction } from 'i18next';
import { AlertCircle, Eye, EyeOff, ServerCrash, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { schemaConnexion, type EntreeConnexion } from '@dfa/shared';

import { ErreurApi, ErreurReseau, messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// Réutilisé tel quel (pas de copie) : limite d'erreur de rendu générique, déjà éprouvée par
// `AppShell` pour chaque écran métier — voir sa doc de tête pour le mécanisme complet. `/login`
// vit HORS de `AppShell` (route publique, pas de chrome applicatif), donc hors de portée de
// cette limite-là : sans en reposer une ICI, un crash de rendu dans la carte de connexion ne
// serait rattrapé que par `App.tsx::LimiteErreur`, à la racine — qui remplace TOUTE la page par
// `EcranErreurFatale` (pas de sélecteur de langue, pas de carte, juste « rechargez »). Scoper la
// limite à la carte évite cette étape la plus fragile de l'app (identifiants + réseau capricieux
// d'atelier au démarrage) de dégénérer en rechargement complet pour un crash qui n'affecte que ce
// composant.
import { LimiteErreurEcran } from '@/composants/layout/LimiteErreurEcran';
import { SelecteurLangue } from '@/composants/layout/SelecteurLangue';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useConnexion } from '@/hooks/useConnexion';

/** Trois causes possibles à un échec de connexion, dont la conduite à tenir diffère
 *  radicalement (§2 du contrat) — jamais mélangées dans un message unique :
 *  - `identifiants` : le serveur a répondu et REFUSE (mauvais mot de passe, compte suspendu,
 *    verrouillé, trop de tentatives…) — l'utilisateur doit corriger sa saisie ou attendre/contacter
 *    le responsable, mais l'application, elle, fonctionne.
 *  - `serveur` : le serveur a répondu mais a planté (5xx, `ERREUR_INTERNE` synthétisé sur un corps
 *    illisible) — ce n'est JAMAIS la faute de la saisie, réessayer plus tard est la seule action
 *    sensée.
 *  - `reseau` : le serveur n'a jamais répondu (coupure, DNS, timeout) — ni la saisie ni le service
 *    ne sont en cause, c'est le réseau du poste/de l'atelier. */
type CategorieErreurConnexion = 'identifiants' | 'serveur' | 'reseau';

function categoriserErreurConnexion(erreur: unknown): CategorieErreurConnexion {
  if (erreur instanceof ErreurReseau) return 'reseau';
  if (erreur instanceof ErreurApi) {
    if (erreur.probleme.status >= 500 || erreur.probleme.code === 'ERREUR_INTERNE') {
      return 'serveur';
    }
  }
  return 'identifiants';
}

function titreErreurConnexion(categorie: CategorieErreurConnexion, t: TFunction): string {
  switch (categorie) {
    case 'reseau':
      return t('erreurs:reseau.titre');
    case 'serveur':
      return t('erreurs:serveur.titre');
    case 'identifiants':
      return t('auth:connexion.erreurs.identifiantsRefuses.titre');
  }
}

/** Points de contrat non négociables (voir contrats-etape-0.md §5) :
 *  - sélecteur de langue accessible AVANT connexion (rendu au-dessus de la carte, dans le
 *    flux/tab order avant les champs) ;
 *  - champs `readOnly` (pas `disabled`) pendant l'envoi : ils restent focusables/lisibles et
 *    participent toujours à la soumission, contrairement à `disabled` ;
 *  - e-mail conservé après un échec, mot de passe effacé (hygiène + le message ne révèle
 *    jamais lequel des deux champs est en cause) ;
 *  - trois catégories d'échec visuellement et textuellement distinctes — identifiants refusés,
 *    service indisponible, réseau injoignable (icône + titre + variante, voir
 *    `categoriserErreurConnexion` ci-dessus) — jamais fondues dans un message flou unique ;
 *  - un crash de rendu dans la carte n'efface jamais l'écran : `LimiteErreurEcran` le confine
 *    (message + « Réessayer »), le sélecteur de langue au-dessus reste utilisable ;
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
  const categorieErreur = erreur ? categoriserErreurConnexion(erreur) : undefined;

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
      // DESIGN.md « Bordure structurelle uniquement » — `bg-muted/30` RETIRÉ. Depuis que `Card`
      // a perdu `border` ET `shadow-sm`, le delta de surface `--card` vs `--background` est le
      // SEUL mécanisme qui détache la carte du fond ; or cet écran est le cas limite que DESIGN.md
      // signale (une carte SEULE, sans voisine ni espacement pour porter la séparation à sa place).
      // Mesuré sur les jetons réels d'`index.css` (formule WCAG 2.1, composition alpha sRGB) : le
      // voile `muted/30` éclaircit le fond VERS la carte et fait tomber ce delta de 1.072:1 à
      // 1.027:1 en sombre — 63 % de la séparation perdue là où elle est déjà la plus fragile (en
      // clair, l'écart reste sous le point d'arrondi). Fond de page nu = delta nominal restauré
      // (celui que DESIGN.md documente), sans réintroduire ni trait ni ombre —
      // exactement le « fond de page plus franc » que DESIGN.md préconise plutôt qu'une bordure.
      className="min-h-dvh items-center justify-center p-4"
    >
      <div className="w-full max-w-[420px] space-y-4">
        <div className="flex justify-end">
          <SelecteurLangue />
        </div>

        <LimiteErreurEcran>
          <Card>
            <CardHeader>
              {/* `CardTitle` (h2, `texte-titre-section`) plutôt qu'un `div` stylé à la main : le h1
                  de `GabaritEcran` reste `sr-only` (voir la note ci-dessus), un vrai titre de
                  section ici donne un point d'ancrage réel à la navigation par landmarks/en-têtes
                  d'un lecteur d'écran — h2 après un h1 masqué reste une hiérarchie valide.
                  Clé DÉDIÉE (`carte.titre`, pas `connexion.titre` réutilisé) : le h1 sr-only porte
                  déjà « Connexion » (nom de la PAGE — c'est ce nom que `routeur.spec.tsx` vérifie
                  pour prouver qu'une route protégée sans session redirige bien vers `/login`, sans
                  jamais rendre le contenu de la carte). Donner au h2 le même nom produirait deux
                  en-têtes de même nom accessible sur un même écran — un lecteur d'écran annoncerait
                  « Connexion » deux fois sans que l'utilisateur sache lequel désigne quoi (défaut
                  mesuré : `getByRole('heading', { name: 'Connexion' })` en trouvait deux). Le h2
                  nomme donc ce que la carte demande RÉELLEMENT — les identifiants — plutôt que de
                  répéter le nom de l'écran. */}
              <CardTitle>{t('auth:connexion.carte.titre')}</CardTitle>
              <CardDescription>{t('auth:connexion.sousTitre')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={soumettre} noValidate className="space-y-4">
                {erreur && categorieErreur ? (
                  <Alert variant={categorieErreur === 'reseau' ? 'avertissement' : 'destructive'}>
                    {categorieErreur === 'reseau' ? (
                      <WifiOff className="h-4 w-4" aria-hidden="true" />
                    ) : categorieErreur === 'serveur' ? (
                      <ServerCrash className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    )}
                    <AlertTitle>{titreErreurConnexion(categorieErreur, t)}</AlertTitle>
                    <AlertDescription>{messageErreur(erreur, t)}</AlertDescription>
                  </Alert>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="email">{t('auth:connexion.champs.email.libelle')}</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    spellCheck={false}
                    placeholder={t('auth:connexion.champs.email.exemple')}
                    readOnly={enCours}
                    aria-invalid={form.formState.errors.email ? true : undefined}
                    aria-describedby={form.formState.errors.email ? 'email-erreur' : undefined}
                    {...form.register('email')}
                  />
                  {form.formState.errors.email ? (
                    <p id="email-erreur" className="texte-corps text-destructive">
                      {t('validation:email.invalide')}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="motDePasse">
                    {t('auth:connexion.champs.motDePasse.libelle')}
                  </Label>
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
                      className="anneau-focus absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
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
                    <p id="motDePasse-erreur" className="texte-corps text-destructive">
                      {t('validation:requis')}
                    </p>
                  ) : null}
                </div>

                <Button type="submit" className="w-full" disabled={enCours}>
                  {enCours
                    ? t('auth:connexion.actions.enCours')
                    : t('auth:connexion.actions.seConnecter')}
                </Button>

                <p className="text-center texte-corps text-muted-foreground">
                  {t('auth:connexion.aide.motDePasseOublie')}
                </p>
              </form>
            </CardContent>
          </Card>
        </LimiteErreurEcran>
      </div>
    </GabaritEcran>
  );
}
