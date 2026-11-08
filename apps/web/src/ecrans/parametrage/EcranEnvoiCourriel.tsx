import { AlertTriangle, CheckCircle2, CircleSlash, XCircle, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SECURITES_SMTP, type ReglageEnvoiCourriel, type ReponseEnvoiCourriel } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formaterDateHeure } from '@/lib/formats';
import { AideContextuelle } from '@/composants/AideContextuelle';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { BadgeStatut, type TokenStatut } from '@/composants/identite/BadgeStatut';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { usePeut } from '@/droits';
import {
  useEnvoiCourriel,
  useModifierEnvoiCourriel,
  useTesterEnvoiCourriel,
} from '@/hooks/parametrage/useEnvoiCourriel';

import {
  appliquerFournisseur,
  CHOIX_FOURNISSEURS,
  champsInvalides,
  estModifie,
  fournisseurDe,
  SAISIE_VIDE,
  saisieDepuisReglage,
  versEntree,
  type ChampEnErreur,
  type ChoixFournisseur,
  type SaisieEnvoiCourriel,
} from './envoi-courriel';

/**
 * Réglages > Envoi des e-mails (`GET|PATCH|DELETE /parametres-entreprise/envoi-courriel`, `POST …/test`) :
 * chaque garage règle ici son propre serveur d'envoi (relances, factures, mots de passe oubliés).
 * Le mot de passe n'est jamais relu : on sait seulement s'il est enregistré. L'e-mail d'essai teste
 * le réglage ENREGISTRÉ, d'où le bouton grisé tant que le formulaire a des modifications.
 */
export function EcranEnvoiCourriel() {
  const { t } = useTranslation(['parametrage', 'erreurs']);
  const requete = useEnvoiCourriel();

  return (
    <GabaritEcran titre={t('parametrage:envoiCourriel.titre')}>
      {requete.isPending ? <EtatChargement lignes={6} /> : null}
      {requete.isError ? (
        <EtatErreur
          titre={t('parametrage:envoiCourriel.erreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      ) : null}
      {requete.isSuccess ? <ContenuEnvoiCourriel donnees={requete.data} /> : null}
    </GabaritEcran>
  );
}

function ContenuEnvoiCourriel({ donnees }: { readonly donnees: ReponseEnvoiCourriel }) {
  const { t } = useTranslation(['parametrage']);
  return (
    <div className="space-y-4">
      <EtatEnvoi donnees={donnees} />
      <FormulaireEnvoiCourriel
        // Remonte le formulaire quand le réglage enregistré change (nouvelle base de comparaison).
        key={JSON.stringify(donnees.reglage)}
        donnees={donnees}
      />
      {donnees.reglage ? <EssaiEnvoi reglage={donnees.reglage} /> : null}
      <p className="texte-corps text-muted-foreground">{t('parametrage:envoiCourriel.chiffre')}</p>
    </div>
  );
}

function EtatEnvoi({ donnees }: { readonly donnees: ReponseEnvoiCourriel }) {
  const { t } = useTranslation(['parametrage']);
  const { configure, source, modeCapture, reglage } = donnees;
  const dernier = reglage?.dernierTest ?? null;

  const principal: { token: TokenStatut; icone: LucideIcon; cle: string } = !configure
    ? { token: 'attention', icone: AlertTriangle, cle: 'nonConfigure' }
    : { token: 'succes', icone: CheckCircle2, cle: source === 'garage' ? 'garage' : 'instance' };

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <BadgeStatut icone={principal.icone} token={principal.token} forme="plein">
            {t(`parametrage:envoiCourriel.etat.${principal.cle}`)}
          </BadgeStatut>
          {dernier ? (
            <BadgeStatut
              icone={dernier.succes ? CheckCircle2 : XCircle}
              token={dernier.succes ? 'succes' : 'danger'}
              forme="contour"
            >
              {t(
                dernier.succes
                  ? 'parametrage:envoiCourriel.etat.essaiReussi'
                  : 'parametrage:envoiCourriel.etat.essaiEchoue',
                { date: formaterDateHeure(dernier.le) },
              )}
            </BadgeStatut>
          ) : reglage ? (
            <BadgeStatut icone={CircleSlash} token="neutre" forme="contour">
              {t('parametrage:envoiCourriel.etat.aucunEssai')}
            </BadgeStatut>
          ) : null}
        </div>
        <p className="texte-corps text-foreground">
          {t(`parametrage:envoiCourriel.etat.explication.${principal.cle}`)}
        </p>
        {modeCapture ? (
          <Alert variant="avertissement">
            <AlertDescription>{t('parametrage:envoiCourriel.etat.modeCapture')}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FormulaireEnvoiCourriel({ donnees }: { readonly donnees: ReponseEnvoiCourriel }) {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const peutModifier = usePeut('parametrage.envoi_courriel.gerer');
  const modifier = useModifierEnvoiCourriel();
  const { reglage } = donnees;

  const [saisie, setSaisie] = useState<SaisieEnvoiCourriel>(() =>
    reglage ? saisieDepuisReglage(reglage) : appliquerFournisseur(SAISIE_VIDE, 'infomaniak'),
  );
  const [fournisseur, setFournisseur] = useState<ChoixFournisseur>(() =>
    reglage ? fournisseurDe(reglage.hote) : 'infomaniak',
  );
  const [erreurs, setErreurs] = useState<readonly ChampEnErreur[]>([]);

  const maj = (partiel: Partial<SaisieEnvoiCourriel>) => {
    setSaisie((s) => ({ ...s, ...partiel }));
    setErreurs([]);
  };
  const invalide = (champ: ChampEnErreur) => (erreurs.includes(champ) ? true : undefined);
  const desactive = !peutModifier || modifier.isPending;
  const sansCle = !donnees.chiffrementDisponible && saisie.motDePasse !== '';

  function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    const trouvees = champsInvalides(saisie);
    setErreurs(trouvees);
    if (trouvees.length > 0 || sansCle) return;
    modifier.mutate(versEntree(saisie));
  }

  const erreurChamp = (champ: ChampEnErreur) =>
    erreurs.includes(champ) ? (
      <p id={`env-${champ}-erreur`} className="texte-corps text-destructive" role="alert">
        {t(`parametrage:envoiCourriel.champs.${champ}.erreur`)}
      </p>
    ) : null;

  return (
    <form onSubmit={soumettre} noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('parametrage:envoiCourriel.carte.titre')}
          </CardTitle>
          <p className="texte-corps text-muted-foreground">
            {t('parametrage:envoiCourriel.carte.description')}
          </p>
          <LegendeChampsObligatoires>
            {t('commun:formulaires.champsObligatoiresLegende')}
          </LegendeChampsObligatoires>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="env-fournisseur">
                {t('parametrage:envoiCourriel.champs.fournisseur.libelle')}
              </Label>
              <AideContextuelle
                sujet={t('parametrage:envoiCourriel.champs.fournisseur.libelle')}
                texte={t('aide:parametrage.envoiCourriel.fournisseur')}
              />
            </div>
            <Select
              value={fournisseur}
              disabled={desactive}
              onValueChange={(v) => {
                const choix = v as ChoixFournisseur;
                setFournisseur(choix);
                setSaisie((s) => appliquerFournisseur(s, choix));
                setErreurs([]);
              }}
            >
              <SelectTrigger id="env-fournisseur">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHOIX_FOURNISSEURS.map((choix) => (
                  <SelectItem key={choix} value={choix}>
                    {t(`parametrage:envoiCourriel.fournisseurs.${choix}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="env-hote" requis>
                  {t('parametrage:envoiCourriel.champs.hote.libelle')}
                </Label>
                <AideContextuelle
                  sujet={t('parametrage:envoiCourriel.champs.hote.libelle')}
                  texte={t('aide:parametrage.envoiCourriel.hote')}
                />
              </div>
              <Input
                id="env-hote"
                value={saisie.hote}
                readOnly={desactive}
                autoComplete="off"
                inputMode="url"
                aria-required="true"
                aria-invalid={invalide('hote')}
                aria-describedby={erreurs.includes('hote') ? 'env-hote-erreur' : undefined}
                onChange={(e) => {
                  setFournisseur('autre');
                  maj({ hote: e.target.value });
                }}
              />
              {erreurChamp('hote')}
            </div>
            <div className="space-y-2">
              <Label htmlFor="env-port" requis>
                {t('parametrage:envoiCourriel.champs.port.libelle')}
              </Label>
              <Input
                id="env-port"
                value={saisie.port}
                readOnly={desactive}
                inputMode="numeric"
                aria-required="true"
                aria-invalid={invalide('port')}
                aria-describedby={erreurs.includes('port') ? 'env-port-erreur' : undefined}
                onChange={(e) => maj({ port: e.target.value })}
              />
              {erreurChamp('port')}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="env-securite" requis>
                {t('parametrage:envoiCourriel.champs.securite.libelle')}
              </Label>
              <AideContextuelle
                sujet={t('parametrage:envoiCourriel.champs.securite.libelle')}
                texte={t('aide:parametrage.envoiCourriel.securite')}
              />
            </div>
            <Select
              value={saisie.securite}
              disabled={desactive}
              onValueChange={(v) => maj({ securite: v as SaisieEnvoiCourriel['securite'] })}
            >
              <SelectTrigger id="env-securite" aria-required="true">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECURITES_SMTP.map((valeur) => (
                  <SelectItem key={valeur} value={valeur}>
                    {t(`parametrage:envoiCourriel.champs.securite.options.${valeur}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="env-utilisateur">
                {t('parametrage:envoiCourriel.champs.utilisateur.libelle')}
              </Label>
              <Input
                id="env-utilisateur"
                value={saisie.utilisateur}
                readOnly={desactive}
                autoComplete="off"
                onChange={(e) => maj({ utilisateur: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="env-mot-de-passe">
                  {t('parametrage:envoiCourriel.champs.motDePasse.libelle')}
                </Label>
                <AideContextuelle
                  sujet={t('parametrage:envoiCourriel.champs.motDePasse.libelle')}
                  texte={t('aide:parametrage.envoiCourriel.motDePasse')}
                />
              </div>
              <Input
                id="env-mot-de-passe"
                type="password"
                value={saisie.motDePasse}
                readOnly={desactive}
                autoComplete="new-password"
                placeholder={
                  reglage?.motDePasseDefini
                    ? t('parametrage:envoiCourriel.champs.motDePasse.enregistre')
                    : undefined
                }
                aria-describedby="env-mot-de-passe-aide"
                onChange={(e) => maj({ motDePasse: e.target.value })}
              />
              <p id="env-mot-de-passe-aide" className="texte-libelle text-muted-foreground">
                {reglage?.motDePasseDefini
                  ? t('parametrage:envoiCourriel.champs.motDePasse.aideEnregistre')
                  : t('parametrage:envoiCourriel.champs.motDePasse.aide')}
              </p>
            </div>
          </div>
          {sansCle ? (
            <Alert variant="destructive">
              <AlertDescription>
                {t('parametrage:envoiCourriel.champs.motDePasse.sansCle')}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="env-adresse-expediteur" requis>
                  {t('parametrage:envoiCourriel.champs.adresseExpediteur.libelle')}
                </Label>
                <AideContextuelle
                  sujet={t('parametrage:envoiCourriel.champs.adresseExpediteur.libelle')}
                  texte={t('aide:parametrage.envoiCourriel.adresseExpediteur')}
                />
              </div>
              <Input
                id="env-adresse-expediteur"
                type="email"
                value={saisie.adresseExpediteur}
                readOnly={desactive}
                autoComplete="off"
                aria-required="true"
                aria-invalid={invalide('adresseExpediteur')}
                aria-describedby={
                  erreurs.includes('adresseExpediteur') ? 'env-adresseExpediteur-erreur' : undefined
                }
                onChange={(e) => maj({ adresseExpediteur: e.target.value })}
              />
              {erreurChamp('adresseExpediteur')}
            </div>
            <div className="space-y-2">
              <Label htmlFor="env-nom-affiche">
                {t('parametrage:envoiCourriel.champs.nomAffiche.libelle')}
              </Label>
              <Input
                id="env-nom-affiche"
                value={saisie.nomAffiche}
                maxLength={100}
                readOnly={desactive}
                autoComplete="off"
                onChange={(e) => maj({ nomAffiche: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="env-adresse-reponse">
                {t('parametrage:envoiCourriel.champs.adresseReponse.libelle')}
              </Label>
              <AideContextuelle
                sujet={t('parametrage:envoiCourriel.champs.adresseReponse.libelle')}
                texte={t('aide:parametrage.envoiCourriel.adresseReponse')}
              />
            </div>
            <Input
              id="env-adresse-reponse"
              type="email"
              value={saisie.adresseReponse}
              readOnly={desactive}
              autoComplete="off"
              aria-invalid={invalide('adresseReponse')}
              aria-describedby={
                erreurs.includes('adresseReponse') ? 'env-adresseReponse-erreur' : undefined
              }
              onChange={(e) => maj({ adresseReponse: e.target.value })}
            />
            {erreurChamp('adresseReponse')}
          </div>

          {modifier.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{messageErreur(modifier.error, t)}</AlertDescription>
            </Alert>
          ) : null}
          {peutModifier ? null : (
            <p className="texte-corps text-foreground">
              {t('parametrage:envoiCourriel.lectureSeule')}
            </p>
          )}

          {peutModifier ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={modifier.isPending || !estModifie(saisie, reglage)}>
                {t('parametrage:envoiCourriel.enregistrer')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </form>
  );
}

function EssaiEnvoi({ reglage }: { readonly reglage: ReglageEnvoiCourriel }) {
  const { t } = useTranslation(['parametrage', 'erreurs']);
  const peutModifier = usePeut('parametrage.envoi_courriel.gerer');
  const tester = useTesterEnvoiCourriel();
  const [destinataire, setDestinataire] = useState('');
  const [invalide, setInvalide] = useState(false);

  function envoyer(evenement: React.FormEvent) {
    evenement.preventDefault();
    const adresse = destinataire.trim();
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adresse);
    setInvalide(!ok);
    if (ok) tester.mutate({ destinataire: adresse });
  }

  return (
    <form onSubmit={envoyer} noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('parametrage:envoiCourriel.essai.titre')}
          </CardTitle>
          <p className="texte-corps text-muted-foreground">
            {t('parametrage:envoiCourriel.essai.description')}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="env-essai-destinataire" requis>
                {t('parametrage:envoiCourriel.essai.destinataire')}
              </Label>
              <AideContextuelle
                sujet={t('parametrage:envoiCourriel.essai.destinataire')}
                texte={t('aide:parametrage.envoiCourriel.essai')}
              />
            </div>
            <Input
              id="env-essai-destinataire"
              type="email"
              value={destinataire}
              autoComplete="email"
              aria-required="true"
              aria-invalid={invalide ? true : undefined}
              aria-describedby={invalide ? 'env-essai-erreur' : undefined}
              onChange={(e) => {
                setDestinataire(e.target.value);
                setInvalide(false);
              }}
            />
            {invalide ? (
              <p id="env-essai-erreur" className="texte-corps text-destructive" role="alert">
                {t('parametrage:envoiCourriel.essai.erreurAdresse')}
              </p>
            ) : null}
          </div>
          <Button type="submit" disabled={!peutModifier || tester.isPending}>
            {tester.isPending
              ? t('parametrage:envoiCourriel.essai.enCours')
              : t('parametrage:envoiCourriel.essai.envoyer')}
          </Button>
          {tester.isSuccess && !tester.isPending ? (
            <p className="flex items-center gap-1.5 texte-corps text-foreground" role="status">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {t('parametrage:envoiCourriel.essai.reussi')}
            </p>
          ) : null}
          {tester.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{messageErreur(tester.error, t)}</AlertDescription>
            </Alert>
          ) : null}
          {reglage.dernierTest === null ? null : (
            <p className="texte-libelle text-muted-foreground">
              {t('parametrage:envoiCourriel.essai.dernier', {
                date: formaterDateHeure(reglage.dernierTest.le),
              })}
            </p>
          )}
        </CardContent>
      </Card>
    </form>
  );
}
