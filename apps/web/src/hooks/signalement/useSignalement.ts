import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { obtenirEnv } from '@/config/env';
import { collecterDiagnostic } from '@/diagnostic/collecte';
import {
  construireSignalement,
  rapportMarkdown,
  reduirePourUrl,
  URL_SIGNALEMENT_PAR_DEFAUT,
  type Signalement,
} from '@/diagnostic/rapport';

export type EtatCopie = 'inactif' | 'copie' | 'echec';

export interface UtiliserSignalement {
  readonly constat: string;
  readonly etapes: string;
  readonly attendu: string;
  readonly definirConstat: (valeur: string) => void;
  readonly definirEtapes: (valeur: string) => void;
  readonly definirAttendu: (valeur: string) => void;
  readonly joindre: boolean;
  readonly definirJoindre: (valeur: boolean) => void;
  /** Ce qui partira EXACTEMENT : textes nettoyés, diagnostic éventuellement raccourci. */
  readonly signalement: Signalement;
  readonly apercuJson: string;
  readonly constatRenseigne: boolean;
  readonly erreurConstat: boolean;
  /** Ouvre le site dans un nouvel onglet ; `false` si le constat est vide (erreur affichée). */
  readonly continuerSurLeSite: () => boolean;
  readonly copierLeRapport: () => Promise<void>;
  readonly etatCopie: EtatCopie;
  /** Rapport Markdown, rempli quand la copie automatique a échoué (à copier à la main). */
  readonly texteACopier: string;
}

function urlDeBase(): string {
  try {
    return obtenirEnv().VITE_URL_SIGNALEMENT ?? URL_SIGNALEMENT_PAR_DEFAUT;
  } catch {
    return URL_SIGNALEMENT_PAR_DEFAUT;
  }
}

/**
 * État et logique du formulaire de signalement. Les saisies vivent tant que le composant parent
 * reste monté (fermer puis rouvrir le panneau ne fait rien perdre). Le diagnostic est figé à
 * l'ouverture du panneau.
 */
export function useSignalement(ouvert: boolean, nbSites: number): UtiliserSignalement {
  const { t } = useTranslation('signalement');
  const [constat, setConstat] = useState('');
  const [etapes, setEtapes] = useState('');
  const [attendu, setAttendu] = useState('');
  const [joindre, setJoindre] = useState(true);
  const [constatManquant, setConstatManquant] = useState(false);
  const [etatCopie, setEtatCopie] = useState<EtatCopie>('inactif');
  const [texteACopier, setTexteACopier] = useState('');

  const diagnostic = useMemo(
    () => (ouvert ? collecterDiagnostic(nbSites) : null),
    [ouvert, nbSites],
  );

  const { signalement, url } = useMemo(
    () =>
      reduirePourUrl(
        construireSignalement({ constat, etapes, attendu }, joindre ? diagnostic : null),
        urlDeBase(),
      ),
    [constat, etapes, attendu, joindre, diagnostic],
  );

  const constatRenseigne = constat.trim() !== '';

  function verifier(): boolean {
    setConstatManquant(!constatRenseigne);
    return constatRenseigne;
  }

  function continuerSurLeSite(): boolean {
    if (!verifier()) return false;
    window.open(url, '_blank', 'noopener');
    return true;
  }

  async function copierLeRapport(): Promise<void> {
    if (!verifier()) return;
    const texte = rapportMarkdown(signalement, {
      constat: t('markdown.constat', { lng: 'fr' }),
      etapes: t('markdown.etapes', { lng: 'fr' }),
      attendu: t('markdown.attendu', { lng: 'fr' }),
      diagnostic: t('markdown.diagnostic', { lng: 'fr' }),
      aucun: t('markdown.aucun', { lng: 'fr' }),
    });
    try {
      await navigator.clipboard.writeText(texte);
      setTexteACopier('');
      setEtatCopie('copie');
    } catch {
      setTexteACopier(texte);
      setEtatCopie('echec');
    }
  }

  return {
    constat,
    etapes,
    attendu,
    definirConstat: (v) => {
      setConstat(v);
      setConstatManquant(false);
      setEtatCopie('inactif');
    },
    definirEtapes: (v) => {
      setEtapes(v);
      setEtatCopie('inactif');
    },
    definirAttendu: (v) => {
      setAttendu(v);
      setEtatCopie('inactif');
    },
    joindre,
    definirJoindre: (v) => {
      setJoindre(v);
      setEtatCopie('inactif');
    },
    signalement,
    apercuJson: JSON.stringify(signalement, null, 2),
    constatRenseigne,
    erreurConstat: constatManquant,
    continuerSurLeSite,
    copierLeRapport,
    etatCopie,
    texteACopier,
  };
}
