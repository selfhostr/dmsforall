import { usePeut } from '@/droits';
import {
  AlertTriangle,
  Clock3,
  Eye,
  Pencil,
  Plus,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  schemaModificationTravailReporte,
  URGENCES_TRAVAIL,
  type ReponseTravailReporte,
  type StatutTravailReporte,
  type UrgenceTravail,
} from '@dfa/shared';

import { AideContextuelle } from '@/composants/AideContextuelle';
import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { formaterDate, formaterKilometrage, formaterMontant } from '@/lib/formats';
import { cn } from '@/lib/utils';

import { BadgeStatutTravailReporte } from './BadgeStatutTravailReporte';
import { BoutonReprendreDansOr } from './BoutonReprendreDansOr';
import { DialogueReporterTravail } from './DialogueReporterTravail';
import { useModifierTravailReporte } from './useModifierTravailReporte';
import { useTravauxReportesVehicule } from './useTravauxReportesVehicule';

/**
 * Rôles porteurs de `vehicule.travail_reporte.gerer` côté serveur (`matrice-droits.ts`,
 * `INFERE_VEHICULE_GESTION`) — REPRODUIT ici en pur affichage : cache les boutons d'action pour un
 * rôle qui recevrait de toute façon un `403`, la garde réelle reste `GardeDroit` côté serveur.
 * `ReponseTravailReporte` ne porte pas d'`actionsDisponibles` (à la différence de `ReponseOrdreReparation`,
 * voir `PanneauActionsOr.tsx`) : pas de signal serveur à consommer à la place de ce mirroir. À
 * FAIRE ÉVOLUER EN MÊME TEMPS que `matrice-droits.ts` si `vehicule.travail_reporte.gerer` change.
 */
const CONFIG_URGENCE: Record<
  UrgenceTravail,
  { readonly icone: LucideIcon; readonly cle: string; readonly accentue: boolean }
> = {
  urgent: { icone: AlertTriangle, cle: 'urgent', accentue: true },
  a_faire: { icone: Clock3, cle: 'aFaire', accentue: false },
  a_surveiller: { icone: Eye, cle: 'aSurveiller', accentue: false },
};

/** Rôles porteurs de `vehicule.travail_reporte.signaler` (`matrice-droits.ts`) — le technicien
 *  note ce qu'il voit sous le capot, sans pouvoir clore ni corriger. Miroir d'affichage. */
type Onglet = 'ouvert' | 'repris' | 'abandonne' | 'tous';

const ONGLETS: readonly Onglet[] = ['ouvert', 'repris', 'abandonne', 'tous'];

const CLES_ONGLET: Record<Onglet, string> = {
  ouvert: 'ouverts',
  repris: 'repris',
  abandonne: 'abandonnes',
  tous: 'tous',
};

interface Props {
  readonly vehiculeId: string;
  readonly className?: string;
}

interface EtatEdition {
  readonly travail: ReponseTravailReporte;
  designation: string;
  urgence: UrgenceTravail;
  montantCentimes: number | null;
}

interface EtatTransition {
  readonly travail: ReponseTravailReporte;
  readonly statutCible: 'repris' | 'abandonne';
  /** Saisie contrôlée du motif de clôture/abandon — facultative (`schemaMotif.optional()` côté
   *  contrat), state en `string` (jamais `null`) pour rester un composant contrôlé standard ; la
   *  chaîne vide est normalisée en `undefined` avant validation, voir `confirmerTransition`. */
  motif: string;
}

/** Schéma d'édition — sous-ensemble PICKÉ du contrat gelé (`@dfa/shared`), jamais redéfini à la
 *  main : la validation de ce formulaire reste celle du serveur. */
const schemaEdition = schemaModificationTravailReporte.pick({
  designation: true,
  urgence: true,
  montantEstimeCentimes: true,
});

/** Même doctrine que `schemaEdition` : sous-ensemble pické du contrat, jamais une validation
 *  réécrite à la main. `motif` est optionnel (`schemaMotif.optional()`, min 3 caractères s'il est
 *  fourni) — reprendre/abandonner un travail SANS motif reste un cas normal, non forcé. */
const schemaTransition = schemaModificationTravailReporte.pick({
  statut: true,
  motif: true,
});

/**
 * Panneau de gestion des travaux reportés (RM-73) — PAS un écran routé : intégré dans
 * `EcranFicheVehicule.tsx`, à l'endroit où le réceptionnaire ouvre le dossier en accueillant le
 * client. Remplace `composants/vehicule/ListeTravauxReportes.tsx` (lecture seule, hors périmètre
 * de ce lot, laissé intact mais plus utilisé depuis la fiche) : celui-ci n'exposait que la
 * projection bornée de `contexte-atelier`, sans action. Ce panneau consomme la ressource DÉDIÉE
 * (`GET`/`PATCH .../travaux-reportes`), non bornée, avec les trois gestes RM-73 : corriger,
 * marquer comme repris (le client a accepté), abandonner (le client a refusé définitivement).
 *
 * SIGNALÉ, PAS CORRIGÉ (hors périmètre de ce lot, voir consigne de tâche) :
 *  - `ServiceLigneOr.refuserLignes` n'alimente pas encore la création d'un travail reporté depuis
 *    un refus de ligne d'OR — un refus client d'aujourd'hui n'apparaîtra donc pas ici tant que ce
 *    câblage n'existe pas côté `atelier`.
 *
 * MOTIF DE CLÔTURE/ABANDON (`motif_modification`, migrations/0033) — REBRANCHÉ ICI : la colonne
 * existe, `ServiceVehiculeTravailReporte.modifier` l'écrit, `vehicule_travail_reporte` est
 * désormais auditée (trigger `vehicule_travail_reporte_audit`), et `ReponseTravailReporte` porte
 * `motifModification` en lecture (non filtré par rôle, à la différence de
 * `montantEstimeCentimes` — voir le commentaire de `versReponseTravailReporte`,
 * `apps/api/src/vehicules/service-vehicule-travail-reporte.ts`, pour l'argument complet). Ce
 * panneau saisit le motif au moment de reprendre/abandonner (dialogue de transition, facultatif)
 * et l'affiche sur tout travail déjà `repris`/`abandonne` qui en porte un — jamais sur un travail
 * `ouvert`, qui n'a par construction encore aucun motif de clôture.
 */
export function PanneauTravauxReportes({ vehiculeId, className }: Props) {
  const { t } = useTranslation(['vehicules', 'commun', 'erreurs']);
  const requete = useTravauxReportesVehicule(vehiculeId);
  const modifier = useModifierTravailReporte(vehiculeId);

  const [onglet, setOnglet] = useState<Onglet>('ouvert');
  const [edition, setEdition] = useState<EtatEdition | null>(null);
  const [erreurEdition, setErreurEdition] = useState<string | null>(null);
  const [reporterOuvert, setReporterOuvert] = useState(false);
  const [transition, setTransition] = useState<EtatTransition | null>(null);
  const [erreurTransition, setErreurTransition] = useState<string | null>(null);

  const peutGerer = usePeut('vehicule.travail_reporte.gerer');
  const peutSignaler = usePeut('vehicule.travail_reporte.signaler');

  const travaux = requete.data ?? [];
  const compterParStatut = (statut: StatutTravailReporte) =>
    travaux.filter((t2) => t2.statut === statut).length;

  const travauxOnglet = onglet === 'tous' ? travaux : travaux.filter((t2) => t2.statut === onglet);

  function ouvrirEdition(travail: ReponseTravailReporte) {
    setErreurEdition(null);
    // Purge un éventuel état d'erreur laissé par une PRÉCÉDENTE mutation (une transition
    // reprendre/abandonner ratée sur une autre ligne, par ex.) — sans ce `reset()`, ce dialogue
    // afficherait un message d'échec qui ne concerne pas cette édition-ci.
    modifier.reset();
    setEdition({
      travail,
      designation: travail.designation,
      urgence: travail.urgence,
      montantCentimes: travail.montantEstimeCentimes ?? null,
    });
  }

  function fermerEdition() {
    setEdition(null);
    setErreurEdition(null);
  }

  function ouvrirTransition(travail: ReponseTravailReporte, statutCible: 'repris' | 'abandonne') {
    modifier.reset();
    setErreurTransition(null);
    setTransition({ travail, statutCible, motif: '' });
  }

  function fermerTransition() {
    setTransition(null);
    setErreurTransition(null);
  }

  function soumettreEdition() {
    if (!edition) return;
    const voitMontant = edition.travail.montantEstimeCentimes !== undefined;
    const resultat = schemaEdition.safeParse({
      designation: edition.designation,
      urgence: edition.urgence,
      montantEstimeCentimes: voitMontant ? edition.montantCentimes : undefined,
    });
    if (!resultat.success) {
      setErreurEdition(t('vehicules:travauxReportes.dialogue.erreurValidation'));
      return;
    }
    setErreurEdition(null);
    modifier.mutate(
      { travailId: edition.travail.id, entree: resultat.data },
      { onSuccess: fermerEdition },
    );
  }

  function confirmerTransition() {
    if (!transition) return;
    const motifTrim = transition.motif.trim();
    const resultat = schemaTransition.safeParse({
      statut: transition.statutCible,
      motif: motifTrim.length > 0 ? motifTrim : undefined,
    });
    if (!resultat.success) {
      // Validation CLIENT du motif (min 3 caractères s'il est renseigné, `schemaMotif`) : erreur
      // inline, dialogue laissé OUVERT — à la différence de l'échec serveur ci-dessous, rien n'a
      // encore été envoyé, fermer perdrait la saisie sans raison.
      setErreurTransition(t('vehicules:travauxReportes.dialogue.erreurValidationMotif'));
      return;
    }
    setErreurTransition(null);
    // `onSettled`, PAS `onSuccess` seul : un échec SERVEUR laissé avec le dialogue ouvert
    // rendrait l'alerte du panneau INVISIBLE (Radix marque le reste de la page `aria-hidden` tant
    // qu'un `Dialog` est ouvert). Fermer systématiquement laisse l'alerte `erreurMutation` du
    // panneau (accessible, elle) porter le message d'échec.
    modifier.mutate(
      { travailId: transition.travail.id, entree: resultat.data },
      { onSettled: fermerTransition },
    );
  }

  if (requete.isPending) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('vehicules:travauxReportes.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EtatChargement lignes={3} />
        </CardContent>
      </Card>
    );
  }

  if (requete.isError) {
    const estErreurReseau = requete.error instanceof ErreurReseau;
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('vehicules:travauxReportes.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EtatErreur
            titre={t(
              estErreurReseau ? 'erreurs:reseau.titre' : 'vehicules:travauxReportes.erreur.titre',
            )}
            description={messageErreur(requete.error, t)}
            onReessayer={() => void requete.refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  const erreurMutation = modifier.isError ? modifier.error : null;

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <CardTitle className="texte-titre-section">
            {t('vehicules:travauxReportes.titre')}
          </CardTitle>
          <AideContextuelle
            sujet={t('vehicules:travauxReportes.titre')}
            texte={t('aide:vehicules.travauxReportes')}
          />
        </div>
        {peutSignaler ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setReporterOuvert(true)}>
            <Plus aria-hidden className="h-4 w-4" />
            {t('vehicules:travauxReportes.reporter.bouton')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <DialogueReporterTravail
          vehiculeId={vehiculeId}
          ouvert={reporterOuvert}
          onOuvertChange={setReporterOuvert}
        />
        {erreurMutation ? (
          <Alert variant="destructive">
            <AlertTitle>{t('erreurs:inattendue.titre')}</AlertTitle>
            <AlertDescription>{messageErreur(erreurMutation, t)}</AlertDescription>
          </Alert>
        ) : null}

        {travaux.length === 0 ? (
          <EtatVide description={t('vehicules:travauxReportes.vide.aucun')} />
        ) : (
          <Tabs value={onglet} onValueChange={(valeur) => setOnglet(valeur as Onglet)}>
            <TabsList>
              {ONGLETS.map((cle) => (
                <TabsTrigger key={cle} value={cle}>
                  {t(`vehicules:travauxReportes.onglets.${CLES_ONGLET[cle]}`)}
                  {cle !== 'tous' ? ` (${compterParStatut(cle)})` : ` (${travaux.length})`}
                </TabsTrigger>
              ))}
            </TabsList>
            {ONGLETS.map((cle) => (
              <TabsContent key={cle} value={cle}>
                {travauxOnglet.length === 0 ? (
                  <EtatVide description={t('vehicules:travauxReportes.vide.onglet')} />
                ) : (
                  <ul className="flex flex-col divide-y">
                    {travauxOnglet.map((travail) => {
                      const urgence = CONFIG_URGENCE[travail.urgence];
                      const IconeUrgence = urgence.icone;
                      return (
                        <li key={travail.id} className="flex flex-wrap items-center gap-3 py-3">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full border border-input bg-background px-2.5 py-0.5 texte-libelle font-medium',
                              urgence.accentue
                                ? 'font-semibold text-foreground'
                                : 'text-muted-foreground',
                            )}
                          >
                            <IconeUrgence aria-hidden className="h-3.5 w-3.5 shrink-0" />
                            {t(`vehicules:travauxReportes.urgences.${urgence.cle}`)}
                          </span>
                          {travail.securite ? (
                            <ShieldAlert aria-hidden className="h-4 w-4 shrink-0 text-foreground" />
                          ) : null}
                          <p className="flex-1 texte-corps font-medium">{travail.designation}</p>
                          {travail.detail ? (
                            <p className="basis-full texte-libelle text-muted-foreground">
                              {travail.detail}
                            </p>
                          ) : null}
                          <p className="texte-libelle text-muted-foreground">
                            {formaterDate(travail.constateLe)}
                            {travail.kilometrageAlors !== null
                              ? ` · ${formaterKilometrage(travail.kilometrageAlors, 'km')}`
                              : ''}
                          </p>
                          {travail.montantEstimeCentimes != null ? (
                            <p className="texte-donnee-proeminente font-semibold">
                              {formaterMontant(travail.montantEstimeCentimes)}
                            </p>
                          ) : null}
                          {/* `motifModification` : jamais sur un travail `ouvert` (pas encore de
                           *  motif de clôture par construction), affiché en pleine largeur
                           *  (`basis-full`) pour ne pas se mêler aux badges/actions de la ligne. */}
                          {travail.statut !== 'ouvert' && travail.motifModification ? (
                            <p className="basis-full texte-libelle text-muted-foreground">
                              <span className="font-medium text-foreground">
                                {t('vehicules:travauxReportes.motifModification.libelle')}
                              </span>{' '}
                              {travail.motifModification}
                            </p>
                          ) : null}
                          {onglet === 'tous' ? (
                            <BadgeStatutTravailReporte statut={travail.statut} />
                          ) : null}
                          {peutGerer ? (
                            <div className="flex shrink-0 flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => ouvrirEdition(travail)}
                              >
                                <Pencil aria-hidden className="h-3.5 w-3.5" />
                                {t('vehicules:travauxReportes.actions.corriger')}
                              </Button>
                              {travail.statut === 'ouvert' ? (
                                <>
                                  <BoutonReprendreDansOr
                                    vehiculeId={vehiculeId}
                                    travail={travail}
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => ouvrirTransition(travail, 'repris')}
                                  >
                                    {t('vehicules:travauxReportes.actions.reprendre')}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => ouvrirTransition(travail, 'abandonne')}
                                  >
                                    {t('vehicules:travauxReportes.actions.abandonner')}
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </CardContent>

      <Dialog
        open={edition !== null}
        onOpenChange={(ouvert) => (ouvert ? undefined : fermerEdition())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('vehicules:travauxReportes.dialogue.corrigerTitre')}</DialogTitle>
          </DialogHeader>
          {edition ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tr-designation">
                  {t('vehicules:travauxReportes.dialogue.designation')}
                </Label>
                <Input
                  id="tr-designation"
                  value={edition.designation}
                  onChange={(evenement) =>
                    setEdition({ ...edition, designation: evenement.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tr-urgence">{t('vehicules:travauxReportes.urgence')}</Label>
                <Select
                  value={edition.urgence}
                  onValueChange={(valeur) =>
                    setEdition({ ...edition, urgence: valeur as UrgenceTravail })
                  }
                >
                  <SelectTrigger
                    id="tr-urgence"
                    aria-label={t('vehicules:travauxReportes.urgence')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {URGENCES_TRAVAIL.map((valeur) => (
                      <SelectItem key={valeur} value={valeur}>
                        {t(`vehicules:travauxReportes.urgences.${CONFIG_URGENCE[valeur].cle}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {edition.travail.montantEstimeCentimes !== undefined ? (
                <ChampMontant
                  id="tr-montant"
                  valeurCentimes={edition.montantCentimes}
                  onChangeCentimes={(centimes) =>
                    setEdition({ ...edition, montantCentimes: centimes })
                  }
                  label={t('vehicules:travauxReportes.montant')}
                />
              ) : null}
              {/* Erreur INLINE, dans le dialogue lui-même — pas seulement l'alerte du panneau
               *  (`erreurMutation` ci-dessus) : ce dialogue reste ouvert après un échec serveur
               *  (contrairement au dialogue de transition), l'alerte du panneau serait donc
               *  `aria-hidden` tant qu'il reste ouvert (même raison que `confirmerTransition`). */}
              {erreurEdition ? (
                <p className="texte-libelle text-destructive">{erreurEdition}</p>
              ) : modifier.isError ? (
                <p className="texte-libelle text-destructive">{messageErreur(modifier.error, t)}</p>
              ) : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('commun:actions.annuler')}</Button>
                </DialogClose>
                <Button disabled={modifier.isPending} onClick={soumettreEdition}>
                  {t('vehicules:travauxReportes.actions.enregistrer')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/*
       * Dialogue de transition — Dialog CONSTRUIT ICI plutôt que `composants/motifs/
       * AvertissementConfirmable.tsx` (hors périmètre de ce lot) : ce composant générique
       * n'expose aucun emplacement pour une saisie, et la migration 0033 exige justement d'en
       * accueillir une (le motif de clôture/abandon, facultatif). Même doctrine `onOpenChange`/
       * `onSettled` que le dialogue d'édition ci-dessus.
       */}
      <Dialog
        open={transition !== null}
        onOpenChange={(ouvert) => (ouvert ? undefined : fermerTransition())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {transition?.statutCible === 'repris'
                ? t('vehicules:travauxReportes.dialogue.reprendreTitre')
                : t('vehicules:travauxReportes.dialogue.abandonnerTitre')}
            </DialogTitle>
            <DialogDescription>
              {transition?.statutCible === 'repris'
                ? t('vehicules:travauxReportes.dialogue.reprendreDescription')
                : t('vehicules:travauxReportes.dialogue.abandonnerDescription')}
            </DialogDescription>
          </DialogHeader>
          {transition ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tr-motif-transition">
                  {t('vehicules:travauxReportes.dialogue.motifLabel')}
                </Label>
                <Textarea
                  id="tr-motif-transition"
                  value={transition.motif}
                  placeholder={t('vehicules:travauxReportes.dialogue.motifPlaceholder')}
                  onChange={(evenement) =>
                    setTransition({ ...transition, motif: evenement.target.value })
                  }
                />
              </div>
              {/* Erreur INLINE de validation CLIENT du motif uniquement : un échec SERVEUR ferme
               *  systématiquement ce dialogue (`onSettled`, voir `confirmerTransition`), cette
               *  branche ne serait donc jamais visible avant que le dialogue ne se ferme — l'alerte
               *  `erreurMutation` du panneau porte alors ce cas, comme pour toute autre mutation. */}
              {erreurTransition ? (
                <p className="texte-libelle text-destructive">{erreurTransition}</p>
              ) : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('commun:actions.annuler')}</Button>
                </DialogClose>
                <Button
                  variant={transition.statutCible === 'abandonne' ? 'destructive' : 'default'}
                  disabled={modifier.isPending}
                  onClick={confirmerTransition}
                >
                  {transition.statutCible === 'repris'
                    ? t('vehicules:travauxReportes.actions.reprendre')
                    : t('vehicules:travauxReportes.actions.abandonner')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
