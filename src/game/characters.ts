export interface Character {
  id: string;
  emoji: string;
  name: string;
  color: string;
  /** Frecuencia base del claxon (Hz). */
  honk: number;
}

export const CHARACTERS: readonly Character[] = [
  { id: 'rana', emoji: '🐸', name: 'Rana Ramona', color: '#3fbf3f', honk: 330 },
  { id: 'pollo', emoji: '🐔', name: 'Pollo Loco', color: '#f2c12e', honk: 880 },
  { id: 'patata', emoji: '🥔', name: 'Doña Patata', color: '#b8864b', honk: 220 },
  { id: 'cerdo', emoji: '🐷', name: 'Cerdo Turbo', color: '#ff8fb1', honk: 160 },
  { id: 'dino', emoji: '🦖', name: 'Dino Mitas', color: '#2fa39b', honk: 110 },
  { id: 'abuela', emoji: '👵', name: 'Abuela Rally', color: '#a46bd6', honk: 520 },
  { id: 'gato', emoji: '🐱', name: 'Gato Michi', color: '#f0883e', honk: 660 },
  { id: 'caca', emoji: '💩', name: 'Sr. Mojón', color: '#7a4a2a', honk: 90 },
];

export function getCharacter(id: string): Character {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

export function isCharacterId(id: unknown): id is string {
  return typeof id === 'string' && CHARACTERS.some((c) => c.id === id);
}

export const BOT_NAMES = ['Paco Bot', 'Mari Bot', 'Robotín', 'Terminator Juan', 'IA-ki', 'Bot Manolo'];
