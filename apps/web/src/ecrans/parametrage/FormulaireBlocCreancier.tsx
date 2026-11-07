import { CheckCircle2, Circle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useForm, type UseFormRegisterReturn, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { ErreurApi, ErreurReseau, messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AideContextuelle } from '@/composants/AideContextuelle';
import { useModifierBlocCreancier } from '@/hooks/parametrage/useModifierBlocCreancier';
import { useParametresEntreprise } from '@/hooks/parametrage/useParametresEntreprise';
import type {
  BlocCreancier,
  EntreeModificationBlocCreancier,
} from '@/hooks/parametrage/bloc-creancier.api';
import { chemins } from '@/routes/chemins';
import { cn } from '@/lib/utils';

import { adresseGarageComplete } from './FormulaireAdresseGarage';

interface Props {
  readonly blocCreancier: BlocCreancier;
}

/** Nom du bulletin et comptes : l'adresse, elle, se règle dans « Mon garage » (`FormulaireAdresseGarage`).
 *  Chaque formulaire n'envoie que SES champs (PATCH partiel) : aucun n'écrase l'autre. */
export interface ValeursFormulaire {
  readonly nom: string;
  readonly iban: string;
  readonly qrIban: string;
}

function versValeursFormulaire(bloc: BlocCreancier): ValeursFormulaire {
  return {
    nom: bloc.nom ?? '',
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

  // Un seul nom visible : celui de l'onglet Entreprise (raison sociale). Le bulletin QR reprend ce
  // nom (70 car. max, limite du standard) ; un nom différent (titulaire du compte sous un autre
  // nom) reste possible via le lien, et s'ouvre de lui-même si le bloc en porte déjà un autre.
  const entreprise = useParametresEntreprise();
  const nomEntreprise = entreprise.data?.raisonSociale.trim().slice(0, 70);
  const [autreNomDemande, setAutreNomDemande] = useState(false);
  const nomDejaDifferent =
    blocCreancier.nom !== null &&
    blocCreancier.nom.trim() !== '' &&
    blocCreancier.nom !== nomEntreprise;
  const nomSepare = nomEntreprise === undefined || autreNomDemande || nomDejaDifferent;
  const nomEffectif = nomSepare ? valeurs.nom : (nomEntreprise ?? '');

  const soumettre = form.handleSubmit((donnees) => {
    setDernierEnregistrementReussi(false);
    modifier.mutate(versEntree({ ...donnees, nom: nomSepare ? donnees.nom : nomEffectif }), {
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

  const nomRempli = nomEffectif.trim() !== '';
  const adresseComplete = adresseGarageComplete(blocCreancier);
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
                texte={
                  <Link to={chemins.parametrage.garage()} className="underline underline-offset-2">
                    {t('parametrage:creancier.completude.adresse')}
                  </Link>
                }
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
          {nomSepare ? (
            <>
              <Label htmlFor="bc-nom" requis>
                {t('parametrage:creancier.identite.nomBulletin')}
              </Label>
              <Input
                id="bc-nom"
                maxLength={70}
                readOnly={modifier.isPending}
                aria-required="true"
                {...form.register('nom')}
              />
              <p className="texte-corps text-muted-foreground">
                {t('parametrage:creancier.identite.nomBulletinAide')}
              </p>
            </>
          ) : (
            <>
              <p className="texte-corps">
                {t('parametrage:creancier.identite.nomRepris', { nom: nomEntreprise })}
              </p>
              <Button
                type="button"
                variant="link"
                className="h-auto p-0"
                onClick={() => setAutreNomDemande(true)}
              >
                {t('parametrage:creancier.identite.nomDifferent')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <SectionComptesBancaires
        form={form}
        lectureSeule={modifier.isPending}
        erreurPourChamp={erreurPourChamp}
      />

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

interface PropsSectionBloc {
  readonly form: UseFormReturn<ValeursFormulaire>;
  readonly lectureSeule: boolean;
}

interface PropsSectionComptes extends PropsSectionBloc {
  readonly erreurPourChamp: (champ: 'iban' | 'qrIban') => { readonly code: string } | undefined;
}

/** Comptes bancaires — « un sur deux » : IBAN OU QR-IBAN suffit. Le groupe porte l'obligation
 *  (légende `fieldset` + `aria-describedby`), pas chaque champ : `aria-required` sur les deux
 *  dirait qu'il faut remplir les deux. */
export function SectionComptesBancaires({
  form,
  lectureSeule,
  erreurPourChamp,
}: PropsSectionComptes) {
  const { t } = useTranslation(['parametrage', 'erreurs']);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">
          {t('parametrage:creancier.comptes.titre')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <fieldset className="space-y-4" aria-describedby="bc-comptes-groupe">
          <legend className="texte-corps font-medium text-foreground">
            {t('parametrage:creancier.comptes.groupe')}
            <span aria-hidden="true" className="ml-0.5">
              *
            </span>
          </legend>
          <p id="bc-comptes-groupe" className="texte-corps text-muted-foreground">
            {t('parametrage:creancier.comptes.groupeAide')}
          </p>

          <ChampCompte
            id="bc-iban"
            libelle={t('parametrage:creancier.comptes.iban')}
            lectureSeule={lectureSeule}
            register={form.register('iban')}
            erreur={erreurPourChamp('iban')}
            t={t}
          />

          <ChampCompte
            id="bc-qr-iban"
            libelle={t('parametrage:creancier.comptes.qrIban')}
            aide={
              <AideContextuelle
                sujet={t('parametrage:creancier.comptes.qrIban')}
                texte={t('aide:parametrage.qrIban')}
              />
            }
            lectureSeule={lectureSeule}
            register={form.register('qrIban')}
            erreur={erreurPourChamp('qrIban')}
            t={t}
          />

        </fieldset>
      </CardContent>
    </Card>
  );
}

function ElementCompletude({ ok, texte }: { readonly ok: boolean; readonly texte: ReactNode }) {
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
  readonly libelle: string;
  readonly aide?: ReactNode;
  readonly lectureSeule: boolean;
  readonly register: UseFormRegisterReturn;
  readonly erreur: { readonly code: string } | undefined;
  readonly t: (cle: string, options?: Record<string, unknown>) => string;
}

/** Champ IBAN/QR-IBAN — l'erreur, quand elle existe, s'affiche SOUS CE CHAMP précis (jamais dans
 *  un bandeau global) : c'est une faute de saisie, elle se corrige là où elle a été faite. Le
 *  `code` renvoyé par le serveur (`IBAN_INVALIDE`, `IBAN_EST_UN_QR_IBAN`,
 *  `QR_IBAN_SANS_IID_RESERVE`) pilote seul le message, jamais le `message` brut du serveur — même
 *  discipline que `messageErreur` pour un refus global. `defaultValue` couvre un code de champ
 *  qu'un futur module d'`iban.ts` ajouterait sans que ce formulaire n'ait encore sa traduction. */
function ChampCompte({ id, libelle, aide, lectureSeule, register, erreur, t }: PropsChampCompte) {
  const idErreur = `${id}-erreur`;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>{libelle}</Label>
        {aide}
      </div>
      <Input
        id={id}
        maxLength={34}
        readOnly={lectureSeule}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={erreur ? idErreur : undefined}
        {...register}
      />
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
