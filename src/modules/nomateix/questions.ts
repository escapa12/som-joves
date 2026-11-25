// Banc de preguntes de "No diguis el mateix".
// Cada partida en tria 5 a l'atzar. Les preguntes `faces: true` es responen triant una cara del grup
// (4 membres a l'atzar, triats quan es crea la partida).
// Per afegir-ne: copia una línia, posa un id nou (q31, q32…) i 4 opcions.

export interface Question {
  id: string;
  text: string;
  options?: [string, string, string, string];
  faces?: true;
}

export const QUESTIONS: Question[] = [
  { id: 'q01', text: 'Quin animal convidaries al sopar de Nadal?', options: ['Un pingüí', 'Una cabra', 'Un capibara', 'Un pop'] },
  { id: 'q02', text: 'Tria un número', options: ['3', '7', '13', '69'] },
  { id: 'q03', text: 'Quin superpoder inútil triaries?', options: ['Parlar amb coloms', 'Saber sempre l\'hora exacta', 'Refredar qualsevol beguda amb la mà', 'Endevinar el pes de les coses'] },
  { id: 'q04', text: 'Què menges a les 5 de la matinada després de festa?', options: ['Kebab', 'Pizza freda', 'Entrepà de pernil', 'Cereals'] },
  { id: 'q05', text: 'Tria una sèrie', options: ['Els Simpson', 'Friends', 'The Office', 'Bola de Drac'] },
  { id: 'q06', text: 'Si fossis un electrodomèstic, quin series?', options: ['Torradora', 'Microones', 'Rentaplats', 'Thermomix'] },
  { id: 'q07', text: 'El millor moment de la festa major', options: ['Correfoc', 'Barra lliure', 'Orquestra', 'L\'esmorzar de l\'endemà'] },
  { id: 'q08', text: 'El teu nom de lluitador de wrestling', options: ['El Tigre del Vallès', 'La Bèstia de Sabadell', 'Mister Pàdel', 'El Caganer Assassí'] },
  { id: 'q09', text: 'De quin color et tenyiries el cabell?', options: ['Verd', 'Rosa', 'Blau', 'Platí'] },
  { id: 'q10', text: 'On anem de viatge amb el grup?', options: ['Benidorm', 'Andorra', 'Amsterdam', 'Un poble perdut del Pirineu'] },
  { id: 'q11', text: 'La millor tapa del món', options: ['Braves', 'Calamars', 'Croquetes', 'Pebrots del Padró'] },
  { id: 'q12', text: 'Qui sobreviuria més dies en una illa deserta?', faces: true },
  { id: 'q13', text: 'Qui acabaria primer a la presó?', faces: true },
  { id: 'q14', text: 'Amb qui compartiries habitació d\'hotel?', faces: true },
  { id: 'q15', text: 'Qui seria el pitjor alcalde del poble?', faces: true },
  { id: 'q16', text: 'Qui guanyaria MasterChef?', faces: true },
  { id: 'q17', text: 'Qui arribarà tard a la propera trobada?', faces: true },
  { id: 'q18', text: 'Quin esport olímpic dominaries?', options: ['Cúrling', 'Petanca', 'Marxa atlètica', 'Tir amb arc'] },
  { id: 'q19', text: 'Tria una cervesa', options: ['Estrella', 'Moritz', 'Voll-Damm', 'Sense alcohol 🙃'] },
  { id: 'q20', text: 'Qui guanya en una baralla?', options: ['Un ós', 'Un goril·la', '100 ànecs', 'Un cangur boxejador'] },
  { id: 'q21', text: 'Quina cançó a les 4 de la matinada?', options: ['Mediterráneo', 'Despacito', 'Livin\' on a Prayer', 'Bon dia (Els Pets)'] },
  { id: 'q22', text: 'Et toca un milió. Què compres primer?', options: ['Un iot', 'Una masia', 'Un bar', 'Res, a la guardiola'] },
  { id: 'q23', text: 'Tria una lletra', options: ['A', 'K', 'Q', 'Z'] },
  { id: 'q24', text: 'El pitjor lloc per tirar-te un pet', options: ['Ascensor', 'Primera cita', 'Reunió de feina', 'Funeral'] },
  { id: 'q25', text: 'Quin personatge de dibuixos series?', options: ['Bob Esponja', 'Homer Simpson', 'Shin-chan', 'Doraemon'] },
  { id: 'q26', text: 'Pizza amb pinya?', options: ['Sí', 'No', 'Només si vaig begut', 'Em fa igual'] },
  { id: 'q27', text: 'Quin dia de la setmana ets?', options: ['Dilluns', 'Dimecres', 'Divendres', 'Diumenge'] },
  { id: 'q28', text: 'El teu últim sopar abans de morir', options: ['Paella', 'Hamburguesa', 'Escalivada', 'Cargols a la llauna'] },
  { id: 'q29', text: 'Com arribes a la propera festa?', options: ['Patinet elèctric', 'Tractor', 'Limusina', 'Camell'] },
  { id: 'q30', text: 'Qui és el més probable que es casi a Las Vegas?', faces: true },
];

export const QUESTIONS_PER_MATCH = 5;
export const questionById = (id: string) => QUESTIONS.find((q) => q.id === id);

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

export interface MatchItem { q: string; options: string[] } // for face questions, options are member ids

/** Pick N random questions; at most 2 face questions per match; options shuffled. */
export function drawMatch(memberIds: string[], n = QUESTIONS_PER_MATCH): MatchItem[] {
  const canFaces = memberIds.length >= 4;
  const pool = shuffle(QUESTIONS.filter((q) => canFaces || !q.faces));
  const picked: Question[] = [];
  let faces = 0;
  for (const q of pool) {
    if (picked.length === n) break;
    if (q.faces && faces >= 2) continue;
    if (q.faces) faces++;
    picked.push(q);
  }
  return picked.map((q) => ({ q: q.id, options: q.faces ? shuffle(memberIds).slice(0, 4) : shuffle(q.options!) }));
}

/** Chance of surviving n questions if both players picked at random among k options. */
export const randomWinChance = (n = QUESTIONS_PER_MATCH, k = 4) => ((k - 1) / k) ** n;
