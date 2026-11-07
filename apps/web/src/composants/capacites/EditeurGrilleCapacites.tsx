import { Check, Minus, TriangleAlert } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { ModeleCapacites } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

import { BadgePersonnalise } from './BadgePersonnalise';
import { cleDuModele } from './grille';
import { SegmentsNiveau } from './SegmentsNiveau';
import type { EtatGrilleEditable } from './useGrilleEditable';

interface Props {
  readonly modele: ModeleCapacites;
  readonly etat: EtatGrilleEditable;
  /** Messages par champ nommé (`niveaux.finances`, `encadrer`, `options.voitMontants`) : 403 du
   *  serveur ou dépassement détecté avant l'envoi. */
  readonly erreursChamp?: Readonly<Record<string, string>>;
}

function MessageChamp({ id, message }: { readonly id: string; readonly message: string }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 texte-libelle text-destructive">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

/**
 * Grille « Qui peut quoi » : 6 domaines x Rien/Voir/Faire, « Encadre l'équipe », trois options.
 * Présentation seule : l'état vit dans `useGrilleEditable`, le choix du point de départ dans le
 * dialogue. Les incohérences s'affichent à côté de la ligne fautive, avant tout envoi.
 */
export function EditeurGrilleCapacites({ modele, etat, erreursChamp = {} }: Props) {
  const { t } = useTranslation('capacites');
  const prefixe = useId();
  const { grille, personnalisee, incoherences, prereglage } = etat;
  if (!grille) return null;

  const erreur = (chemin: string): string | undefined => {
    if (erreursChamp[chemin]) return erreursChamp[chemin];
    if (!incoherences.includes(chemin)) return undefined;
    return chemin === 'niveaux.finances'
      ? t('editeur.incoherence.finances')
      : t('editeur.incoherence.montants');
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby={`${prefixe}-titre`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${prefixe}-titre`} className="texte-corps font-semibold">
          {t('editeur.grilleTitre')}
        </h3>
        <div className="flex items-center gap-2">
          {personnalisee ? (
            <BadgePersonnalise />
          ) : (
            <span className="texte-libelle text-muted-foreground">{t('editeur.conformeAide')}</span>
          )}
          {personnalisee ? (
            <Button type="button" variant="outline" size="sm" onClick={etat.revenir}>
              {t('editeur.revenir')}
            </Button>
          ) : null}
        </div>
      </div>
      {personnalisee && prereglage ? (
        <p className="texte-libelle text-muted-foreground">
          {t('editeur.personnaliseAide', {
            prereglage: t(cleDuModele(prereglage.libelleCle)),
          })}
        </p>
      ) : null}

      <ul className="flex flex-col divide-y">
        {modele.domaines.map((domaine) => {
          const chemin = `niveaux.${domaine.id}`;
          const message = erreur(chemin);
          const idErreur = `${prefixe}-${domaine.id}-erreur`;
          const libelle = t(cleDuModele(domaine.libelleCle));
          return (
            <li key={domaine.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="texte-corps font-medium">{libelle}</span>
                  <span className="texte-libelle text-muted-foreground">
                    {t(cleDuModele(domaine.descriptionCle))}
                  </span>
                </div>
                <SegmentsNiveau
                  nom={`${prefixe}-${domaine.id}`}
                  libelleGroupe={t('editeur.domaineAria', { domaine: libelle })}
                  niveaux={modele.niveaux}
                  valeur={grille.niveaux[domaine.id]}
                  onChange={(niveau) => etat.changerNiveau(domaine.id, niveau)}
                  erreurId={message ? idErreur : undefined}
                />
              </div>
              <p className="texte-libelle text-muted-foreground">
                <span className="font-medium">{t('editeur.exemplesTitre')} : </span>
                {domaine.exemplesCles.map((cle) => t(cleDuModele(cle))).join(' · ')}
              </p>
              {message ? <MessageChamp id={idErreur} message={message} /> : null}
            </li>
          );
        })}
      </ul>

      <fieldset className="flex flex-col gap-3">
        <legend className="texte-corps font-semibold">{t('editeur.autresTitre')}</legend>

        <div className="flex items-start gap-3">
          <Checkbox
            id={`${prefixe}-encadrer`}
            checked={grille.encadrer}
            onCheckedChange={(v) => etat.changerEncadrer(v === true)}
            aria-describedby={`${prefixe}-encadrer-aide`}
            className="mt-0.5"
          />
          <div className="flex flex-col gap-0.5">
            <Label htmlFor={`${prefixe}-encadrer`}>
              {t(cleDuModele(modele.encadrer.libelleCle))}
            </Label>
            <p id={`${prefixe}-encadrer-aide`} className="texte-libelle text-muted-foreground">
              {t(cleDuModele(modele.encadrer.descriptionCle))}
            </p>
            {erreursChamp.encadrer ? (
              <MessageChamp id={`${prefixe}-encadrer-erreur`} message={erreursChamp.encadrer} />
            ) : null}
          </div>
        </div>

        <div className="flex items-start gap-2 texte-libelle">
          {grille.gererEmployes ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <Minus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">
              {t(cleDuModele(modele.gererEmployes.libelleCle))} :{' '}
              {grille.gererEmployes ? t('editeur.gererEmployesOui') : t('editeur.gererEmployesNon')}
            </span>
            <span className="text-muted-foreground">
              {t(cleDuModele(modele.gererEmployes.descriptionCle))}
            </span>
          </div>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="texte-corps font-semibold">{t('editeur.optionsTitre')}</legend>
        {modele.options.map((option) => {
          const chemin = `options.${option.id}`;
          const message = erreur(chemin) ?? erreursChamp[chemin];
          const id = `${prefixe}-${option.id}`;
          return (
            <div key={option.id} className="flex items-start gap-3">
              <Checkbox
                id={id}
                checked={grille.options[option.id]}
                onCheckedChange={(v) => etat.changerOption(option.id, v === true)}
                aria-describedby={`${id}-aide`}
                className="mt-0.5"
              />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={id}>{t(cleDuModele(option.libelleCle))}</Label>
                <p id={`${id}-aide`} className="texte-libelle text-muted-foreground">
                  {t(cleDuModele(option.descriptionCle))}
                </p>
                {message ? <MessageChamp id={`${id}-erreur`} message={message} /> : null}
              </div>
            </div>
          );
        })}
      </fieldset>
    </section>
  );
}
