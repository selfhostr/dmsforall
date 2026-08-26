import { useTranslation } from 'react-i18next';

import type { ReponseVehicule } from '@dfa/shared';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatVide } from '@/composants/commun/EtatVide';
import { formaterKilometrage } from '@/lib/formats';

import { BoutonCopier } from './BoutonCopier';

/** Champs « données d'atelier » du véhicule — indexés depuis `ReponseVehicule` pour ne jamais
 *  diverger du contrat partagé (RM-26). */
export type DonneesAtelierVehicule = Pick<
  ReponseVehicule,
  | 'pneusEte'
  | 'pneusHiver'
  | 'pressionPneus'
  | 'huileType'
  | 'huileQuantiteDl'
  | 'batterie'
  | 'codeRadio'
  | 'codeCle'
  | 'intervalleEntretienKm'
  | 'intervalleEntretienMois'
>;

export interface ProprietesBlocDonneesAtelier {
  readonly donnees: DonneesAtelierVehicule;
  readonly className?: string;
}

interface DefinitionChamp {
  readonly libelle: string;
  readonly valeur: string;
  readonly copiable?: boolean;
}

/**
 * Bloc dense et copiable : le comptoir lit un code radio ou un code clé au téléphone, il ne doit
 * jamais avoir à ouvrir un panneau de modification pour ça. Un champ absent (`null`) n'est
 * simplement pas rendu — jamais une grille de champs vides ; si AUCUN champ n'est renseigné,
 * l'état vide dédié remplace la grille entière.
 */
export function BlocDonneesAtelier({ donnees, className }: ProprietesBlocDonneesAtelier) {
  const { t } = useTranslation('vehicules');

  const champs: DefinitionChamp[] = [];
  if (donnees.pneusEte) champs.push({ libelle: t('donnees.ete'), valeur: donnees.pneusEte });
  if (donnees.pneusHiver) champs.push({ libelle: t('donnees.hiver'), valeur: donnees.pneusHiver });
  if (donnees.pressionPneus)
    champs.push({ libelle: t('donnees.pression'), valeur: donnees.pressionPneus });
  if (donnees.huileType) champs.push({ libelle: t('donnees.type'), valeur: donnees.huileType });
  if (donnees.huileQuantiteDl !== null) {
    champs.push({ libelle: t('donnees.quantite'), valeur: String(donnees.huileQuantiteDl) });
  }
  if (donnees.batterie) champs.push({ libelle: t('donnees.batterie'), valeur: donnees.batterie });
  if (donnees.codeRadio)
    champs.push({ libelle: t('donnees.codeRadio'), valeur: donnees.codeRadio, copiable: true });
  if (donnees.codeCle)
    champs.push({ libelle: t('donnees.codeCle'), valeur: donnees.codeCle, copiable: true });
  if (donnees.intervalleEntretienKm !== null || donnees.intervalleEntretienMois !== null) {
    const parties = [
      donnees.intervalleEntretienKm !== null
        ? formaterKilometrage(donnees.intervalleEntretienKm, 'km')
        : null,
      donnees.intervalleEntretienMois !== null
        ? t('donnees.intervalleMois', { count: donnees.intervalleEntretienMois })
        : null,
    ].filter((partie): partie is string => partie !== null);
    champs.push({ libelle: t('donnees.intervalle'), valeur: parties.join(' · ') });
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="texte-titre-section">{t('donnees.titre')}</CardTitle>
      </CardHeader>
      <CardContent>
        {champs.length === 0 ? (
          <EtatVide titre={t('donnees.titre')} description={t('donnees.vide')} />
        ) : (
          // `items-start` (leçon des lots d'écrans précédents) : sans lui, CSS Grid étire chaque
          // cellule à la hauteur de la plus haute de sa rangée — le `border-b` de chaque champ se
          // retrouverait sous un vide plutôt que collé à son contenu dès qu'un libellé/valeur
          // voisin passe sur deux lignes.
          <dl className="densite-dense grid grid-cols-1 items-start gap-x-6 gap-y-groupe sm:grid-cols-2">
            {champs.map((champ) => (
              <div
                key={champ.libelle}
                className="flex items-center justify-between gap-2 border-b py-1"
              >
                <dt className="texte-libelle text-muted-foreground">{champ.libelle}</dt>
                <dd className="flex items-center gap-1 texte-corps font-medium">
                  {champ.valeur}
                  {champ.copiable ? (
                    <BoutonCopier valeur={champ.valeur} className="h-8 w-8" />
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
