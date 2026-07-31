import { AlertTriangle, Clock3, Eye, Pencil, ShieldAlert, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  schemaModificationTravailReporte,
  URGENCES_TRAVAIL,
  type ReponseTravailReporte,
  type RoleUtilisateur,
  type StatutTravailReporte,
  type UrgenceTravail,
} from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { useSession } from '@/hooks/useSession';
import { formaterDate, formaterKilometrage, formaterMontant } from '@/lib/formats';
import { cn } from '@/lib/utils';

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
const ROLES_GESTION_TRAVAIL_REPORTE: ReadonlySet<RoleUtilisateur> = new Set([
  'receptionnaire',
  'chef_atelier',
  'direction',
  'admin',
]);

const CONFIG_URGENCE: Record<UrgenceTravail, { readonly icone: LucideIcon; readonly cle: string; readonly accentue: boolean }> = {
  urgent: { icone: AlertTriangle, cle: 'urgent', accentue: true },
  a_faire: { icone: Clock3, cle: 'aFaire', accentue: false },
  a_surveiller: { icone: Eye, cle: 'aSurveiller', accentue: false },
};

type Onglet = 'ouvert' | 'repris' | 'abandonne' | 'tous';

const ONGLETS: readonly Onglet[] = ['ouvert', 'repris', 'abandonne', 'tous'];

const CLES_ONGLET: Record<Onglet, string> = {
  ouvert: 'ouverts',
  repris: 'repris',
  abandonne: 'abandonnes',
  tous: 'tous',
};

const CLES_STATUT: Record<StatutTravailReporte, string> = {
  ouvert: 'ouvert',
  repris: 'repris',
  abandonne: 'abandonne',
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
}

/** Schéma d'édition — sous-ensemble PICKÉ du contrat gelé (`@dfa/shared`), jamais redéfini à la
 *  main : la validation de ce formulaire reste celle du serveur. */
const schemaEdition = schemaModificationTravailReporte.pick({
  designation: true,
  urgence: true,
  montantEstimeCentimes: true,
});

/**
 * Panneau de gestion des travaux reportés (RM-73) — PAS un écran routé : intégré dans
 * `EcranFicheVehicule.tsx`, à l'endroit où le réceptionnaire ouvre le dossier en accueillant le
 * client. Remplace `composants/vehicule/ListeTravauxReportes.tsx` (lecture seule, hors périmètre
 * de cet agent, laissé intact mais plus utilisé depuis la fiche) : celui-ci n'exposait que la
 * projection bornée de `contexte-atelier`, sans action. Ce panneau consomme la ressource DÉDIÉE
 * (`GET`/`PATCH .../travaux-reportes`), non bornée, avec les trois gestes RM-73 : corriger,
 * marquer comme repris (le client a accepté), abandonner (le client a refusé définitivement).
 *
 * SIGNALÉ, PAS CORRIGÉ (hors périmètre de cet agent, voir consigne de tâche) :
 *  - `ServiceLigneOr.refuserLignes` n'alimente pas encore la création d'un travail reporté depuis
 *    un refus de ligne d'OR — un refus client d'aujourd'hui n'apparaîtra donc pas ici tant que ce
 *    câblage n'existe pas côté `atelier`.
 *  - `vehicule_travail_reporte` n'est auditée par rien. Le champ `motif` de
 *    `EntreeModificationTravailReporte` (schéma partagé) en est un symptôme direct, vérifié en
 *    lisant `ServiceVehiculeTravailReporte.modifier` (`apps/api/src/vehicules/`) : la méthode
 *    accepte `entree.motif` (validé par le schéma) mais ne l'écrit dans AUCUNE colonne — un motif
 *    saisi au clôturage/à l'abandon serait silencieusement perdu. Ce panneau n'expose donc
 *    délibérément AUCUN champ « motif » : l'afficher promettrait une traçabilité qui n'existe pas.
 */
export function PanneauTravauxReportes({ vehiculeId, className }: Props) {
  const { t } = useTranslation(['vehicules', 'commun', 'erreurs']);
  const session = useSession();
  const requete = useTravauxReportesVehicule(vehiculeId);
  const modifier = useModifierTravailReporte(vehiculeId);

  const [onglet, setOnglet] = useState<Onglet>('ouvert');
  const [edition, setEdition] = useState<EtatEdition | null>(null);
  const [erreurEdition, setErreurEdition] = useState<string | null>(null);
  const [transition, setTransition] = useState<EtatTransition | null>(null);

  const role = session.data?.utilisateur.role;
  const peutGerer = role !== undefined && ROLES_GESTION_TRAVAIL_REPORTE.has(role);

  const travaux = requete.data ?? [];
  const compterParStatut = (statut: StatutTravailReporte) => travaux.filter((t2) => t2.statut === statut).length;

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
    setTransition({ travail, statutCible });
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
    // `onSettled`, PAS `onSuccess` seul : `AvertissementConfirmable` (composants/motifs/, hors
    // périmètre de cet agent) n'expose aucun emplacement pour une erreur inline — un échec laissé
    // avec le dialogue ouvert rendrait l'alerte du panneau INVISIBLE (Radix marque le reste de la
    // page `aria-hidden` tant qu'un `Dialog` est ouvert). Fermer systématiquement laisse l'alerte
    // `erreurMutation` du panneau (accessible, elle) porter le message d'échec.
    modifier.mutate(
      { travailId: transition.travail.id, entree: { statut: transition.statutCible } },
      { onSettled: () => setTransition(null) },
    );
  }

  if (requete.isPending) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('vehicules:travauxReportes.titre')}</CardTitle>
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
          <CardTitle className="texte-titre-section">{t('vehicules:travauxReportes.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          <EtatErreur
            titre={t(estErreurReseau ? 'erreurs:reseau.titre' : 'vehicules:travauxReportes.erreur.titre')}
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
      <CardHeader>
        <CardTitle className="texte-titre-section">{t('vehicules:travauxReportes.titre')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {erreurMutation ? (
          <Alert variant="destructive">
            <AlertTitle>{t('erreurs:inattendue.titre')}</AlertTitle>
            <AlertDescription>{messageErreur(erreurMutation, t)}</AlertDescription>
          </Alert>
        ) : null}

        {travaux.length === 0 ? (
          <EtatVide
            titre={t('vehicules:travauxReportes.titre')}
            description={t('vehicules:travauxReportes.vide.aucun')}
          />
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
                  <EtatVide
                    titre={t('vehicules:travauxReportes.titre')}
                    description={t('vehicules:travauxReportes.vide.onglet')}
                  />
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
                              urgence.accentue ? 'font-semibold text-foreground' : 'text-muted-foreground',
                            )}
                          >
                            <IconeUrgence aria-hidden className="h-3.5 w-3.5 shrink-0" />
                            {t(`vehicules:travauxReportes.urgences.${urgence.cle}`)}
                          </span>
                          {travail.securite ? (
                            <ShieldAlert aria-hidden className="h-4 w-4 shrink-0 text-foreground" />
                          ) : null}
                          <p className="flex-1 texte-corps font-medium">{travail.designation}</p>
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
                          {onglet === 'tous' ? (
                            <Badge variant="outline">
                              {t(`vehicules:travauxReportes.statuts.${CLES_STATUT[travail.statut]}`)}
                            </Badge>
                          ) : null}
                          {peutGerer ? (
                            <div className="flex shrink-0 flex-wrap gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => ouvrirEdition(travail)}>
                                <Pencil aria-hidden className="h-3.5 w-3.5" />
                                {t('vehicules:travauxReportes.actions.corriger')}
                              </Button>
                              {travail.statut === 'ouvert' ? (
                                <>
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

      <Dialog open={edition !== null} onOpenChange={(ouvert) => (ouvert ? undefined : fermerEdition())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('vehicules:travauxReportes.dialogue.corrigerTitre')}</DialogTitle>
          </DialogHeader>
          {edition ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tr-designation">{t('vehicules:travauxReportes.dialogue.designation')}</Label>
                <Input
                  id="tr-designation"
                  value={edition.designation}
                  onChange={(evenement) => setEdition({ ...edition, designation: evenement.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tr-urgence">{t('vehicules:travauxReportes.urgence')}</Label>
                <Select
                  value={edition.urgence}
                  onValueChange={(valeur) => setEdition({ ...edition, urgence: valeur as UrgenceTravail })}
                >
                  <SelectTrigger id="tr-urgence" aria-label={t('vehicules:travauxReportes.urgence')}>
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
                  onChangeCentimes={(centimes) => setEdition({ ...edition, montantCentimes: centimes })}
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

      <AvertissementConfirmable
        ouvert={transition !== null}
        onOuvertChange={(ouvert) => {
          if (!ouvert) setTransition(null);
        }}
        titre={
          transition?.statutCible === 'repris'
            ? t('vehicules:travauxReportes.dialogue.reprendreTitre')
            : t('vehicules:travauxReportes.dialogue.abandonnerTitre')
        }
        description={
          transition?.statutCible === 'repris'
            ? t('vehicules:travauxReportes.dialogue.reprendreDescription')
            : t('vehicules:travauxReportes.dialogue.abandonnerDescription')
        }
        libelleConfirmation={
          transition?.statutCible === 'repris'
            ? t('vehicules:travauxReportes.actions.reprendre')
            : t('vehicules:travauxReportes.actions.abandonner')
        }
        destructif={transition?.statutCible === 'abandonne'}
        onConfirmer={confirmerTransition}
        enCours={modifier.isPending}
      />
    </Card>
  );
}
