import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { PREREGLAGES, ROLES_PERSONNE, type IdPrereglage } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ChampRoleEmploye } from '@/ecrans/parametrage/ChampRoleEmploye';
import { useCreerUtilisateur } from '@/hooks/parametrage/useCreerUtilisateur';
import { useSiteImplicite } from '@/hooks/site/useSiteImplicite';
import { useSession } from '@/hooks/useSession';

import { ChampAssistant } from '../ChampAssistant';
import { useMemoireEtape } from '../memoire-etapes';
import { PiedEtape } from '../PiedEtape';
import type { PropsEtape } from '../types-etape';

/** Rôles proposés : ceux d'une personne, sauf l'administration technique (`admin`). */
const PREREGLAGES_PROPOSES: readonly IdPrereglage[] = ROLES_PERSONNE.filter((r) => r !== 'admin');

interface Saisie {
  readonly prenom: string;
  readonly nom: string;
  readonly email: string;
  readonly prereglage: IdPrereglage;
}

export interface CompteCree {
  readonly nomComplet: string;
  readonly email: string;
  readonly motDePasseTemporaire: string;
}

interface Props extends PropsEtape {
  readonly comptes: readonly CompteCree[];
  readonly onCompteCree: (compte: CompteCree) => void;
}

const VIDE: Saisie = { prenom: '', nom: '', email: '', prereglage: 'technicien' };

/**
 * Étape 5 — Équipe (`POST /utilisateurs`, un compte à la fois, aucun mot de passe saisi : le
 * serveur en génère un, affiché ici une seule fois). Facultative, « Plus tard » passe l'étape.
 */
export function EtapeEquipe({ memoire, onSuivant, onRetour, comptes, onCompteCree }: Props) {
  const { t } = useTranslation(['assistant', 'erreurs', 'commun', 'parametrage', 'capacites']);
  const { data: session } = useSession();
  const { estMonoSite, siteId } = useSiteImplicite();
  const [saisie, setSaisie] = useMemoireEtape<Saisie>(memoire, 'equipe', VIDE);
  const [champsManquants, setChampsManquants] = useState(false);
  const creer = useCreerUtilisateur();

  const siteIds =
    estMonoSite && siteId
      ? [siteId]
      : (session?.sites ?? []).filter((s) => s.actif).map((s) => s.id);

  function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    const complet = saisie.prenom.trim() && saisie.nom.trim() && saisie.email.trim();
    setChampsManquants(!complet);
    if (!complet || siteIds.length === 0) return;
    creer.mutate(
      {
        prenom: saisie.prenom.trim(),
        nom: saisie.nom.trim(),
        email: saisie.email.trim(),
        role: PREREGLAGES[saisie.prereglage].roleOrigine,
        prereglage: saisie.prereglage,
        siteIds,
      },
      {
        onSuccess: (reponse) => {
          onCompteCree({
            nomComplet: `${saisie.prenom.trim()} ${saisie.nom.trim()}`,
            email: saisie.email.trim(),
            motDePasseTemporaire: reponse.acces.motDePasseTemporaire,
          });
          setSaisie({ ...VIDE, prereglage: saisie.prereglage });
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={soumettre} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <ChampAssistant
            libelle={t('assistant:equipe.prenom')}
            autoComplete="off"
            value={saisie.prenom}
            onChange={(e) => setSaisie((s) => ({ ...s, prenom: e.target.value }))}
          />
          <ChampAssistant
            libelle={t('assistant:equipe.nom')}
            autoComplete="off"
            value={saisie.nom}
            onChange={(e) => setSaisie((s) => ({ ...s, nom: e.target.value }))}
          />
        </div>
        <ChampAssistant
          libelle={t('assistant:equipe.email')}
          type="email"
          autoComplete="off"
          value={saisie.email}
          onChange={(e) => setSaisie((s) => ({ ...s, email: e.target.value }))}
          erreur={champsManquants ? t('assistant:equipe.erreurChamps') : undefined}
        />
        <ChampRoleEmploye
          idPrefixe="assistant-equipe"
          valeur={saisie.prereglage}
          prereglages={PREREGLAGES_PROPOSES}
          onChange={(prereglage) => setSaisie((s) => ({ ...s, prereglage }))}
        />
        {creer.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{messageErreur(creer.error, t)}</AlertDescription>
          </Alert>
        ) : null}
        <div>
          <Button type="submit" variant="outline" disabled={creer.isPending}>
            {creer.isPending
              ? t('assistant:actions.enregistrement')
              : t('assistant:equipe.inviter')}
          </Button>
        </div>
      </form>

      {comptes.length > 0 ? (
      <section aria-labelledby="assistant-comptes-titre" className="flex flex-col gap-2">
        <h3 id="assistant-comptes-titre" className="texte-libelle font-medium">
          {t('assistant:equipe.invitesTitre')}
        </h3>
        <ul className="divide-y rounded-md bg-muted">
            {comptes.map((c) => (
              <li key={c.email} className="px-3 py-2 texte-corps" role="status">
                <span className="font-medium">{c.nomComplet}</span>{' '}
                <span className="text-muted-foreground">({c.email})</span>
                <br />
                {t('assistant:equipe.accesTemporaire', { mot: c.motDePasseTemporaire })}
              </li>
            ))}
        </ul>
      </section>
      ) : null}

      <PiedEtape
        submit={false}
        onSuivant={onSuivant}
        onRetour={onRetour}
        libelleSuivant={
          comptes.length > 0 ? t('assistant:equipe.continuer') : t('assistant:equipe.plusTard')
        }
      />
    </div>
  );
}
