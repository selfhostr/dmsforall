import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ROLES_PERSONNE, type RolePersonne } from '@dfa/shared';

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
import { Label } from '@/components/ui/label';
import { ChampRoleEmploye } from './ChampRoleEmploye';
import { useCreerUtilisateur } from '@/hooks/parametrage/useCreerUtilisateur';
import { useSiteImplicite } from '@/hooks/site/useSiteImplicite';
import { useSession } from '@/hooks/useSession';

interface Props {
  readonly ouvert: boolean;
  readonly onFerme: () => void;
  /** Reçoit le mot de passe temporaire à la création réussie — c'est l'écran appelant qui décide
   *  de l'afficher (`DialogueAccesTemporaire`), ce dialogue ne le montre jamais lui-même. */
  readonly onCree: (motDePasseTemporaire: string) => void;
}

/**
 * `POST /utilisateurs` — créer un employé (issue #137). Aucun champ mot de passe : le serveur en
 * génère un, voir `DialogueAccesTemporaire`. Le sélecteur de rôle EXCLUT `admin` pour un acteur
 * `direction` (prévient l'erreur avant l'envoi — la garde qui compte reste côté serveur,
 * `auth/gouvernance-roles.ts`, testée indépendamment).
 */
export function DialogueNouvelEmploye({ ouvert, onFerme, onCree }: Props) {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const { data: session } = useSession();
  // Garage mono-site : le site est implicite, le champ n'est pas demandé.
  const { estMonoSite, siteId: siteImplicite } = useSiteImplicite();
  const creer = useCreerUtilisateur();

  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<RolePersonne>('technicien');
  const [siteIds, setSiteIds] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!ouvert) {
      setPrenom('');
      setNom('');
      setEmail('');
      setRole('technicien');
      setSiteIds([]);
      creer.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- réinitialisation à la fermeture seulement
  }, [ouvert]);

  const sites = session?.sites ?? [];
  const siteIdsEffectifs: readonly string[] =
    estMonoSite && siteImplicite ? [siteImplicite] : siteIds;
  // `direction` ne peut jamais créer d'`admin` (auth/gouvernance-roles.ts) — l'option n'apparaît
  // même pas dans le sélecteur pour ce rôle, seul `admin` peut créer un autre `admin`.
  const rolesProposes = ROLES_PERSONNE.filter(
    (r) => r !== 'admin' || session?.utilisateur.role === 'admin',
  );

  const formulaireValide =
    prenom.trim() !== '' && nom.trim() !== '' && email.trim() !== '' && siteIdsEffectifs.length > 0;

  function basculerSite(siteId: string) {
    setSiteIds((valeur) =>
      valeur.includes(siteId) ? valeur.filter((id) => id !== siteId) : [...valeur, siteId],
    );
  }

  function soumettre() {
    if (!formulaireValide) return;
    creer.mutate(
      {
        prenom: prenom.trim(),
        nom: nom.trim(),
        email: email.trim(),
        role,
        siteIds: [...siteIdsEffectifs],
      },
      {
        onSuccess: (reponse) => {
          onCree(reponse.acces.motDePasseTemporaire);
          onFerme();
        },
      },
    );
  }

  return (
    <Dialog open={ouvert} onOpenChange={(valeurOuverte) => !valeurOuverte && onFerme()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('parametrage:utilisateurs.creation.titre')}</DialogTitle>
          <DialogDescription>
            {t('parametrage:utilisateurs.creation.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nouvel-employe-prenom">
                {t('parametrage:utilisateurs.creation.champPrenom')} *
              </Label>
              <Input
                id="nouvel-employe-prenom"
                value={prenom}
                maxLength={100}
                required
                onChange={(e) => setPrenom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nouvel-employe-nom">
                {t('parametrage:utilisateurs.creation.champNom')} *
              </Label>
              <Input
                id="nouvel-employe-nom"
                value={nom}
                maxLength={100}
                required
                onChange={(e) => setNom(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nouvel-employe-email">
              {t('parametrage:utilisateurs.creation.champEmail')} *
            </Label>
            <Input
              id="nouvel-employe-email"
              type="email"
              value={email}
              maxLength={320}
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <ChampRoleEmploye
            idPrefixe="nouvel-employe"
            valeur={role}
            roles={rolesProposes}
            onChange={setRole}
          />

          {estMonoSite ? null : (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="texte-corps font-medium">
                {t('parametrage:utilisateurs.creation.champSites')} *
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
        </div>

        {creer.error ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreur(creer.error, t)}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFerme} disabled={creer.isPending}>
            {t('commun:actions.annuler')}
          </Button>
          <Button type="button" disabled={!formulaireValide || creer.isPending} onClick={soumettre}>
            {creer.isPending
              ? t('commun:chargement.enCours')
              : t('parametrage:utilisateurs.creation.actions.creer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
