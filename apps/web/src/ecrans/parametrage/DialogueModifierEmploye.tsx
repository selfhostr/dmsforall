import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ROLES_PERSONNE, type RolePersonne, type UtilisateurResume } from '@dfa/shared';

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
import { useModifierUtilisateur } from '@/hooks/parametrage/useModifierUtilisateur';
import { useSession } from '@/hooks/useSession';
import { ChampRoleEmploye } from './ChampRoleEmploye';

interface Props {
  readonly employe: UtilisateurResume | null;
  readonly onFerme: () => void;
}

/**
 * `PATCH /utilisateurs/{id}` — changer le rôle et/ou les sites d'un employé, « quand il change
 * de poste » (brief). `employe === null` ferme le dialogue (même patron que les dialogues à
 * cible optionnelle du reste du produit) — pas de prop `ouvert` séparée, la présence de la cible
 * EST l'état d'ouverture.
 */
export function DialogueModifierEmploye({ employe, onFerme }: Props) {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const { data: session } = useSession();
  const modifier = useModifierUtilisateur();

  const [role, setRole] = useState<RolePersonne>('technicien');
  const [siteIds, setSiteIds] = useState<readonly string[]>([]);

  useEffect(() => {
    if (employe) {
      setRole(employe.role);
      setSiteIds(employe.sites.map((s) => s.id));
      modifier.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resynchronisation à l'ouverture seulement
  }, [employe?.id]);

  const sites = session?.sites ?? [];
  const rolesProposes = ROLES_PERSONNE.filter(
    (r) => r !== 'admin' || session?.utilisateur.role === 'admin' || employe?.role === 'admin',
  );
  const formulaireValide = siteIds.length > 0;

  function basculerSite(siteId: string) {
    setSiteIds((valeur) =>
      valeur.includes(siteId) ? valeur.filter((id) => id !== siteId) : [...valeur, siteId],
    );
  }

  function soumettre() {
    if (!employe || !formulaireValide) return;
    modifier.mutate(
      { utilisateurId: employe.id, entree: { role, siteIds: [...siteIds] } },
      { onSuccess: onFerme },
    );
  }

  return (
    <Dialog open={employe !== null} onOpenChange={(valeurOuverte) => !valeurOuverte && onFerme()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
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

        <div className="flex flex-col gap-4">
          <ChampRoleEmploye
            idPrefixe="modifier-employe"
            valeur={role}
            roles={rolesProposes}
            onChange={setRole}
          />

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
        </div>

        {modifier.error ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreur(modifier.error, t)}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFerme} disabled={modifier.isPending}>
            {t('commun:actions.annuler')}
          </Button>
          <Button
            type="button"
            disabled={!formulaireValide || modifier.isPending}
            onClick={soumettre}
          >
            {modifier.isPending
              ? t('commun:chargement.enCours')
              : t('parametrage:utilisateurs.modification.actions.enregistrer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
