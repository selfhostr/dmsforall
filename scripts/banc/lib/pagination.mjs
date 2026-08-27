/**
 * Aides pagination curseur : atteindre une profondeur donnée (pour rejouer ensuite un curseur
 * stable N fois), et vérifier l'intégrité d'une marche complète sur tout le volume réel — le
 * piège documenté dans CONTRIBUTING.md (« `pg` rend `timestamptz` en `Date`, perd la microseconde, le
 * curseur saute des lignes en silence ») ne se voit qu'à ce volume, jamais sur les quelques
 * dizaines de lignes d'une fixture de test.
 */

/** Avance de `page - 1` requêtes et rend le curseur à utiliser pour lire `page`. `page=1` → null. */
export async function obtenirCurseurALaPage(session, chemin, limite, page) {
  let curseur = null;
  for (let i = 1; i < page; i += 1) {
    const separateur = chemin.includes('?') ? '&' : '?';
    const q = `${chemin}${separateur}limite=${limite}${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ''}`;
    // Marche séquentielle par construction : le curseur de l'itération i dépend de la réponse i-1.
    const { statut, corps } = await session.requete('GET', q);
    if (statut !== 200) {
      return { curseur, pageAtteinte: i, epuise: true, erreur: `HTTP ${statut} en page ${i}` };
    }
    if (!corps.curseurSuivant) {
      return { curseur: null, pageAtteinte: i, epuise: true, erreur: null };
    }
    curseur = corps.curseurSuivant;
  }
  return { curseur, pageAtteinte: page, epuise: false, erreur: null };
}

/**
 * Marche l'intégralité de la collection avec `limite`, collecte tous les `id` dans l'ordre.
 * Rend { total, pages, doublons, tailleAnormale } — ne lève jamais, les anomalies sont dans le
 * résultat pour rester visibles dans le rapport final même si le banc continue.
 */
export async function marcherPaginationComplete(session, chemin, limite) {
  const idsVus = new Set();
  const doublons = [];
  let curseur = null;
  let pages = 0;
  let total = 0;
  let tailleAnormale = null;

  for (;;) {
    const separateur = chemin.includes('?') ? '&' : '?';
    const q = `${chemin}${separateur}limite=${limite}${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ''}`;
    // Marche séquentielle par construction : le curseur de l'itération suivante dépend de celle-ci.
    const { statut, corps } = await session.requete('GET', q);
    if (statut !== 200) {
      return {
        total,
        pages,
        doublons,
        tailleAnormale,
        erreur: `HTTP ${statut} en page ${pages + 1}`,
      };
    }
    pages += 1;
    for (const ligne of corps.donnees) {
      if (idsVus.has(ligne.id)) doublons.push(ligne.id);
      idsVus.add(ligne.id);
    }
    total += corps.donnees.length;
    const estDerniere = corps.curseurSuivant === null;
    if (!estDerniere && corps.donnees.length !== limite && tailleAnormale === null) {
      tailleAnormale = { page: pages, taille: corps.donnees.length, attendu: limite };
    }
    if (estDerniere) break;
    curseur = corps.curseurSuivant;
  }

  return { total, pages, doublons, tailleAnormale, erreur: null };
}
