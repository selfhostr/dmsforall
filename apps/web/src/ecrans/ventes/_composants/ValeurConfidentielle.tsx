import { Eye, EyeOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ProprietesValeurConfidentielle {
  /**
   * État de révélation — TOUJOURS possédé par l'écran appelant (`useState(false)` local),
   * jamais persisté ni mémorisé d'une visite à l'autre. L'appelant est responsable de le
   * remettre à `false` non seulement au montage, mais aussi quand l'identifiant de la
   * ressource affichée change SANS démontage du composant (React Router ne démonte pas
   * `EcranFicheVehiculeStock`/`CarteReprise` quand seul `:id` change dans l'URL) — sinon un
   * vendeur qui a révélé le prix d'achat d'un véhicule verrait le prix du véhicule SUIVANT
   * déjà révélé en ouvrant sa fiche.
   */
  readonly revele: boolean;
  readonly onToggle: () => void;
  /** Contenu affiché une fois révélé — déjà formaté (ex. `formaterMontant(...)`). */
  readonly valeur: ReactNode;
  /** Nom du champ, déjà traduit (ex. `t('ventes:stock.champs.prixAchat')`) — sert UNIQUEMENT à
   *  composer le nom accessible du bouton, jamais rendu tel quel à l'écran (le libellé du champ
   *  est déjà porté par le `<dt>`/label appelant). */
  readonly nomChamp: string;
  readonly className?: string;
}

/**
 * Donnée commerciale masquée par défaut à chaque ouverture d'écran (prix d'achat, valeur
 * estimée d'une reprise, tout champ dont la juxtaposition avec un prix client révèle la marge du
 * garage) — révélable d'un geste EXPLICITE (clic), jamais un survol.
 *
 * PAS une mesure de sécurité : la donnée transite déjà vers ce navigateur (la garde d'accès est
 * l'API, par rôle). Seulement une protection contre le regard par-dessus l'épaule quand le
 * vendeur tourne l'écran vers le client (constat testeur, Fiche commerciale véhicule stock —
 * prix d'achat affiché à côté du prix de vente). Le vendeur garde l'information, c'est un
 * argument de négociation ; rien de confidentiel n'apparaît quand l'écran est tourné.
 *
 * Accessibilité : la valeur masquée n'est JAMAIS injectée dans le DOM en clair — seuls des
 * points décoratifs (`aria-hidden`) la représentent visuellement, un lecteur d'écran ne lit donc
 * jamais la valeur cachée. Le bouton annonce son état (`aria-pressed`) et son nom change avec
 * l'état (« Voir »/« Fermer » + nom du champ) plutôt que de rester un icône muet. Même élément
 * DOM dans les deux états (seuls l'icône et le libellé changent) : le focus ne saute jamais.
 *
 * SIGNALÉ (hors périmètre d'écriture i18n de cet agent) : `nomChamp` compose le nom accessible
 * avec les verbes génériques `commun:actions.voir`/`commun:actions.fermer`, faute de clés
 * dédiées disponibles au moment de l'écriture. Des clés propres existent déjà pour un patron
 * identique (`auth:connexion.champs.motDePasse.afficher`/`.masquer`, `EcranConnexion.tsx`) —
 * l'équivalent pour ce module (`ventes:stock.fiche.confidentiel.afficher`/`.masquer` et
 * `ventes:reprise.champs.confidentiel.afficher`/`.masquer`, même structure) reste à ajouter par
 * l'agent i18n, puis à substituer ici en remplacement de la composition `voir/fermer + nomChamp`.
 */
export function ValeurConfidentielle({
  revele,
  onToggle,
  valeur,
  nomChamp,
  className,
}: ProprietesValeurConfidentielle) {
  const { t } = useTranslation('commun');
  const libelle = revele
    ? `${t('commun:actions.fermer')} ${nomChamp}`
    : `${t('commun:actions.voir')} ${nomChamp}`;

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {revele ? (
        valeur
      ) : (
        <span aria-hidden="true" className="tabular-nums tracking-widest text-muted-foreground">
          ••••••
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="px-2 text-muted-foreground"
        onClick={onToggle}
        aria-pressed={revele}
        aria-label={libelle}
      >
        {revele ? (
          <EyeOff aria-hidden className="h-4 w-4" />
        ) : (
          <Eye aria-hidden className="h-4 w-4" />
        )}
      </Button>
    </span>
  );
}
