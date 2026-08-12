import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { DetailCollisionPlaqueVehicule, ReponseVehicule } from '@dfa/shared';

import { ErreurApi, ErreurReseau, messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAttribuerPlaqueVehicule } from '@/hooks/vehicules/useAttribuerPlaqueVehicule';
import { useModifierIdentiteVehicule } from '@/hooks/vehicules/useModifierIdentiteVehicule';
import { formaterDate } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

export interface ProprietesDialogueModifierIdentiteVehicule {
  readonly vehicule: Pick<ReponseVehicule, 'id' | 'vin' | 'plaque'>;
  /** `vehicule.plaque.gerer` (`droits.ts`) — DIFFÉRENT de `vehicule.modifier` : le magasinier a le
   *  second sans le premier (voir `peutGererPlaqueVehicule`). `false` masque la section plaque
   *  entièrement plutôt que de l'afficher pour la faire échouer en 403 à la soumission. */
  readonly peutGererPlaque: boolean;
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
}

function aujourdhuiIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Geste « Modifier » de la fiche véhicule — au minimum, compléter une IDENTIFICATION incomplète
 * (RM-16 : VIN absent -> `identificationIncomplete`) et attribuer une plaque à un véhicule qui
 * n'en porte aucune (RM-17). Défaut mesuré en test d'utilisabilité : un véhicule créé sans plaque
 * après un refus de saisie silencieux n'avait ENSUITE aucun moyen d'en recevoir une — la fiche
 * n'exposait aucun bouton « Modifier », et l'étiquette « Identification incomplète » ne menait
 * nulle part.
 *
 * Volontairement restreint à VIN + plaque/canton (pas version/finition/code type CH ni les champs
 * d'atelier) : `EcranNouveauVehicule.spec.tsx` documente déjà que « les champs avancés restent sur
 * la fiche » — un formulaire d'édition complet est un chantier distinct, hors du « au minimum »
 * demandé ici.
 *
 * Plaque/canton n'apparaissent que si `vehicule.plaque` est `null` — remplacer une plaque
 * EXISTANTE est un geste différent (clôture de l'ancienne, historisée) que ce dialogue ne couvre
 * pas ; `ServiceVehiculePlaque.cloturer` existe côté API mais n'a encore aucun écran, signalé
 * séparément plutôt que construit ici.
 *
 * Deux mutations INDÉPENDANTES (endpoints distincts, historisation distincte) déclenchées par UNE
 * seule soumission — chacune ne s'exécute que si sa section a une valeur à envoyer. Un échec sur
 * l'une n'empêche pas l'autre d'avoir déjà réussi ; le bandeau d'erreur nomme alors précisément ce
 * qui reste à corriger plutôt que de suggérer que rien n'a été enregistré.
 */
export function DialogueModifierIdentiteVehicule({
  vehicule,
  peutGererPlaque,
  ouvert,
  onOuvertChange,
}: ProprietesDialogueModifierIdentiteVehicule) {
  const { t } = useTranslation(['vehicules', 'commun', 'erreurs', 'validation']);
  const mutationIdentite = useModifierIdentiteVehicule(vehicule.id);
  const mutationPlaque = useAttribuerPlaqueVehicule(vehicule.id);

  const [vin, setVin] = useState(vehicule.vin ?? '');
  const [plaqueValeur, setPlaqueValeur] = useState('');
  const [canton, setCanton] = useState('');

  const plaqueAAttribuer = peutGererPlaque && vehicule.plaque === null;

  function reinitialiser() {
    setVin(vehicule.vin ?? '');
    setPlaqueValeur('');
    setCanton('');
    mutationIdentite.reset();
    mutationPlaque.reset();
  }

  function fermer(ouvertSuivant: boolean) {
    if (!ouvertSuivant) reinitialiser();
    onOuvertChange(ouvertSuivant);
  }

  const vinModifie = vin.trim() !== (vehicule.vin ?? '');
  const plaqueRenseignee = plaqueAAttribuer && plaqueValeur.trim() !== '';
  const pretASoumettre = vinModifie || plaqueRenseignee;

  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    if (!pretASoumettre) return;

    // La saisie n'est JAMAIS effacée avant d'avoir la confirmation du succès (règle non
    // négociable, CONTRIBUTING.md) : `reinitialiser()` n'est appelé qu'à l'intérieur de `fermer(false)`,
    // jamais ici avant coup.
    //
    // Le résultat de chaque mutation est capturé dans une variable LOCALE (`succesVin`/
    // `succesPlaque`), jamais relu sur `mutationIdentite.isSuccess`/`mutationPlaque.isSuccess`
    // après le `await` : ces deux objets viennent de la fermeture de CE rendu (celui d'avant la
    // soumission), figée au moment où `soumettre` a été défini — React ne la mute jamais en place,
    // il re-rend avec un NOUVEL objet. Lire `.isSuccess` ici revenait donc TOUJOURS à lire l'état
    // d'avant clic (`false`), et le dialogue ne se fermait jamais, même sur un succès réel des deux
    // mutations (bug mesuré : `EcranFicheVehicule.spec.tsx`, « répare une identification
    // incomplète… »).
    let succesVin = !vinModifie;
    let succesPlaque = !plaqueRenseignee;

    if (vinModifie) {
      try {
        await mutationIdentite.mutateAsync({ vin: vin.trim() === '' ? null : vin.trim() });
        succesVin = true;
      } catch {
        // Erreur déjà portée par `mutationIdentite.error`, rendue ci-dessous — rien à faire ici,
        // seulement empêcher la suite (plaque) de s'exécuter sur une transaction qu'on sait déjà
        // en échec serait correct aussi, mais les deux gestes sont indépendants (endpoints
        // distincts) : un VIN refusé ne doit pas bloquer une plaque par ailleurs valide.
      }
    }
    if (plaqueRenseignee) {
      try {
        await mutationPlaque.mutateAsync({
          valeur: plaqueValeur.trim(),
          canton: canton.trim() === '' ? null : canton.trim(),
          pays: 'CH',
          debutLe: aujourdhuiIso(),
          interchangeable: false,
          professionnelle: false,
        });
        succesPlaque = true;
      } catch {
        // Idem : erreur portée par `mutationPlaque.error`.
      }
    }

    if (succesVin && succesPlaque) {
      fermer(false);
    }
  }

  const enCours = mutationIdentite.isPending || mutationPlaque.isPending;

  // 409 VEHICULE_PLAQUE_COLLISION (RM-18, CT-06) : traité à part, SOUS le champ plaque (voir plus
  // bas), jamais dans le bandeau générique — sinon la réceptionniste voit un message anonyme
  // alors que le serveur a nommé le véhicule fautif. `erreurPlaque` figé dans une variable pour
  // que le contrôle de flux TypeScript (`instanceof`) reste valable à travers les deux constantes
  // qui en dépendent ci-dessous.
  const erreurPlaque = mutationPlaque.error;
  const erreurPlaqueEstCollision =
    erreurPlaque instanceof ErreurApi && erreurPlaque.probleme.code === 'VEHICULE_PLAQUE_COLLISION';
  // Présent seulement si la relecture serveur a retrouvé la ligne fautive (voir le commentaire de
  // tête de `DetailCollisionPlaqueVehicule`) — `donnees` est un `Record<string, unknown>`
  // générique côté contrat (`ElementBloquant`), jamais validé par zod ici : le cast est documenté,
  // pas deviné, la forme exacte étant posée par `service-vehicule-plaque.ts` uniquement pour ce
  // code précis.
  const detailCollisionPlaque: DetailCollisionPlaqueVehicule | undefined =
    erreurPlaque instanceof ErreurApi && erreurPlaqueEstCollision
      ? (erreurPlaque.blocages[0]?.donnees as DetailCollisionPlaqueVehicule | undefined)
      : undefined;

  const erreurPlaqueBandeau = erreurPlaqueEstCollision ? undefined : mutationPlaque.error;
  const erreur = mutationIdentite.error ?? erreurPlaqueBandeau;
  const estErreurReseau = erreur instanceof ErreurReseau;

  return (
    <Dialog open={ouvert} onOpenChange={fermer}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('vehicules:fiche.actions.modifierTitre')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={soumettre} className="flex flex-col gap-4">
          {erreur ? (
            <Alert variant={estErreurReseau ? 'avertissement' : 'destructive'}>
              <AlertTitle>
                {t(estErreurReseau ? 'erreurs:reseau.titre' : 'erreurs:inattendue.titre')}
              </AlertTitle>
              <AlertDescription>
                {mutationIdentite.error
                  ? `${t('vehicules:identite.vin')} : ${messageErreur(mutationIdentite.error, t)}`
                  : null}
                {mutationIdentite.error && erreurPlaqueBandeau ? <br /> : null}
                {erreurPlaqueBandeau
                  ? `${t('vehicules:identite.plaque')} : ${messageErreur(erreurPlaqueBandeau, t)}`
                  : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="modifier-vin">{t('vehicules:identite.vin')}</Label>
            <Input
              id="modifier-vin"
              readOnly={enCours}
              value={vin}
              onChange={(evenement) => setVin(evenement.target.value)}
            />
          </div>

          {plaqueAAttribuer ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="modifier-plaque">{t('vehicules:identite.plaque')}</Label>
                <Input
                  id="modifier-plaque"
                  readOnly={enCours}
                  placeholder={t('vehicules:identite.plaqueExemple')}
                  value={plaqueValeur}
                  onChange={(evenement) => setPlaqueValeur(evenement.target.value)}
                  aria-invalid={erreurPlaqueEstCollision ? true : undefined}
                  aria-describedby={
                    erreurPlaqueEstCollision ? 'modifier-plaque-collision-erreur' : undefined
                  }
                />
                <p className="texte-libelle text-muted-foreground">
                  {t('vehicules:identite.plaqueAide')}
                </p>
                {erreurPlaqueEstCollision ? (
                  <Alert
                    id="modifier-plaque-collision-erreur"
                    variant="destructive"
                    className="p-3"
                  >
                    <AlertDescription>
                      {detailCollisionPlaque ? (
                        <>
                          {t('vehicules:collisionPlaque.avecDetail', {
                            plaque: detailCollisionPlaque.plaque,
                            vehicule: `${detailCollisionPlaque.marque} ${detailCollisionPlaque.modele}${
                              detailCollisionPlaque.version
                                ? ` ${detailCollisionPlaque.version}`
                                : ''
                            }`,
                            debutLe: formaterDate(detailCollisionPlaque.debutLe),
                          })}{' '}
                          <Link
                            to={chemins.vehicules.detail(detailCollisionPlaque.vehiculeId)}
                            className="underline"
                          >
                            {t('vehicules:collisionPlaque.voirVehicule')}
                          </Link>
                        </>
                      ) : (
                        t('vehicules:collisionPlaque.sansDetail')
                      )}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="modifier-canton">{t('vehicules:plaques.canton')}</Label>
                <Input
                  id="modifier-canton"
                  readOnly={enCours}
                  maxLength={2}
                  placeholder={t('vehicules:plaques.cantonExemple')}
                  value={canton}
                  onChange={(evenement) => setCanton(evenement.target.value)}
                />
              </div>
            </div>
          ) : null}

          <Button type="submit" disabled={!pretASoumettre || enCours}>
            {t(enCours ? 'commun:chargement.enCours' : 'commun:actions.enregistrer')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
