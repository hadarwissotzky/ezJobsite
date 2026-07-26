/**
 * Project color labels — REQ-PM14. A fixed palette; the project row stores the KEY
 * ('red' … 'slate') or null. Colors are chosen for contrast on a white card and to
 * read at a glance in the field (the ICP organises by color, not by reading).
 *
 * Each color's NAME is i18n'd under `label.<key>` (label.red … label.slate) and is
 * shown alongside the swatch so the label is identifiable without relying on color
 * (color-blind ICP). An unknown stored value degrades to "no color" rather than
 * crashing — a label is never worth a lost render.
 */
export const LABELS = [
  { key: 'red', hex: '#E5484D' },
  { key: 'amber', hex: '#F5A623' },
  { key: 'green', hex: '#30A46C' },
  { key: 'blue', hex: '#3E63DD' },
  { key: 'purple', hex: '#8E4EC6' },
  { key: 'slate', hex: '#8B8D98' },
] as const;

export type LabelKey = (typeof LABELS)[number]['key'];

export function labelHex(key: string | null | undefined): string | null {
  return LABELS.find((l) => l.key === key)?.hex ?? null;
}
