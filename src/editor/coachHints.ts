/** The coach: turns a TypeScript error into short, friendly hint lines for a child. */
export interface CoachInput {
  /** TypeScript error code, e.g. 2551. */
  code: number;
  /** The compiler's own message. */
  message: string;
  /** The exact text the error underlines, e.g. `piecies`. */
  bad: string;
  /** The whole source line the error is on. */
  line: string;
}

const MAX_LINE = 60;

const SYNTAX_CODES = new Set([1002, 1003, 1005, 1009, 1109, 1128, 1136, 1161, 1434]);

/** One or two hint lines, or [] when there is nothing kind to say. */
export function coachFor({ code, message, bad, line }: CoachInput): string[] {
  const suggestion = /Did you mean '([^']+)'/.exec(message)?.[1];
  if ((code === 2551 || code === 2552 || code === 2561) && suggestion && bad) {
    const fixed = line.trim().replace(new RegExp(`\\b${escapeRegExp(bad)}\\b`), suggestion);
    return [`💡 ${bad} is waarschijnlijk verkeerd gespeld`, `💡 probeer ${fixed.length <= MAX_LINE ? fixed : suggestion}`];
  }
  if (code === 2304) return [`💡 '${bad}' ken ik niet`, `💡 typfout? Of heb je het nog niet gemaakt met const ${bad} = …`];
  if (code === 2339) return [`💡 '${bad}' zit hier niet in`, '💡 tik een punt (.) en kies uit de lijst die opent'];
  if (code === 2554 || code === 2555 || code === 2556) return ['💡 deze functie wil een ander aantal dingen tussen de haakjes'];
  if (code === 2322 || code === 2345 || code === 2365 || code === 2367) return ['💡 dit past hier niet: kijk of het een getal, tekst of iets anders moet zijn'];
  if (code === 2300 || code === 2451) return [`💡 '${bad}' bestaat al: kies een andere naam`];
  if (code === 2307) return [`💡 ${bad} is geen cel met code: een cel haal je op met import { naam } from './B2'`, '💡 tik de aanhalingstekens leeg en kies uit de lijst met cellen'];
  if (code === 2305 || code === 2614) return [`💡 die cel geeft '${bad}' niet door`, '💡 zet het woord  export  voor de functie of waarde in die andere cel'];
  if (code === 2588) return [`💡 '${bad}' is een const: die kun je niet veranderen, gebruik let`];
  if (SYNTAX_CODES.has(code) || (code >= 1000 && code < 2000)) return ['💡 er mist of staat iets te veel: kijk naar haakjes, komma\'s en aanhalingstekens'];
  const first = message.split('\n')[0].trim();
  return first ? [`💡 ${first.length > 80 ? first.slice(0, 77) + '…' : first}`] : [];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
