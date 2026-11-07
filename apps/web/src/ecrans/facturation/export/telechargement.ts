/** Décode un contenu base64 en octets (le fichier WinBIZ voyage en base64 dans la réponse JSON). */
export function base64VersOctets(base64: string): Uint8Array<ArrayBuffer> {
  const binaire = atob(base64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
  return octets;
}

/** Déclenche l'enregistrement du fichier par le navigateur. */
export function telechargerFichier(nomFichier: string, base64: string, typeMime: string): void {
  const blob = new Blob([base64VersOctets(base64)], { type: typeMime });
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nomFichier;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  URL.revokeObjectURL(url);
}

/** Enregistre des octets déjà reçus (fichier relu depuis l'historique). */
export function enregistrerBlob(nomFichier: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nomFichier;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  URL.revokeObjectURL(url);
}
