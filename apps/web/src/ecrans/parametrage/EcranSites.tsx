import type { ActionsSession } from '@/droits';
import { CheckCircle2, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { ReponseParametresSite } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import {
  useModifierParametresSite,
  type EntreeModificationParametresSite,
} from '@/hooks/parametres/useModifierParametresSite';
import { useParametresSite } from '@/hooks/parametres/useParametresSite';
import { useSession } from '@/hooks/useSession';
import { formaterDate } from '@/lib/formats';
import { cn } from '@/lib/utils';

import { ChampTempsCentiemes } from './ChampTempsCentiemes';
import { peutModifierParametrage } from './droits';

interface ValeursFormulaireSite {
  readonly heureOuverture: string;
  readonly heureFermeture: string;
  readonly heureCloturePointage: string;
  readonly capaciteHeuresJourCentiemes: number | null;
}

function versValeursFormulaire(donnees: ReponseParametresSite): ValeursFormulaireSite {
  return {
    heureOuverture: donnees.heureOuverture ?? '',
    heureFermeture: donnees.heureFermeture ?? '',
    heureCloturePointage: donnees.heureCloturePointage ?? '',
    capaciteHeuresJourCentiemes: donnees.capaciteHeuresJourCentiemes,
  };
}

function versEntreeModification(
  valeurs: ValeursFormulaireSite,
  joursFermeture: readonly string[],
): EntreeModificationParametresSite {
  return {
    heureOuverture: valeurs.heureOuverture === '' ? null : valeurs.heureOuverture,
    heureFermeture: valeurs.heureFermeture === '' ? null : valeurs.heureFermeture,
    heureCloturePointage: valeurs.heureCloturePointage === '' ? null : valeurs.heureCloturePointage,
    capaciteHeuresJourCentiemes: valeurs.capaciteHeuresJourCentiemes,
    joursFermeture: [...joursFermeture].sort(),
  };
}

/**
 * Paramètres PAR SITE (`GET|PATCH /sites/{id}/parametres-atelier`, §8.2 dernier paragraphe) —
 * horaires, heure de clôture automatique des pointages (P-31), capacité horaire journalière
 * (P-20) et jours de fermeture. Distinct de `EcranParametrageAtelier` (singleton du TENANT) :
 * un garage multi-sites peut avoir des horaires différents par site.
 *
 * Sélection de site en ÉTAT LOCAL (pas de sous-route `/parametrage/sites/:id` — hors périmètre
 * de ce lot, `routes/**` appartient à un autre) : la liste vient de `session.sites` (déjà
 * chargée par toute page applicative, jamais un second `GET /sites` paginé pour ce qui est
 * typiquement une poignée de sites par tenant suisse). Le premier site actif est présélectionné
 * s'il n'y en a qu'un — l'écran d'un garage mono-site s'ouvre directement sur son formulaire,
 * jamais sur une liste à un seul élément à cliquer.
 */
export function EcranSites() {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const { data: session } = useSession();
  const sites = session?.sites ?? [];
  const [siteSelectionneId, setSiteSelectionneId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (siteSelectionneId === undefined && sites.length > 0) {
      setSiteSelectionneId(sites[0]?.id);
    }
  }, [sites, siteSelectionneId]);

  if (!session) {
    return (
      <GabaritEcran titre={t('parametrage:sites.titre')}>
        <EtatChargement lignes={6} />
      </GabaritEcran>
    );
  }

  return (
    <GabaritEcran titre={t('parametrage:sites.titre')}>
      {sites.length === 0 ? (
        <EtatVide
          titre={t('parametrage:sites.vide.titre')}
          description={t('parametrage:sites.vide.description')}
        />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          {sites.length > 1 ? (
            <nav
              aria-label={t('parametrage:sites.titre')}
              className="flex shrink-0 flex-col gap-1 lg:w-56"
            >
              {sites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  aria-current={site.id === siteSelectionneId ? 'true' : undefined}
                  onClick={() => setSiteSelectionneId(site.id)}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left texte-corps transition-colors',
                    site.id === siteSelectionneId
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted',
                  )}
                >
                  <span className="truncate">{site.nom}</span>
                  {!site.actif ? (
                    <Badge
                      variant="outline"
                      className={
                        site.id === siteSelectionneId ? 'border-primary-foreground/40' : undefined
                      }
                    >
                      {t('parametrage:sites.inactif')}
                    </Badge>
                  ) : null}
                </button>
              ))}
            </nav>
          ) : null}

          <div className="flex-1">
            {siteSelectionneId ? (
              <FormulaireSite
                key={siteSelectionneId}
                siteId={siteSelectionneId}
                actions={session.actions}
              />
            ) : null}
          </div>
        </div>
      )}
    </GabaritEcran>
  );
}

interface PropsFormulaireSite {
  readonly siteId: string;
  readonly actions: ActionsSession;
}

function FormulaireSite({ siteId, actions }: PropsFormulaireSite) {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const requete = useParametresSite(siteId);
  const peutEcrire = peutModifierParametrage(actions);

  if (requete.isPending) return <EtatChargement lignes={8} />;
  if (requete.isError) {
    return (
      <EtatErreur
        titre={t('erreurs:inattendue.titre')}
        description={messageErreur(requete.error, t)}
        onReessayer={() => void requete.refetch()}
      />
    );
  }

  return <FormulaireSiteContenu siteId={siteId} donnees={requete.data} peutEcrire={peutEcrire} />;
}

interface PropsFormulaireSiteContenu {
  readonly siteId: string;
  readonly donnees: ReponseParametresSite;
  readonly peutEcrire: boolean;
}

/** Le formulaire proprement dit, monté UNIQUEMENT une fois `donnees` disponible — même raison
 *  que `FormulaireParametresAtelier` (`EcranParametrageAtelier.tsx`) : `useForm({ values })`
 *  n'applique la valeur reçue qu'après le premier rendu, ce qui ferait passer les champs pilotés
 *  par `Controller` par un premier état `undefined`. Aucun `<Select>` Radix dans ce formulaire
 *  aujourd'hui (seulement des `<input type="time">` et `ChampTempsCentiemes`), donc l'effet
 *  observé sur `EcranParametrageAtelier` (select durablement bloqué en chaîne vide) n'a pas été
 *  constaté ici — la même construction est reprise par précaution, avant qu'un futur champ
 *  `<Select>` n'y soit ajouté sans que quiconque ne se souvienne de cette classe de bug. */
function FormulaireSiteContenu({ siteId, donnees, peutEcrire }: PropsFormulaireSiteContenu) {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const modifier = useModifierParametresSite();
  const [enregistre, setEnregistre] = useState(false);
  const [joursFermeture, setJoursFermeture] = useState<readonly string[]>(donnees.joursFermeture);
  const [nouveauJour, setNouveauJour] = useState('');

  const form = useForm<ValeursFormulaireSite>({ defaultValues: versValeursFormulaire(donnees) });

  // Dépendance limitée à `donnees.version`, même raison que `FormulaireParametresAtelier`
  // (`EcranParametrageAtelier.tsx`) : `donnees` change de référence à chaque rendu du parent.
  useEffect(() => {
    form.reset(versValeursFormulaire(donnees));
    setJoursFermeture(donnees.joursFermeture);
  }, [donnees.version]);

  const ajouterJourFermeture = () => {
    if (nouveauJour === '' || joursFermeture.includes(nouveauJour)) return;
    setJoursFermeture((valeur) => [...valeur, nouveauJour]);
    setNouveauJour('');
  };
  const retirerJourFermeture = (jour: string) => {
    setJoursFermeture((valeur) => valeur.filter((j) => j !== jour));
  };

  const soumettre = form.handleSubmit((valeurs) => {
    setEnregistre(false);
    modifier.mutate(
      { siteId, entree: versEntreeModification(valeurs, joursFermeture) },
      { onSuccess: () => setEnregistre(true) },
    );
  });

  return (
    <form onSubmit={soumettre} noValidate className="flex flex-col gap-6">
      {!peutEcrire ? (
        <Alert variant="avertissement">
          <AlertDescription>{t('parametrage:atelier.lectureSeule')}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('parametrage:sites.horaires.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ps-ouverture">{t('parametrage:sites.horaires.ouverture')}</Label>
              <Input
                id="ps-ouverture"
                type="time"
                disabled={!peutEcrire}
                {...form.register('heureOuverture')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ps-fermeture">{t('parametrage:sites.horaires.fermeture')}</Label>
              <Input
                id="ps-fermeture"
                type="time"
                disabled={!peutEcrire}
                {...form.register('heureFermeture')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ps-cloture-pointage">
                {t('parametrage:sites.horaires.cloturePointage')}
              </Label>
              <Input
                id="ps-cloture-pointage"
                type="time"
                disabled={!peutEcrire}
                {...form.register('heureCloturePointage')}
              />
            </div>
          </div>
          <p className="texte-libelle text-muted-foreground">
            {t('parametrage:sites.horaires.cloturePointageAide')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('parametrage:sites.capacite.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Controller
            control={form.control}
            name="capaciteHeuresJourCentiemes"
            render={({ field }) => (
              <ChampTempsCentiemes
                id="ps-capacite"
                label={t('parametrage:sites.capacite.champ')}
                disabled={!peutEcrire}
                // Même repli que `EcranParametrageAtelier` : `field.value` peut valoir
                // `undefined` avant que l'option `values` de `useForm` ne rattrape le premier
                // rendu.
                valeurCentiemes={field.value ?? null}
                onChangeCentiemes={field.onChange}
                className="max-w-xs"
              />
            )}
          />
          <p className="texte-libelle text-muted-foreground">
            {t('parametrage:sites.capacite.aide')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('parametrage:sites.fermeture.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="texte-corps text-muted-foreground">
            {t('parametrage:sites.fermeture.explication')}
          </p>
          {joursFermeture.length === 0 ? (
            <p className="texte-libelle text-muted-foreground">
              {t('parametrage:sites.fermeture.aucun')}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {[...joursFermeture].sort().map((jour) => (
                <li key={jour}>
                  <Badge variant="secondary" className="gap-1.5 py-1 pl-2.5 pr-1.5">
                    {formaterDate(jour)}
                    {peutEcrire ? (
                      <button
                        type="button"
                        onClick={() => retirerJourFermeture(jour)}
                        aria-label={t('parametrage:sites.fermeture.retirer', {
                          date: formaterDate(jour),
                        })}
                        className="rounded-full p-0.5 hover:bg-black/10"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    ) : null}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {peutEcrire ? (
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ps-nouveau-jour">{t('parametrage:sites.fermeture.ajouter')}</Label>
                <DateInput
                  id="ps-nouveau-jour"
                  value={nouveauJour}
                  onChange={(valeurISO: string | undefined) => setNouveauJour(valeurISO ?? '')}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={ajouterJourFermeture}
                disabled={nouveauJour === ''}
              >
                <Plus aria-hidden className="h-4 w-4" />
                {t('commun:actions.ajouter')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {modifier.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t('erreurs:inattendue.titre')}</AlertTitle>
          <AlertDescription>{messageErreur(modifier.error, t)}</AlertDescription>
        </Alert>
      ) : null}

      {peutEcrire ? (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={modifier.isPending}>
            {modifier.isPending ? t('commun:chargement.enCours') : t('commun:actions.enregistrer')}
          </Button>
          {enregistre && !modifier.isPending ? (
            <span className="flex items-center gap-1.5 texte-corps text-foreground">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {t('parametrage:sites.enregistrementReussi')}
            </span>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
