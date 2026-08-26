import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Statuts d'OR — `composants/identite/BadgeStatutOr.tsx` (`CONFIG_STATUT_OR`, 12 valeurs) : forme
 * + icône + mot, JAMAIS la couleur seule (`composants/identite/BadgeStatut.tsx`, doc de tête —
 * vérification daltonisme explicite). Rendu réel : `<span><Icone aria-hidden />{mot}</span>`.
 *
 * COUVERTURE RÉELLE DES DONNÉES DE DÉMO (mesuré, `dfa_dev`, table `ordre_reparation`,
 * 25.08.2026) : seuls TROIS statuts sur les douze possibles sont peuplés — `ouvert`, `en_cours`,
 * `facture`. Ce fichier le VÉRIFIE plutôt que de le supposer (`verifierCouvertureFiltres`
 * ci-dessous, un statut sans ligne rend l'état vide « filtre », jamais une erreur) et le
 * consigne dans le rapport (pièce jointe `couverture-statuts.json`) au lieu de prétendre à une
 * exhaustivité que les données ne permettent pas — voir le rapport de mission pour le détail.
 */

async function indexColonneEtat(page: Page): Promise<number> {
  // Attente sur un état observable (piège CONTRIBUTING.md « HTTP 200 ne prouve rien ») : le tableau réel
  // (avec ses `columnheader`) n'existe pas encore pendant le squelette de chargement — le lire trop
  // tôt renvoie une liste d'en-têtes vide et fait échouer la fonction pour la mauvaise raison
  // (course, pas absence réelle de la colonne). Mesuré : capture d'écran d'un run en échec montrant
  // le squelette (lignes grises) au moment exact de cette lecture.
  await expect(page.getByRole('columnheader').first()).toBeVisible();
  const entetes = await page.getByRole('columnheader').allTextContents();
  const index = entetes.findIndex((texte) => texte.trim() === 'État');
  if (index === -1) throw new Error(`Colonne « État » introuvable parmi : ${entetes.join(', ')}`);
  return index;
}

interface BadgeReleve {
  readonly texte: string;
  readonly iconeSvg: string;
}

/**
 * Ligne de données, par position (0 = première). Localisation DOM (`table tbody tr`), PAS
 * `getByRole('row')` — DÉFAUT APPLICATIF RÉEL, mesuré et rapporté séparément (hors périmètre e2e,
 * rien ici ne le corrige) : le `<tr>` de chaque ligne cliquable porte `role="link"`
 * (`aria-label="Ouvrir OR-2026-…"`, `components/ui/table.tsx` ou son usage dans l'écran) — une
 * redéfinition de `role` REMPLACE le rôle implicite, elle ne s'y ajoute jamais. `getByRole('row')`
 * ne trouve donc QUE la ligne d'en-tête (mesurée : 1 seul `row` sur une table de 5 lignes de
 * données) ; `getByRole('cell')` reste fiable (30 cellules mesurées pour 5 lignes × 6 colonnes,
 * l'implicite de `<td>` n'est pas affecté par le `role` de son `<tr>` parent). `table tbody` cible
 * le corps du tableau (l'en-tête vit dans un `<thead>` séparé) — un index sans décalage `+1`.
 */
function ligneDonnees(page: Page, index: number): Locator {
  return page.locator('table tbody tr').nth(index);
}

/** Badge de la colonne État, première ligne de données. `null` si la table est vide (état vide
 *  affiché à la place). */
async function badgePremiereligne(page: Page, indexEtat: number): Promise<BadgeReleve | null> {
  const premiereDonnee = ligneDonnees(page, 0);
  if ((await premiereDonnee.count()) === 0) return null;
  const cellule = premiereDonnee.getByRole('cell').nth(indexEtat);
  if ((await cellule.count()) === 0) return null;

  const svg = cellule.locator('svg').first();
  if ((await svg.count()) === 0) return null;

  return {
    texte: (await cellule.textContent())?.trim() ?? '',
    iconeSvg: (await svg.evaluate((el) => el.outerHTML)) ?? '',
  };
}

/**
 * Lit le badge en tolérant l'écart entre « réponse réseau reçue » et « React a committé le nouveau
 * rendu » (piège CONTRIBUTING.md « HTTP 200 ne prouve rien », décliné côté SPA) — une lecture synchrone
 * juste après `waitForResponse` retombe parfois sur la fenêtre où l'ancien tableau s'est déjà vidé
 * mais où le nouveau contenu n'est pas encore posé, lisant `null` un badge pourtant réel.
 *
 * DEUX correctifs précédents se sont révélés insuffisants, mesurés en échec l'un après l'autre —
 * gardés en mémoire pour ne pas les retenter :
 *   1. « deux lectures identiques de suite » : deux `null` rapprochés AVANT même le début du fetch
 *      sont tout aussi stables qu'un résultat final, et concluaient à tort.
 *   2. deux `requestAnimationFrame` chaînés après la réponse : suffisant pour un commit React local,
 *      PAS pour le délai réel ici — `waitForResponse` de Playwright résout dès les EN-TÊTES de la
 *      réponse, pas une fois le corps téléchargé et parsé par le `fetch()` de la page ; sur le
 *      chemin conteneur→LAN→hôte de ce harnais, ce délai dépasse deux frames (mesuré : l'échec
 *      persistait avec la capture d'écran montrant les 5 lignes réelles quelques instants après).
 *
 * Ce qui marche : `expect.poll` — relit `badgePremiereligne` jusqu'à obtenir un badge, borné dans
 * le temps. `exigeDonnees: true` (vue non filtrée, connue non vide par la donnée de démo) laisse
 * l'échec du poll remonter tel quel, message clair. `exigeDonnees: false` (boucle de filtres, 9
 * statuts sur 12 légitimement sans ligne) avale le dépassement de délai et renvoie `null` — un
 * résultat correct, pas un abandon.
 */
async function lireBadge(
  page: Page,
  indexEtat: number,
  options: { readonly exigeDonnees: boolean; readonly timeout?: number },
): Promise<BadgeReleve | null> {
  let dernierReleve: BadgeReleve | null = null;
  try {
    await expect
      .poll(
        async () => {
          dernierReleve = await badgePremiereligne(page, indexEtat);
          return dernierReleve !== null;
        },
        { timeout: options.timeout ?? (options.exigeDonnees ? 10_000 : 3_000) },
      )
      .toBe(true);
  } catch (erreur) {
    if (options.exigeDonnees) throw erreur;
    // Délai dépassé sans donnée : résultat légitime pour un statut sans ligne en démo (9 des 12 —
    // voir commentaire de tête). `dernierReleve` reste `null`, valeur de retour correcte.
  }
  return dernierReleve;
}

function verifieFormeIconeMot(badge: BadgeReleve, etiquette: string): void {
  expect(badge.texte, `${etiquette} — le badge doit porter un mot`).not.toBe('');
  expect(badge.iconeSvg, `${etiquette} — le badge doit porter une icône`).toContain('<svg');
}

test.describe('Statuts d’OR — forme + icône + mot', () => {
  test('les statuts présents dans les données de démo sont visuellement distincts (clair)', async ({
    page,
  }) => {
    await page.goto('/ordres-reparation');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Ordres de réparation' }),
    ).toBeVisible();

    const indexEtat = await indexColonneEtat(page);
    const combobox = page.getByRole('combobox', { name: 'Statut' });
    const options = await ouvrirEtListerOptions(page, combobox);

    const releves = new Map<string, BadgeReleve>();
    const couverture: Record<string, boolean> = {};

    for (const option of options) {
      await combobox.click();
      await page.getByRole('option', { name: option, exact: true }).click();
      // Borné et non bloquant en cas d'absence de nouvel appel réseau (réponse déjà en cache côté
      // TanStack Query pour ce filtre — mesuré : un run a bloqué 10s sur un filtre sans requête
      // nouvelle). Ce n'est PAS un `waitForTimeout` qui remplace l'attente observable — l'attente
      // réseau reste l'événement primaire, cette borne est un filet pour le cas où il n'a jamais
      // lieu ; `lireBadge` juste après reste le vrai signal de fin (poll jusqu'à donnée ou délai).
      await page
        .waitForResponse((r) => r.url().includes('/api/v1/ordres-reparation'), { timeout: 3_000 })
        .catch(() => {});

      const badge = await lireBadge(page, indexEtat, { exigeDonnees: false });
      couverture[option] = badge !== null;
      if (badge !== null) {
        verifieFormeIconeMot(badge, option);
        releves.set(option, badge);
      }
    }

    await test.info().attach('couverture-statuts.json', {
      body: JSON.stringify(couverture, null, 2),
      contentType: 'application/json',
    });

    // Diversité réelle : au moins deux statuts distincts avec des données, sans quoi ce test ne
    // prouverait rien. Si ça échoue, c'est un constat sur les données de démo, pas un bug du
    // harnais (voir le commentaire de tête).
    expect(
      releves.size,
      'au moins deux statuts doivent avoir des données en démo',
    ).toBeGreaterThanOrEqual(2);

    // Forme + icône + mot : deux statuts DIFFÉRENTS n'ont jamais la même icône (ni le même mot,
    // par construction de la Map ci-dessus) — la couleur seule ne pourrait pas les distinguer si
    // l'icône était identique.
    const entrees = [...releves.entries()];
    for (let i = 0; i < entrees.length; i += 1) {
      for (let j = i + 1; j < entrees.length; j += 1) {
        expect(
          entrees[i][1].iconeSvg,
          `« ${entrees[i][0]} » et « ${entrees[j][0]} » doivent avoir des icônes différentes`,
        ).not.toBe(entrees[j][1].iconeSvg);
      }
    }
  });

  test('un même statut reste identique (icône + mot) entre clair et sombre — seule la couleur change', async ({
    page,
  }) => {
    // `Promise.all` plutôt que `goto` puis `waitForResponse` séparément : l'écouteur réseau doit
    // être posé AVANT la navigation pour ne jamais rater une réponse trop rapide.
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/v1/ordres-reparation')),
      page.goto('/ordres-reparation'),
    ]);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Ordres de réparation' }),
    ).toBeVisible();
    const indexEtat = await indexColonneEtat(page);

    const badgeClair = await lireBadge(page, indexEtat, { exigeDonnees: true });
    expect(badgeClair, 'la vue par défaut doit contenir au moins un OR en démo').not.toBeNull();
    const couleurClaire = await couleurBadge(page, indexEtat);

    await page.getByRole('button', { name: /passer en thème sombre/i }).click();
    await expect(page.locator('html')).toHaveClass('dark');

    const badgeSombre = await lireBadge(page, indexEtat, { exigeDonnees: true });
    const couleurSombre = await couleurBadge(page, indexEtat);

    // Mot et icône INCHANGÉS : la distinction ne repose jamais sur la couleur pour être comprise.
    expect(badgeSombre?.texte).toBe(badgeClair?.texte);
    expect(badgeSombre?.iconeSvg).toBe(badgeClair?.iconeSvg);
    // Mais la couleur, elle, doit réellement changer avec le thème (sinon le badge ignorerait le
    // thème plutôt que d'en dépendre).
    expect(couleurSombre).not.toBe(couleurClaire);
  });
});

async function ouvrirEtListerOptions(page: Page, combobox: Locator): Promise<string[]> {
  await combobox.click();
  const textes = await page.getByRole('option').allTextContents();
  // Ferme le menu (Échap) plutôt que de cliquer une option ici — la boucle appelante rouvre et
  // choisit elle-même à chaque itération.
  await page.keyboard.press('Escape');
  return textes.filter((texte) => texte !== 'Tous les statuts');
}

async function couleurBadge(page: Page, indexEtat: number): Promise<string> {
  const cellule = ligneDonnees(page, 0).getByRole('cell').nth(indexEtat);
  return cellule
    .locator('span')
    .first()
    .evaluate((el) => getComputedStyle(el).color);
}
