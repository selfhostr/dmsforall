import { describe, expect, it } from 'vitest';

import { encoderWindows1252 } from './winbiz-encodage';

describe('encoderWindows1252', () => {
  it('encode l’ASCII octet pour octet', () => {
    const { octets, caracteresNonEncodables } = encoderWindows1252('ABC123 -_.');
    expect([...octets]).toEqual([
      0x41, 0x42, 0x43, 0x31, 0x32, 0x33, 0x20, 0x2d, 0x5f, 0x2e,
    ]);
    expect(caracteresNonEncodables).toEqual([]);
  });

  it('encode chaque lettre accentuée FR/DE/IT usuelle sur son octet Windows-1252 exact', () => {
    const attendus: Record<string, number> = {
      é: 0xe9,
      è: 0xe8,
      à: 0xe0,
      ù: 0xf9,
      ç: 0xe7,
      ü: 0xfc,
      ö: 0xf6,
      ä: 0xe4,
      î: 0xee,
      ô: 0xf4,
      ñ: 0xf1,
      ß: 0xdf,
      É: 0xc9,
      À: 0xc0,
      Ü: 0xdc,
    };

    for (const [caractere, octetAttendu] of Object.entries(attendus)) {
      const { octets, caracteresNonEncodables } = encoderWindows1252(caractere);
      expect([...octets], `caractère « ${caractere} »`).toEqual([octetAttendu]);
      expect(caracteresNonEncodables).toEqual([]);
    }
  });

  it('encode un nom de client accentué complet — cas concret « le défaut qui se découvre chez le comptable »', () => {
    // G, e, n, è, v, e, espace, S, A
    const { octets } = encoderWindows1252('Genève SA');
    expect([...octets]).toEqual([
      0x47, 0x65, 0x6e, 0xe8, 0x76, 0x65, 0x20, 0x53, 0x41,
    ]);
  });

  it('encode « Müller & Cie » — ü en 0xFC, pas en deux octets UTF-8', () => {
    const { octets } = encoderWindows1252('Müller & Cie');
    expect([...octets]).toEqual([
      0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x20, 0x26, 0x20, 0x43, 0x69, 0x65,
    ]);
  });

  it('la sortie Windows-1252 diffère RÉELLEMENT de l’UTF-8 naturel de Node — la preuve que « écrire une string » ne suffit pas', () => {
    const source = 'François Müller — Genève';
    const { octets: octetsWin1252 } = encoderWindows1252(source);
    const octetsUtf8 = Buffer.from(source, 'utf-8');

    // Même contenu logique, deux séquences d'octets différentes : UTF-8 code ç, ü et — sur
    // plusieurs octets chacun, Windows-1252 sur un seul. Un fichier écrit par erreur en UTF-8 et
    // relu en Windows-1252 afficherait donc des caractères parasites à chacun de ces points —
    // exactement le défaut que ce module existe pour empêcher.
    expect(octetsWin1252.length).not.toBe(octetsUtf8.length);
    expect(Buffer.compare(octetsWin1252, octetsUtf8)).not.toBe(0);

    // Et Windows-1252 reste plus court : un octet par caractère, toujours.
    expect(octetsWin1252.length).toBe(source.length);
  });

  it('encode la plage spéciale 0x80-0x9F (Windows-1252 ≠ Latin-1 ici)', () => {
    const cas: Array<[string, number]> = [
      ['€', 0x80],
      ['’', 0x92], // apostrophe typographique '
      ['“', 0x93], // «  guillemet ouvrant typographique "
      ['–', 0x96], // tiret demi-cadratin –
      ['—', 0x97], // tiret cadratin —
      ['…', 0x85], // points de suspension …
    ];
    for (const [caractere, octetAttendu] of cas) {
      const { octets, caracteresNonEncodables } = encoderWindows1252(caractere);
      expect([...octets]).toEqual([octetAttendu]);
      expect(caracteresNonEncodables).toEqual([]);
    }
  });

  it('remplace un caractère non représentable par « ? » et le signale', () => {
    const { octets, caracteresNonEncodables } = encoderWindows1252('Garage 日本');
    // "Garage " passe tel quel, puis deux caractères non encodables → deux « ? ».
    expect([...octets]).toEqual([
      0x47, 0x61, 0x72, 0x61, 0x67, 0x65, 0x20, 0x3f, 0x3f,
    ]);
    expect(caracteresNonEncodables).toEqual(['日', '本']);
  });

  it('produit un octet par point de code, pas par unité UTF-16 — CRLF compris', () => {
    const { octets } = encoderWindows1252('a\r\nb');
    expect([...octets]).toEqual([0x61, 0x0d, 0x0a, 0x62]);
  });
});
