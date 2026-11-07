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
import { Input } from '@/components/ui/input';
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import { ChampRoleEmploye } from './ChampRoleEmploye';
import { diffCapacites } from '@/composants/capacites/grille';
import {
  depassementsAvantEnvoi,
  erreurPorteSurLaGrille,
  erreursGrilleDuServeur,
} from '@/composants/capacites/erreurs-grille';
import { SectionQuiPeutQuoi } from '@/composants/capacites/SectionQuiPeutQuoi';
import { useGrilleEditable } from '@/composants/capacites/useGrilleEditable';
import { useModeleCapacites, useModifierCapacites } from '@/hooks/parametrage/useCapacites';
import { useCreerUtilisateur } from '@/hooks/parametrage/useCreerUtilisateur';
import { useSiteImplicite } from '@/hooks/site/useSiteImplicite';
import { useSession } from '@/hooks/useSession';

interface Props {
  readonly ouvert: boolean;
  readonly onFerme: () => void;
  /** Reçoit le mot de passe temporaire à la création réussie — c'est l'écran appelant qui décide
   *  de l'afficher (`DialogueAccesTemporaire`), ce dialogue ne le montre jamais lui-même. */
  readonly onCree: (motDePasseTemporaire: string) => void;
  /** Le compte existe mais ses droits personnalisés n'ont pas pu être enregistrés : l'écran
   *  rouvre la fiche avec la grille saisie, rien n'est perdu. */
  readonly onDroitsARevoir?: (employe: UtilisateurResume, grille: GrilleCapacites) => void;
  /** Point de départ imposé à l'ouverture (ex. `fiduciaire` : création en un clic). */
  readonly prereglageInitial?: IdPrereglage;
}

/**
 * `POST /utilisateurs` — créer un employé (issue #137). Aucun champ mot de passe : le serveur en
 * génère un, voir `DialogueAccesTemporaire`. Le sélecteur de rôle EXCLUT `admin` pour un acteur
 * `direction` (prévient l'erreur avant l'envoi — la garde qui compte reste côté serveur,
 * `auth/gouvernance-roles.ts`, testée indépendamment).
 */
export function DialogueNouvelEmploye({
  ouvert,
  onFerme,
  onCree,
  onDroitsARevoir,
  prereglageInitial = 'technicien',
}: Props) {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs', 'capacites']);
  const { data: session } = useSession();
  // Garage mono-site : le site est implicite, le champ n'est pas demandé.
  const { estMonoSite, siteId: siteImplicite } = useSiteImplicite();
  const creer = useCreerUtilisateur();
  const modifierCapacites = useModifierCapacites();
  const requeteModele = useModeleCapacites();
  const etat = useGrilleEditable({ modele: requeteModele.data, prereglageInitial });

  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [siteIds, setSiteIds] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!ouvert) {
      setPrenom('');
      setNom('');
      setEmail('');
      etat.reinitialiser(prereglageInitial);
      setSiteIds([]);
      creer.reset();
      modifierCapacites.reset();
    } else {
      etat.reinitialiser(prereglageInitial);
      // Compte fiduciaire en un clic : il lui faut tous les sites sans rien cocher.
      if (prereglageInitial === 'fiduciaire') setSiteIds((session?.sites ?? []).map((x) => x.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- réinitialisation à la fermeture seulement
  }, [ouvert]);

  const sites = session?.sites ?? [];
  const siteIdsEffectifs: readonly string[] =
    estMonoSite && siteImplicite ? [siteImplicite] : siteIds;
  // `direction` ne peut jamais créer d'`admin` (auth/gouvernance-roles.ts) — l'option n'apparaît
  // même pas dans le sélecteur pour ce rôle, seul `admin` peut créer un autre `admin`.
  const prereglagesProposes: readonly IdPrereglage[] = [
    ...ROLES_PERSONNE,
    'fiduciaire' as const,
  ].filter((id) => id !== 'admin' || session?.utilisateur.role === 'admin');
  const erreursChamp = {
    ...depassementsAvantEnvoi(session?.capacites, etat.grille, t),
    ...erreursGrilleDuServeur(creer.error ?? modifierCapacites.error, t),
  };
  const grilleValide =
    etat.grille !== undefined &&
    etat.incoherences.length === 0 &&
    Object.keys(depassementsAvantEnvoi(session?.capacites, etat.grille, t)).length === 0;
  const erreurGenerale = creer.error ?? modifierCapacites.error;

  const formulaireValide =
    prenom.trim() !== '' &&
    nom.trim() !== '' &&
    email.trim() !== '' &&
    siteIdsEffectifs.length > 0 &&
    grilleValide;

  function basculerSite(siteId: string) {
    setSiteIds((valeur) =>
      valeur.includes(siteId) ? valeur.filter((id) => id !== siteId) : [...valeur, siteId],
    );
  }

  function soumettre() {
    if (!formulaireValide || !etat.grille) return;
    const grilleSaisie = etat.grille;
    creer.mutate(
      {
        prenom: prenom.trim(),
        nom: nom.trim(),
        email: email.trim(),
        role: PREREGLAGES[etat.prereglageId].roleOrigine,
        prereglage: etat.prereglageId,
        siteIds: [...siteIdsEffectifs],
      },
      {
        onSuccess: (reponse) => {
          const ecart = etat.personnalisee
            ? diffCapacites(reponse.utilisateur.capacites, grilleSaisie)
            : null;
          if (!ecart) {
            onCree(reponse.acces.motDePasseTemporaire);
            onFerme();
            return;
          }
          modifierCapacites.mutate(
            { utilisateurId: reponse.utilisateur.id, entree: ecart },
            {
              onSuccess: () => {
                onCree(reponse.acces.motDePasseTemporaire);
                onFerme();
              },
              onError: () => {
                onCree(reponse.acces.motDePasseTemporaire);
                onDroitsARevoir?.(reponse.utilisateur, grilleSaisie);
                onFerme();
              },
            },
          );
        },
      },
    );
  }

  return (
    <Dialog open={ouvert} onOpenChange={(valeurOuverte) => !valeurOuverte && onFerme()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {prereglageInitial === 'fiduciaire'
              ? t('parametrage:utilisateurs.fiduciaire.titre')
              : t('parametrage:utilisateurs.creation.titre')}
          </DialogTitle>
          <DialogDescription>
            {prereglageInitial === 'fiduciaire'
              ? t('parametrage:utilisateurs.fiduciaire.description')
              : t('parametrage:utilisateurs.creation.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <LegendeChampsObligatoires>
            {t('parametrage:obligatoire.legende')}
          </LegendeChampsObligatoires>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nouvel-employe-prenom" requis>
                {t('parametrage:utilisateurs.creation.champPrenom')}
              </Label>
              <Input
                id="nouvel-employe-prenom"
                value={prenom}
                maxLength={100}
                aria-required="true"
                onChange={(e) => setPrenom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nouvel-employe-nom" requis>
                {t('parametrage:utilisateurs.creation.champNom')}
              </Label>
              <Input
                id="nouvel-employe-nom"
                value={nom}
                maxLength={100}
                aria-required="true"
                onChange={(e) => setNom(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nouvel-employe-email" requis>
              {t('parametrage:utilisateurs.creation.champEmail')}
            </Label>
            <Input
              id="nouvel-employe-email"
              type="email"
              value={email}
              maxLength={320}
              aria-required="true"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <ChampRoleEmploye
            idPrefixe="nouvel-employe"
            valeur={etat.prereglageId}
            prereglages={prereglagesProposes}
            onChange={etat.choisirPrereglage}
          />

          {estMonoSite ? null : (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="texte-corps font-medium">
                {t('parametrage:utilisateurs.creation.champSites')}
                <span aria-hidden="true" className="ml-0.5">
                  *
                </span>
              </legend>
              {sites.length === 0 ? (
                <p className="texte-libelle text-muted-foreground">
                  {t('parametrage:utilisateurs.creation.aucunSiteDisponible')}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {sites.map((site) => (
                    <div key={site.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`nouvel-employe-site-${site.id}`}
                        checked={siteIds.includes(site.id)}
                        onCheckedChange={() => basculerSite(site.id)}
                      />
                      <Label htmlFor={`nouvel-employe-site-${site.id}`} className="font-normal">
                        {site.nom}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
              {siteIds.length === 0 ? (
                <p className="texte-libelle text-muted-foreground">
                  {t('parametrage:utilisateurs.creation.sitesAucunSelectionne')}
                </p>
              ) : null}
            </fieldset>
          )}

          <SectionQuiPeutQuoi requete={requeteModele} etat={etat} erreursChamp={erreursChamp} />
        </div>

        {erreurGenerale && !erreurPorteSurLaGrille(erreurGenerale) ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreur(erreurGenerale, t)}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onFerme}
            disabled={creer.isPending || modifierCapacites.isPending}
          >
            {t('commun:actions.annuler')}
          </Button>
          <Button
            type="button"
            disabled={!formulaireValide || creer.isPending || modifierCapacites.isPending}
            onClick={soumettre}
          >
            {creer.isPending || modifierCapacites.isPending
              ? t('commun:chargement.enCours')
              : t('parametrage:utilisateurs.creation.actions.creer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
