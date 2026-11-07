import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  PREREGLAGES,
  ROLES_PERSONNE,
  type GrilleCapacites,
  type IdPrereglage,
  type UtilisateurResume,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  depassementsAvantEnvoi,
  erreurPorteSurLaGrille,
  erreursGrilleDuServeur,
} from '@/composants/capacites/erreurs-grille';
import { diffCapacites, grilleDe } from '@/composants/capacites/grille';
import { SectionQuiPeutQuoi } from '@/composants/capacites/SectionQuiPeutQuoi';
import { useGrilleEditable } from '@/composants/capacites/useGrilleEditable';
import { useModeleCapacites, useModifierCapacites } from '@/hooks/parametrage/useCapacites';
import { useModifierUtilisateur } from '@/hooks/parametrage/useModifierUtilisateur';
import { useSiteImplicite } from '@/hooks/site/useSiteImplicite';
import { useSession } from '@/hooks/useSession';
import { ChampRoleEmploye } from './ChampRoleEmploye';
import { ChampSitePrincipal } from './ChampSitePrincipal';

interface Props {
  readonly employe: UtilisateurResume | null;
  readonly onFerme: () => void;
  /** Grille à restaurer (saisie perdue à la création) : remplace celle du serveur à l'ouverture. */
  readonly grilleARestaurer?: GrilleCapacites;
  /** Annonce que le compte vient d'être créé sans que ses droits aient pu être enregistrés. */
  readonly droitsNonEnregistres?: boolean;
}

/** Préréglage de départ d'un employé : celui que reconnaît le serveur, sinon celui de son rôle. */
function prereglageDe(employe: UtilisateurResume): IdPrereglage {
  return employe.capacites.prereglage ?? employe.role;
}

/**
 * Fiche d'un employé : poste (point de départ), sites, et « Qui peut quoi ». L'enregistrement
 * fait au plus deux appels : `PATCH /utilisateurs/{id}` si le poste ou les sites changent (le
 * serveur réapplique alors le préréglage), puis `PATCH …/capacites` avec les seuls écarts. Si le
 * second échoue, le premier est acquis et la saisie reste à l'écran. `employe === null` ferme le
 * dialogue.
 */
export function DialogueModifierEmploye({
  employe,
  onFerme,
  grilleARestaurer,
  droitsNonEnregistres = false,
}: Props) {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs', 'capacites']);
  const { data: session } = useSession();
  // Garage mono-site : le site est implicite, le champ n'est pas demandé.
  const { estMonoSite, siteId: siteImplicite, pret } = useSiteImplicite();
  const modifier = useModifierUtilisateur();
  const modifierCapacites = useModifierCapacites();
  const requeteModele = useModeleCapacites();
  const etat = useGrilleEditable({
    modele: requeteModele.data,
    prereglageInitial: employe ? prereglageDe(employe) : 'technicien',
    grilleInitiale: employe ? (grilleARestaurer ?? grilleDe(employe.capacites)) : undefined,
  });

  const [siteIds, setSiteIds] = useState<readonly string[]>([]);
  const [sitePrincipalId, setSitePrincipalId] = useState<string | undefined>(undefined);
  const [erreur, setErreur] = useState<unknown>(null);
  const [enCours, setEnCours] = useState(false);
  // Étape 1 (poste/sites) réussie : le poste de référence a changé, on ne la rejoue pas.
  const [posteAppliqueId, setPosteAppliqueId] = useState<IdPrereglage | null>(null);

  useEffect(() => {
    if (employe) {
      etat.reinitialiser(prereglageDe(employe), grilleARestaurer ?? grilleDe(employe.capacites));
      setSiteIds(employe.sites.map((s) => s.id));
      setSitePrincipalId(employe.sitePrincipalId ?? undefined);
      setErreur(null);
      setPosteAppliqueId(null);
      modifier.reset();
      modifierCapacites.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resynchronisation à l'ouverture seulement
  }, [employe?.id]);

  const sites = session?.sites ?? [];
  const siteIdsEffectifs: readonly string[] =
    estMonoSite && siteImplicite ? [siteImplicite] : siteIds;
  // Site principal effectif : le choix s'il figure parmi les sites cochés, sinon le premier.
  const sitesCoches = sites.filter((site) => siteIdsEffectifs.includes(site.id));
  const sitePrincipalEffectif = sitesCoches.some((site) => site.id === sitePrincipalId)
    ? sitePrincipalId
    : sitesCoches[0]?.id;
  const prereglagesProposes: readonly IdPrereglage[] = [
    ...ROLES_PERSONNE,
    'fiduciaire' as const,
  ].filter(
    (id) => id !== 'admin' || session?.utilisateur.role === 'admin' || employe?.role === 'admin',
  );
  const depassements = depassementsAvantEnvoi(session?.capacites, etat.grille, t);
  const erreursChamp = { ...depassements, ...erreursGrilleDuServeur(erreur, t) };
  // Tant que la session ou le modèle charge, on ne sait pas quoi envoyer : pas d'enregistrement.
  const formulaireValide =
    pret &&
    etat.grille !== undefined &&
    (estMonoSite || siteIdsEffectifs.length > 0) &&
    etat.incoherences.length === 0 &&
    Object.keys(depassements).length === 0;

  function basculerSite(siteId: string) {
    setSiteIds((valeur) =>
      valeur.includes(siteId) ? valeur.filter((id) => id !== siteId) : [...valeur, siteId],
    );
  }

  async function soumettre() {
    if (!employe || !formulaireValide || !etat.grille) return;
    setEnCours(true);
    setErreur(null);
    try {
      const posteDeReference = posteAppliqueId ?? prereglageDe(employe);
      const sitesInitiaux = employe.sites.map((s) => s.id);
      const sitesChanges =
        !estMonoSite &&
        (siteIdsEffectifs.length !== sitesInitiaux.length ||
          siteIdsEffectifs.some((id) => !sitesInitiaux.includes(id)));
      const posteChange = etat.prereglageId !== posteDeReference;
      const principalChange =
        !estMonoSite &&
        sitePrincipalEffectif !== undefined &&
        sitePrincipalEffectif !== (employe.sitePrincipalId ?? undefined);

      let grilleDeBase: GrilleCapacites = employe.capacites;
      if (posteAppliqueId !== null && etat.prereglage) grilleDeBase = etat.prereglage.grille;

      if (posteChange || ((sitesChanges || principalChange) && posteAppliqueId === null)) {
        await modifier.mutateAsync({
          utilisateurId: employe.id,
          entree: {
            ...(posteChange
              ? {
                  role: PREREGLAGES[etat.prereglageId].roleOrigine,
                  prereglage: etat.prereglageId,
                }
              : {}),
            ...(sitesChanges ? { siteIds: [...siteIdsEffectifs] } : {}),
            ...(principalChange ? { sitePrincipalId: sitePrincipalEffectif } : {}),
          },
        });
        if (posteChange) {
          setPosteAppliqueId(etat.prereglageId);
          grilleDeBase = etat.prereglage?.grille ?? grilleDeBase;
        }
      }

      const ecart = diffCapacites(grilleDeBase, etat.grille);
      if (ecart) {
        await modifierCapacites.mutateAsync({ utilisateurId: employe.id, entree: ecart });
      }
      onFerme();
    } catch (e) {
      setErreur(e);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={employe !== null} onOpenChange={(valeurOuverte) => !valeurOuverte && onFerme()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {employe
              ? t('parametrage:utilisateurs.modification.titre', {
                  nom: `${employe.prenom} ${employe.nom}`,
                })
              : ''}
          </DialogTitle>
          <DialogDescription>
            {t('parametrage:utilisateurs.modification.description')}
          </DialogDescription>
        </DialogHeader>

        {droitsNonEnregistres ? (
          <p className="texte-libelle text-destructive" role="alert">
            {t('parametrage:utilisateurs.creation.droitsNonEnregistres')}
          </p>
        ) : null}

        <div className="flex flex-col gap-4">
          <ChampRoleEmploye
            idPrefixe="modifier-employe"
            valeur={etat.prereglageId}
            prereglages={prereglagesProposes}
            onChange={etat.choisirPrereglage}
          />

          {estMonoSite ? null : (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="texte-corps font-medium">
                {t('parametrage:utilisateurs.creation.champSites')} *
              </legend>
              <div className="flex flex-col gap-2">
                {sites.map((site) => (
                  <div key={site.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`modifier-employe-site-${site.id}`}
                      checked={siteIds.includes(site.id)}
                      onCheckedChange={() => basculerSite(site.id)}
                    />
                    <Label htmlFor={`modifier-employe-site-${site.id}`} className="font-normal">
                      {site.nom}
                    </Label>
                  </div>
                ))}
              </div>
              {siteIds.length === 0 ? (
                <p className="texte-libelle text-muted-foreground">
                  {t('parametrage:utilisateurs.creation.sitesAucunSelectionne')}
                </p>
              ) : null}
            </fieldset>
          )}

          <ChampSitePrincipal
            idPrefixe="modifier-employe"
            sites={sitesCoches}
            valeur={sitePrincipalEffectif}
            onChange={setSitePrincipalId}
          />

          <SectionQuiPeutQuoi requete={requeteModele} etat={etat} erreursChamp={erreursChamp} />
        </div>

        {erreur && !erreurPorteSurLaGrille(erreur) ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreur(erreur, t)}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFerme} disabled={enCours}>
            {t('commun:actions.annuler')}
          </Button>
          <Button
            type="button"
            disabled={!formulaireValide || enCours}
            onClick={() => void soumettre()}
          >
            {enCours
              ? t('commun:chargement.enCours')
              : t('parametrage:utilisateurs.modification.actions.enregistrer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
