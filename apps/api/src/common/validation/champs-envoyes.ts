/**
 * F-01-bis (constaté en reproduction du 10.08, en creusant le F-01 de l'audit du 28.07) : ne
 * retient d'un objet zod-parsé QUE les clés réellement présentes dans le corps brut envoyé par le
 * client.
 *
 * `.partial()` (zod) rend une clé OPTIONNELLE, il n'annule PAS un `.default(...)` posé sur cette
 * même clé dans le schéma de base (ex. `pays: schemaCodePays.default('CH')`). Résultat vérifié en
 * exécution réelle : un `PATCH` qui ne mentionne JAMAIS `pays` (y compris `{}`, y compris un
 * `PATCH { localite: … }` qui ne touche que la localité) ressort du `.parse()` zod avec `pays:
 * 'CH'` posé malgré tout. Sans ce filtre, ce `'CH'` fantôme est écrit tel quel en base : une
 * adresse étrangère au NPA homographe du format suisse (Autriche, NPA à 4 chiffres — ex. `1010`
 * Wien) bascule silencieusement en `pays: 'CH'` sur un simple `PATCH { localite: 'Linz-Zentrum'
 * }`, `200`, aucune erreur. Reproduit contre l'API réelle avant ce correctif — pas une hypothèse.
 *
 * Pourquoi une garde `entree.champ !== undefined` côté service NE SUFFIT PAS, alors qu'elle
 * paraît équivalente : elle teste la valeur APRÈS que zod a déjà rempli le champ avec son défaut.
 * Une fois le `.parse()` passé, `entree.pays` vaut `'CH'` — pas `undefined` — que le client l'ait
 * envoyé ou non. La garde est donc TOUJOURS vraie pour tout champ porteur d'un `.default(...)`,
 * qu'il ait été envoyé ou pas : elle ne distingue jamais les deux cas qu'elle est censée
 * distinguer. Le seul moment où « ce champ a-t-il été envoyé ? » a encore une réponse fiable,
 * c'est AVANT le parse, sur le corps brut — d'où cette fonction. Ce point est contre-intuitif
 * (le code se lit comme une garde de présence qui fonctionne) : sans cette explication, quelqu'un
 * la retirera un jour en la croyant redondante avec `'champ' in entree` côté service, et le
 * défaut reviendra identique, silencieux, sur un domaine différent.
 *
 * Cas symétrique à ne pas casser en « améliorant » le filtre : une clé envoyée avec une valeur
 * falsy (`0`, `false`, `''`) DOIT rester dans le résultat — c'est une valeur métier explicite, pas
 * une absence. Le test est la présence de la clé dans `corpsBrut` (`in`), jamais sa véracité.
 */
export function neGarderQueChampsEnvoyes<T extends Record<string, unknown>>(
  corpsBrut: Readonly<Record<string, unknown>>,
  entreeParsee: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(entreeParsee).filter(([cle]) => cle in corpsBrut),
  ) as Partial<T>;
}
