import type { EtymologyDictionary } from '../shared/types.js';

/** Layout marks and the unknown-part mark: neither is a part two characters can share. */
const NOT_A_PART = /[⿰-⿻？]/;

/**
 * Past this many common members a family shares little more than a radical —
 * 氵 alone heads hundreds of characters, and nobody mistakes 河 for 洗. The
 * families worth warning about are the small ones: 情 晴 清 精 请 around 青.
 */
export const MAX_FAMILY_SIZE = 20;

/** Another character laid out the same way that differs from this one in one part. */
export interface LookalikeMatch {
  character: string;
  /** This character's part where the two differ. */
  ownPart: string;
  /** The other character's part in the same place. */
  otherPart: string;
}

/**
 * The key a character's decomposition has with the part at `position` blanked.
 * Two characters with the same key share their layout and every other part.
 */
function familyKey(parts: string[], position: number): string {
  return parts.map((part, i) => (i === position ? '\0' : part)).join('');
}

/** Positions of the parts a decomposition names, or none if any part is unknown. */
function partPositions(parts: string[]): number[] {
  if (parts.includes('？')) return [];
  const positions = parts.flatMap((part, i) => (NOT_A_PART.test(part) ? [] : [i]));
  return positions.length >= 2 ? positions : [];
}

/**
 * Index the characters by the decomposition they would have with one part
 * blanked, and return the lookup. Only `isCommon` characters are indexed: a
 * lookalike the reader will never meet is noise, and a family is sized by the
 * members worth knowing.
 */
export function buildLookalikeIndex(
  etymology: EtymologyDictionary,
  isCommon: (character: string) => boolean,
): (character: string) => LookalikeMatch[] {
  const families = new Map<string, Array<{ character: string; part: string }>>();

  for (const [character, entry] of Object.entries(etymology)) {
    if (!isCommon(character)) continue;

    const parts = [...entry.decomposition];
    for (const position of partPositions(parts)) {
      const key = familyKey(parts, position);
      let family = families.get(key);
      if (!family) families.set(key, (family = []));
      family.push({ character, part: parts[position]! });
    }
  }

  return (character) => {
    const entry = etymology[character];
    if (!entry) return [];

    const parts = [...entry.decomposition];
    const found: Array<LookalikeMatch & { familySize: number }> = [];

    for (const position of partPositions(parts)) {
      const ownPart = parts[position]!;
      const family = (families.get(familyKey(parts, position)) ?? []).filter(
        member => member.character !== character && member.part !== ownPart,
      );
      if (family.length > MAX_FAMILY_SIZE) continue;

      for (const member of family) {
        found.push({ character: member.character, ownPart, otherPart: member.part, familySize: family.length });
      }
    }

    // The smaller the family, the more the shared part is what the eye goes
    // by, so those lookalikes are the likelier mix-ups and lead.
    found.sort((a, b) => a.familySize - b.familySize);

    const seen = new Set<string>();
    return found
      .filter(match => !seen.has(match.character) && seen.add(match.character))
      .map(({ character: other, ownPart, otherPart }) => ({ character: other, ownPart, otherPart }));
  };
}
