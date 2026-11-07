import { Landmark, MoreHorizontal, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GrilleCapacites, UtilisateurResume } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ResumeAcces } from '@/composants/capacites/ResumeAcces';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useDesactiverUtilisateur } from '@/hooks/parametrage/useDesactiverUtilisateur';
import { useListeUtilisateurs } from '@/hooks/parametrage/useListeUtilisateurs';
import { useReactiverUtilisateur } from '@/hooks/parametrage/useReactiverUtilisateur';
import { useReinitialiserAccesUtilisateur } from '@/hooks/parametrage/useReinitialiserAccesUtilisateur';
import { cleTraductionRole } from '@/lib/roles';

import { DialogueAccesTemporaire } from './DialogueAccesTemporaire';
import { SectionBornes } from './SectionBornes';
import { DialogueConfirmationEmploye } from './DialogueConfirmationEmploye';
import { DialogueModifierEmploye } from './DialogueModifierEmploye';
import { DialogueNouvelEmploye } from './DialogueNouvelEmploye';

type ActionEnAttente =
  | { readonly type: 'desactiver'; readonly employe: UtilisateurResume }
  | { readonly type: 'reactiver'; readonly employe: UtilisateurResume }
  | { readonly type: 'reinitialiserAcces'; readonly employe: UtilisateurResume };

function BadgeStatutEmploye({ statut }: { readonly statut: UtilisateurResume['statut'] }) {
  const { t } = useTranslation('parametrage');
  if (statut === 'suspendu') {
    return <Badge variant="outline">{t('parametrage:utilisateurs.statut.suspendu')}</Badge>;
  }
  if (statut === 'invite') {
    return <Badge variant="outline">{t('parametrage:utilisateurs.statut.invite')}</Badge>;
  }
  return <Badge variant="secondary">{t('parametrage:utilisateurs.statut.actif')}</Badge>;
}

/**
 * Réglages -> Utilisateurs (issue #137) : « le patron d'un garage ne peut pas gérer ses
 * employés ». Le patron (direction) ou l'intégrateur (admin) crée un accès, change un rôle ou des
 * sites, désactive un départ (jamais une suppression), réinitialise un accès perdu — le tout sans
 * appeler l'éditeur. `direction`/`admin` seuls atteignent cet écran (`ROLES_GESTION_UTILISATEURS`,
 * `routes/routeur.tsx`) : la restriction reflète `socle.utilisateur.lire` côté API, elle ne
 * l'invente pas.
 */
export function EcranUtilisateurs() {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const requete = useListeUtilisateurs();

  const [dialogueOuvert, setDialogueOuvert] = useState(false);
  const [dialogueFiduciaire, setDialogueFiduciaire] = useState(false);
  // Compte créé dont les droits personnalisés ont échoué : fiche rouverte à la fermeture du mot de passe.
  const [aRevoir, setARevoir] = useState<{
    readonly employe: UtilisateurResume;
    readonly grille: GrilleCapacites;
  } | null>(null);
  const [revoirOuvert, setRevoirOuvert] = useState(false);
  const [employeAModifier, setEmployeAModifier] = useState<UtilisateurResume | null>(null);
  const [actionEnAttente, setActionEnAttente] = useState<ActionEnAttente | null>(null);
  const [motDePasseAffiche, setMotDePasseAffiche] = useState<string | null>(null);

  const desactiver = useDesactiverUtilisateur();
  const reactiver = useReactiverUtilisateur();
  const reinitialiserAcces = useReinitialiserAccesUtilisateur();

  const lignes = requete.data?.pages.flatMap((page) => page.donnees) ?? [];

  function confirmerAction() {
    if (!actionEnAttente) return;
    const { type, employe } = actionEnAttente;
    if (type === 'desactiver') {
      desactiver.mutate(employe.id, { onSuccess: () => setActionEnAttente(null) });
    } else if (type === 'reactiver') {
      reactiver.mutate(employe.id, { onSuccess: () => setActionEnAttente(null) });
    } else {
      reinitialiserAcces.mutate(employe.id, {
        onSuccess: (reponse) => {
          setActionEnAttente(null);
          setMotDePasseAffiche(reponse.motDePasseTemporaire);
        },
      });
    }
  }

  const mutationEnCours =
    actionEnAttente?.type === 'desactiver'
      ? desactiver
      : actionEnAttente?.type === 'reactiver'
        ? reactiver
        : reinitialiserAcces;

  return (
    <GabaritEcran titre={t('parametrage:utilisateurs.titre')}>
      {/* « Nouvel utilisateur » a QUITTÉ le slot `actions` de `GabaritEcran` (chantier
          d'unification inter-écrans, 25.08.2026 : `actions=` pour un bouton « Nouveau X » est le
          motif PÉRIMÉ — `GabaritEcran` le placerait seul sur sa propre rangée pleine largeur sous
          le titre) — aligné sur `EcranListeOrdresReparation`/`EcranListeClients`/
          `EcranListeVehicules` (référence du chantier). Cet écran n'a ni recherche ni filtre ni
          tri (juste une table + une action) : pas de `BarreFiltres`/`SelecteurTri` pour partager
          la rangée, le bouton reste seul, mais dans le flux du contenu — jamais dans le slot
          d'en-tête réservé aux actions. */}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setDialogueFiduciaire(true)}>
          <Landmark className="h-4 w-4" aria-hidden="true" />
          {t('parametrage:utilisateurs.fiduciaire.bouton')}
        </Button>
        <Button type="button" onClick={() => setDialogueOuvert(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('parametrage:utilisateurs.nouveau')}
        </Button>
      </div>

      {requete.isPending ? <EtatChargement lignes={6} /> : null}

      {requete.isError ? (
        <EtatErreur
          titre={t('erreurs:inattendue.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      ) : null}

      {!requete.isPending && !requete.isError && lignes.length === 0 ? (
        <EtatVide
          titre={t('parametrage:utilisateurs.vide.titre')}
          description={t('parametrage:utilisateurs.vide.description')}
        />
      ) : null}

      {!requete.isPending && !requete.isError && lignes.length > 0 ? (
        // DESIGN.md « bordure structurelle uniquement » — `rounded-lg border` retiré : ne
        // délimitait qu'un groupe de contenu (la table elle-même, seul contenu de cet écran, déjà
        // séparée du titre par l'espacement du gabarit), pas une zone d'action distincte. `Table`
        // pose déjà son propre filet horizontal entre les lignes (`table.tsx`, `border-b`) — même
        // pattern que `EcranListeFactures.tsx`/`TableComptoir`, qui n'ajoutent aucun cadre autour
        // de leur table desktop. `overflow-x-auto` reste nécessaire (repli défensif sous 6
        // colonnes, cet écran n'a pas de repli mobile en cartes).
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('parametrage:utilisateurs.colonnes.nom')}</TableHead>
                <TableHead>{t('parametrage:utilisateurs.colonnes.email')}</TableHead>
                <TableHead>{t('parametrage:utilisateurs.colonnes.role')}</TableHead>
                <TableHead>{t('parametrage:utilisateurs.colonnes.acces')}</TableHead>
                <TableHead>{t('parametrage:utilisateurs.colonnes.sites')}</TableHead>
                <TableHead>{t('parametrage:utilisateurs.colonnes.statut')}</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">{t('parametrage:utilisateurs.colonnes.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lignes.map((employe) => (
                <TableRow key={employe.id}>
                  <TableCell className="font-medium">
                    {employe.prenom} {employe.nom}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{employe.email}</TableCell>
                  <TableCell>{t(cleTraductionRole(employe.role))}</TableCell>
                  <TableCell>
                    <ResumeAcces capacites={employe.capacites} roleAffiche={employe.role} />
                  </TableCell>
                  <TableCell>
                    {employe.sites.length === 0 ? (
                      <span className="text-muted-foreground">
                        {t('parametrage:utilisateurs.sitesAucun')}
                      </span>
                    ) : (
                      employe.sites.map((s) => s.nom).join(', ')
                    )}
                  </TableCell>
                  <TableCell>
                    <BadgeStatutEmploye statut={employe.statut} />
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={t('parametrage:utilisateurs.actions.menuAria', {
                            nom: `${employe.prenom} ${employe.nom}`,
                          })}
                        >
                          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEmployeAModifier(employe)}>
                          {t('parametrage:utilisateurs.actions.modifier')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            setActionEnAttente({ type: 'reinitialiserAcces', employe })
                          }
                        >
                          {t('parametrage:utilisateurs.actions.reinitialiserAcces')}
                        </DropdownMenuItem>
                        {employe.statut === 'suspendu' ? (
                          <DropdownMenuItem
                            onSelect={() => setActionEnAttente({ type: 'reactiver', employe })}
                          >
                            {t('parametrage:utilisateurs.actions.reactiver')}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setActionEnAttente({ type: 'desactiver', employe })}
                          >
                            {t('parametrage:utilisateurs.actions.desactiver')}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {requete.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          disabled={requete.isFetchingNextPage}
          onClick={() => void requete.fetchNextPage()}
        >
          {requete.isFetchingNextPage
            ? t('commun:chargement.enCours')
            : t('commun:actions.chargerPlus')}
        </Button>
      ) : null}

      <DialogueNouvelEmploye
        ouvert={dialogueOuvert}
        onFerme={() => setDialogueOuvert(false)}
        onCree={(motDePasseTemporaire) => setMotDePasseAffiche(motDePasseTemporaire)}
        onDroitsARevoir={(employe, grille) => setARevoir({ employe, grille })}
      />

      <DialogueNouvelEmploye
        ouvert={dialogueFiduciaire}
        prereglageInitial="fiduciaire"
        onFerme={() => setDialogueFiduciaire(false)}
        onCree={(motDePasseTemporaire) => setMotDePasseAffiche(motDePasseTemporaire)}
      />

      <DialogueModifierEmploye
        employe={employeAModifier ?? (revoirOuvert ? (aRevoir?.employe ?? null) : null)}
        grilleARestaurer={employeAModifier === null ? aRevoir?.grille : undefined}
        droitsNonEnregistres={employeAModifier === null && revoirOuvert}
        onFerme={() => {
          setEmployeAModifier(null);
          setRevoirOuvert(false);
          setARevoir(null);
        }}
      />

      <DialogueConfirmationEmploye
        ouvert={actionEnAttente !== null}
        titre={
          actionEnAttente
            ? t(`parametrage:utilisateurs.${actionEnAttente.type}.titre`, {
                nom: `${actionEnAttente.employe.prenom} ${actionEnAttente.employe.nom}`,
              })
            : ''
        }
        description={
          actionEnAttente ? t(`parametrage:utilisateurs.${actionEnAttente.type}.description`) : ''
        }
        libelleConfirmer={
          actionEnAttente ? t(`parametrage:utilisateurs.${actionEnAttente.type}.confirmer`) : ''
        }
        variantConfirmer={actionEnAttente?.type === 'desactiver' ? 'destructive' : 'default'}
        enCours={mutationEnCours.isPending}
        erreur={mutationEnCours.error}
        onConfirmer={confirmerAction}
        onAnnuler={() => setActionEnAttente(null)}
      />

      <SectionBornes />

      <DialogueAccesTemporaire
        ouvert={motDePasseAffiche !== null}
        motDePasseTemporaire={motDePasseAffiche}
        onFerme={() => {
          setMotDePasseAffiche(null);
          if (aRevoir) setRevoirOuvert(true);
        }}
      />
    </GabaritEcran>
  );
}
