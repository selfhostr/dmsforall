import { CheckCircle2, Circle } from 'lucide-react';
import { useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { ErreurApi, ErreurReseau, messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useModifierBlocCreancier } from '@/hooks/parametrage/useModifierBlocCreancier';
import type {
  BlocCreancier,
  EntreeModificationBlocCreancier,
} from '@/hooks/parametrage/bloc-creancier.api';
import { cn } from '@/lib/utils';

interface Props {
  readonly blocCreancier: BlocCreancier;
}

interface ValeursFormulaire {
  readonly nom: string;
  readonly rue: string;
  readonly numero: string;
  readonly npa: string;
  readonly localite: string;
  readonly pays: string;
  readonly iban: string;
  readonly qrIban: string;
}

const PAYS_ADMIS = ['CH', 'LI'] as const;

function versValeursFormulaire(bloc: BlocCreancier): ValeursFormulaire {
  return {
    nom: bloc.nom ?? '',
    rue: bloc.rue ?? '',
    numero: bloc.numero ?? '',
    npa: bloc.npa ?? '',
    localite: bloc.localite ?? '',
    pays: bloc.pays,
    iban: bloc.iban ?? '',
    qrIban: bloc.qrIban ?? '',
  };
}

/** Chaîne saisie -> `null` explicite (efface le champ côté API) — jamais `undefined` : ce
 *  formulaire envoie systématiquement l'état courant complet à chaque enregistrement (patron
 *  « écran de préférences », pas une édition partielle façon brouillon de document de vente). */
function versEntree(valeurs: ValeursFormulaire): EntreeModificationBlocCreancier {
  const videVersNull = (valeur: string): string | null =>
    valeur.trim() === '' ? null : valeur.trim();
  return {
    nom: videVersNull(valeurs.nom),
    rue: videVersNull(valeurs.rue),
    numero: videVersNull(valeurs.numero),
    npa: videVersNull(valeurs.npa),
    localite: videVersNull(valeurs.localite),
    pays: valeurs.pays,
    // IBAN/QR-IBAN : la forme saisie (espaces tolérés, ex. « CH93 0076 2011 6238 5295 7 ») part
    // telle quelle — la normalisation (majuscules, compaction) est faite côté serveur
    // (`facturation/qr/iban.ts`), jamais dupliquée ici.
    iban: videVersNull(valeurs.iban),
    qrIban: videVersNull(valeurs.qrIban),
  };
}

/**
 * Formulaire du bloc créancier (RF-54/PF-03) — un seul écran de préférences, pas un assistant :
 * identité, adresse structurée, comptes bancaires. Toujours enregistrable même incomplet (voir
 * `versEntree` : aucun champ n'est rendu obligatoire à la SAISIE, `schemaModificationBlocCreancier`
 * còté API accepte un corps partiel) — seule l'ÉMISSION d'une facture appliquera ses propres
 * règles bloquantes (`409 QR_CREANCIER_INCOMPLET`). Le bandeau de complétude ci-dessous existe
 * pour que ce blocage-là arrive ICI, à froid, plutôt qu'au comptoir devant un client.
 */
export function FormulaireBlocCreancier({ blocCreancier }: Props) {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const modifier = useModifierBlocCreancier();
  const [dernierEnregistrementReussi, setDernierEnregistrementReussi] = useState(false);

  const form = useForm<ValeursFormulaire>({ defaultValues: versValeursFormulaire(blocCreancier) });
  const valeurs = form.watch();

  const soumettre = form.handleSubmit((donnees) => {
    setDernierEnregistrementReussi(false);
    modifier.mutate(versEntree(donnees), {
      onSuccess: () => setDernierEnregistrementReussi(true),
    });
  });

  const erreur = modifier.error;
  const erreursChamp = erreur instanceof ErreurApi ? (erreur.probleme.erreurs ?? []) : [];
  const erreurPourChamp = (champ: 'iban' | 'qrIban') => erreursChamp.find((e) => e.champ === champ);
  // Une erreur DE CHAMP (iban/qrIban) est déjà montrée sous le champ concerné (§ formulaire) —
  // le bandeau global n'affiche donc que le RESTE (réseau, droit perdu en cours de route, etc.),
  // jamais le même message en double.
  const erreurGlobaleAAfficher = erreur && erreursChamp.length === 0;
  const estErreurReseau = erreur instanceof ErreurReseau;

  const nomRempli = valeurs.nom.trim() !== '';
  const adresseComplete = [valeurs.rue, valeurs.numero, valeurs.npa, valeurs.localite].every(
    (v) => v.trim() !== '',
  );
  const compteRempli = valeurs.iban.trim() !== '' || valeurs.qrIban.trim() !== '';
  const complet = nomRempli && adresseComplete && compteRempli;

  return (
    <form onSubmit={soumettre} noValidate className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('parametrage:creancier.completude.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {complet ? (
            <p className="flex items-center gap-2 texte-corps text-foreground">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t('parametrage:creancier.completude.complet')}
            </p>
          ) : (
            <ul className="space-y-1.5">
              <ElementCompletude ok={nomRempli} texte={t('parametrage:creancier.completude.nom')} />
              <ElementCompletude
                ok={adresseComplete}
                texte={t('parametrage:creancier.completude.adresse')}
              />
              <ElementCompletude
                ok={compteRempli}
                texte={t('parametrage:creancier.completude.compte')}
              />
            </ul>
          )}
        </CardContent>
      </Card>

      {blocCreancier.version === 0 ? (
        <Alert variant="avertissement">
          <AlertDescription>{t('parametrage:creancier.nonConfigure')}</AlertDescription>
        </Alert>
      ) : null}

      {erreurGlobaleAAfficher ? (
        <Alert variant={estErreurReseau ? 'avertissement' : 'destructive'}>
          <AlertTitle>
            {t(estErreurReseau ? 'erreurs:reseau.titre' : 'erreurs:inattendue.titre')}
          </AlertTitle>
          <AlertDescription>{messageErreur(erreur, t)}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('parametrage:creancier.identite.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="bc-nom">{t('parametrage:creancier.identite.nom')}</Label>
          <Input
            id="bc-nom"
            maxLength={70}
            readOnly={modifier.isPending}
            {...form.register('nom')}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('parametrage:creancier.adresse.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bc-rue">{t('parametrage:creancier.adresse.rue')}</Label>
            <Input
              id="bc-rue"
              maxLength={70}
              readOnly={modifier.isPending}
              {...form.register('rue')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bc-numero">{t('parametrage:creancier.adresse.numero')}</Label>
            <Input
              id="bc-numero"
              maxLength={16}
              readOnly={modifier.isPending}
              {...form.register('numero')}
            />
            <p className="texte-corps text-muted-foreground">
              {t('parametrage:creancier.adresse.numeroAide')}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="bc-npa">{t('parametrage:creancier.adresse.npa')}</Label>
              <Input
                id="bc-npa"
                maxLength={16}
                readOnly={modifier.isPending}
                {...form.register('npa')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bc-localite">{t('parametrage:creancier.adresse.localite')}</Label>
              <Input
                id="bc-localite"
                maxLength={35}
                readOnly={modifier.isPending}
                {...form.register('localite')}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bc-pays">{t('parametrage:creancier.adresse.pays')}</Label>
            <Select
              value={form.watch('pays')}
              onValueChange={(valeur) => form.setValue('pays', valeur)}
              disabled={modifier.isPending}
            >
              <SelectTrigger
                id="bc-pays"
                aria-label={t('parametrage:creancier.adresse.pays')}
                className="w-40"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYS_ADMIS.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('parametrage:creancier.comptes.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="texte-corps text-muted-foreground">
            {t('parametrage:creancier.comptes.explication')}
          </p>

          <ChampCompte
            id="bc-iban"
            champ="iban"
            libelle={t('parametrage:creancier.comptes.iban')}
            aide={t('parametrage:creancier.comptes.ibanAide')}
            lectureSeule={modifier.isPending}
            register={form.register('iban')}
            invalide={Boolean(erreurPourChamp('iban'))}
            erreur={erreurPourChamp('iban')}
            t={t}
          />

          <ChampCompte
            id="bc-qr-iban"
            champ="qrIban"
            libelle={t('parametrage:creancier.comptes.qrIban')}
            aide={t('parametrage:creancier.comptes.qrIbanAide')}
            lectureSeule={modifier.isPending}
            register={form.register('qrIban')}
            invalide={Boolean(erreurPourChamp('qrIban'))}
            erreur={erreurPourChamp('qrIban')}
            t={t}
          />
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={modifier.isPending}>
          {modifier.isPending
            ? t('commun:chargement.enCours')
            : t('parametrage:creancier.actions.enregistrer')}
        </Button>
        {dernierEnregistrementReussi && !modifier.isPending ? (
          <span className="flex items-center gap-1.5 texte-corps text-foreground">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {t('parametrage:creancier.enregistrementReussi')}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function ElementCompletude({ ok, texte }: { readonly ok: boolean; readonly texte: string }) {
  return (
    <li
      className={cn(
        'flex items-center gap-2 texte-corps',
        ok ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {ok ? (
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <Circle className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      {texte}
    </li>
  );
}

interface PropsChampCompte {
  readonly id: string;
  readonly champ: 'iban' | 'qrIban';
  readonly libelle: string;
  readonly aide: string;
  readonly lectureSeule: boolean;
  readonly register: UseFormRegisterReturn;
  readonly invalide: boolean;
  readonly erreur: { readonly code: string } | undefined;
  readonly t: (cle: string, options?: Record<string, unknown>) => string;
}

/** Champ IBAN/QR-IBAN — l'erreur, quand elle existe, s'affiche SOUS CE CHAMP précis (jamais dans
 *  un bandeau global) : c'est une faute de saisie, elle se corrige là où elle a été faite. Le
 *  `code` renvoyé par le serveur (`IBAN_INVALIDE`, `IBAN_EST_UN_QR_IBAN`,
 *  `QR_IBAN_SANS_IID_RESERVE`) pilote seul le message, jamais le `message` brut du serveur — même
 *  discipline que `messageErreur` pour un refus global. `defaultValue` couvre un code de champ
 *  qu'un futur module d'`iban.ts` ajouterait sans que ce formulaire n'ait encore sa traduction. */
function ChampCompte({
  id,
  libelle,
  aide,
  lectureSeule,
  register,
  invalide,
  erreur,
  t,
}: PropsChampCompte) {
  const idErreur = `${id}-erreur`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{libelle}</Label>
      <Input
        id={id}
        maxLength={34}
        readOnly={lectureSeule}
        aria-invalid={invalide || undefined}
        aria-describedby={erreur ? idErreur : undefined}
        {...register}
      />
      <p className="texte-corps text-muted-foreground">{aide}</p>
      {erreur ? (
        <p id={idErreur} className="texte-corps text-destructive" role="alert">
          {t(`erreurs:codes.${erreur.code}`, {
            defaultValue: t('erreurs:codes.VALIDATION_ECHOUEE'),
          })}
        </p>
      ) : null}
    </div>
  );
}
