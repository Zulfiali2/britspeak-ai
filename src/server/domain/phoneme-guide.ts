/**
 * Articulation guidance for English sounds, written for learners of
 * contemporary standard British English (with notes that often help speakers
 * of Urdu, Punjabi, Hindi and other South Asian languages).
 *
 * This text only describes *how to make a sound*. Whether a learner needs it is
 * decided by an acoustic pronunciation assessment, never by text analysis.
 */

export interface SoundGuide {
  symbol: string;
  name: string;
  examples: string[];
  howTo: string;
  commonConfusion?: string;
}

const GUIDES: SoundGuide[] = [
  {
    symbol: "θ",
    name: "voiceless 'th'",
    examples: ["think", "three", "month"],
    howTo:
      "Put the tip of your tongue lightly between your teeth and blow air out gently. No voice — your throat should not buzz.",
    commonConfusion: "Often replaced with /t/ ('tink') or /s/. Keep the tongue visible between the teeth.",
  },
  {
    symbol: "ð",
    name: "voiced 'th'",
    examples: ["this", "mother", "with"],
    howTo:
      "Same tongue position as in 'think', but switch your voice on: you should feel a buzz in your throat.",
    commonConfusion: "Often replaced with /d/ ('dis'). Let the air flow; do not stop it like a /d/.",
  },
  {
    symbol: "v",
    name: "'v'",
    examples: ["very", "voice", "five"],
    howTo:
      "Rest your top teeth on your bottom lip and push voiced air through. You should feel your lip vibrate.",
    commonConfusion: "Not the same as /w/: for /v/ the teeth touch the lip; for /w/ the lips are rounded and do not touch the teeth.",
  },
  {
    symbol: "w",
    name: "'w'",
    examples: ["work", "week", "quick"],
    howTo: "Round your lips tightly (as for 'oo'), then open them quickly into the next vowel. Teeth do not touch the lip.",
    commonConfusion: "Often said as /v/. Keep the teeth away from the lip.",
  },
  {
    symbol: "ɹ",
    name: "British 'r'",
    examples: ["right", "very", "around"],
    howTo:
      "Curl the tongue tip up towards the ridge behind your top teeth without touching it, and round the lips slightly. Do not tap or roll it.",
    commonConfusion:
      "In standard British English the 'r' is not pronounced before a consonant or at the end of a word ('car', 'work') unless a vowel follows.",
  },
  {
    symbol: "r",
    name: "British 'r'",
    examples: ["right", "very", "around"],
    howTo:
      "Curl the tongue tip up towards the ridge behind your top teeth without touching it, and round the lips slightly. Do not tap or roll it.",
  },
  {
    symbol: "z",
    name: "'z'",
    examples: ["zoo", "is", "business"],
    howTo: "Make an /s/ sound and add your voice, so it buzzes. Many words spelled with 's' use /z/: 'is', 'was', 'days'.",
    commonConfusion: "Often replaced with /dʒ/ ('joo' for 'zoo') or /s/.",
  },
  {
    symbol: "ʒ",
    name: "'zh' sound",
    examples: ["measure", "usually", "decision"],
    howTo: "Make a 'sh' sound and add your voice. The tongue stays smooth — do not stop the air.",
  },
  {
    symbol: "ʃ",
    name: "'sh'",
    examples: ["she", "station", "share"],
    howTo: "Round your lips slightly, raise the front of the tongue towards the roof of the mouth and push air out without voice.",
  },
  {
    symbol: "t",
    name: "'t'",
    examples: ["time", "tea", "better"],
    howTo:
      "Touch the ridge just behind your top teeth with your tongue tip (not further back), then release with a small puff of air at the start of a word.",
    commonConfusion: "Curling the tongue back makes a retroflex sound; keep the tip forward on the ridge.",
  },
  {
    symbol: "d",
    name: "'d'",
    examples: ["day", "deadline", "should"],
    howTo: "Tongue tip on the ridge behind the top teeth, voice on, then release.",
    commonConfusion: "Keep the tongue tip forward rather than curled back.",
  },
  {
    symbol: "p",
    name: "'p'",
    examples: ["project", "people", "price"],
    howTo: "Close your lips, build up air and release it with a clear puff at the start of a stressed syllable — hold a tissue in front of your mouth: it should move.",
  },
  {
    symbol: "ŋ",
    name: "'ng'",
    examples: ["meeting", "long", "thinking"],
    howTo: "Raise the back of your tongue to the soft palate and let the sound come through your nose. Do not add a hard /g/ at the end ('meeting', not 'meetinG').",
  },
  {
    symbol: "l",
    name: "'l'",
    examples: ["light", "call", "help"],
    howTo:
      "Tongue tip on the ridge behind the top teeth. At the end of a word ('call', 'feel') the back of the tongue also rises — a darker 'l'.",
  },
  {
    symbol: "h",
    name: "'h'",
    examples: ["hello", "help", "behind"],
    howTo: "Just breathe out through an open mouth before the vowel — no friction in the throat.",
  },
  {
    symbol: "æ",
    name: "short 'a' as in 'cat'",
    examples: ["cat", "plan", "back"],
    howTo: "Open your jaw quite wide and spread your lips slightly, with the tongue low and forward.",
    commonConfusion: "Different from /e/ in 'bed' (less open) and /ʌ/ in 'cut' (tongue more central).",
  },
  {
    symbol: "ʌ",
    name: "short 'u' as in 'cup'",
    examples: ["cup", "budget", "much"],
    howTo: "Relaxed lips, jaw half open, tongue central and low. It is short.",
  },
  {
    symbol: "ɒ",
    name: "short 'o' as in 'hot'",
    examples: ["hot", "job", "project"],
    howTo: "Round your lips slightly and drop the jaw; the tongue is low and back. Keep it short.",
    commonConfusion: "British /ɒ/ is rounded; it is not the same as the long /ɑː/ in 'car'.",
  },
  {
    symbol: "ɑ",
    name: "long 'ah' as in 'car'",
    examples: ["car", "start", "father"],
    howTo: "Open your mouth wide with relaxed lips and hold the sound slightly longer. Do not pronounce the 'r' in 'car' or 'start'.",
  },
  {
    symbol: "ɔ",
    name: "long 'or' as in 'call'",
    examples: ["call", "four", "talk"],
    howTo: "Round your lips firmly and hold the sound. Do not add an 'r' sound.",
  },
  {
    symbol: "ɜ",
    name: "'er' as in 'work'",
    examples: ["work", "first", "learn"],
    howTo: "Keep lips relaxed and the tongue in the middle of the mouth; hold the sound. No 'r' at the end in British English.",
    commonConfusion: "'work' and 'walk' are different: /wɜːk/ versus /wɔːk/.",
  },
  {
    symbol: "ə",
    name: "schwa (weak vowel)",
    examples: ["about", "client", "the (before consonants)"],
    howTo: "A very short, relaxed 'uh'. Most unstressed syllables in English use it — this is what makes British speech sound natural and rhythmic.",
  },
  {
    symbol: "ɪ",
    name: "short 'i' as in 'ship'",
    examples: ["ship", "it", "busy"],
    howTo: "Short and relaxed; the tongue is high but not tense, lips not spread.",
    commonConfusion: "Different from long /iː/ in 'sheep': make /ɪ/ shorter and more relaxed.",
  },
  {
    symbol: "i",
    name: "long 'ee' as in 'sheep'",
    examples: ["sheep", "meeting", "team"],
    howTo: "Spread your lips slightly, tongue high and tense, and hold the sound longer than /ɪ/.",
  },
  {
    symbol: "ʊ",
    name: "short 'oo' as in 'book'",
    examples: ["book", "could", "put"],
    howTo: "Short, with lips loosely rounded and the tongue high at the back.",
  },
  {
    symbol: "u",
    name: "long 'oo' as in 'food'",
    examples: ["food", "you", "new"],
    howTo: "Round the lips more tightly and hold the sound longer than in 'book'.",
  },
  {
    symbol: "eɪ",
    name: "'ay' as in 'day'",
    examples: ["day", "late", "paper"],
    howTo: "Start with the mouth half open for /e/ and glide up towards /ɪ/. It moves — it is not a single flat 'e'.",
  },
  {
    symbol: "əʊ",
    name: "British 'oh' as in 'go'",
    examples: ["go", "phone", "know"],
    howTo: "Start with a relaxed schwa /ə/ and glide to a rounded /ʊ/. It is a moving sound, not a flat 'o'.",
  },
  {
    symbol: "aɪ",
    name: "'eye' as in 'time'",
    examples: ["time", "I", "price"],
    howTo: "Start open as in 'ah' and glide up towards /ɪ/.",
  },
  {
    symbol: "aʊ",
    name: "'ow' as in 'now'",
    examples: ["now", "about", "account"],
    howTo: "Start open as in 'ah' and glide to rounded lips.",
  },
  {
    symbol: "eə",
    name: "'air' as in 'share'",
    examples: ["share", "where", "there"],
    howTo: "Start at /e/ and relax into a schwa; no 'r' sound at the end in British English.",
  },
];

const BY_SYMBOL = new Map(GUIDES.map((g) => [g.symbol, g]));

/** Strip IPA length and stress marks so provider variants map to one guide. */
export function normalizeSymbol(symbol: string): string {
  return symbol.replace(/[ːˑˈˌ.]/g, "").trim();
}

export function guideForPhoneme(symbol: string): SoundGuide | null {
  const s = normalizeSymbol(symbol);
  return BY_SYMBOL.get(s) ?? BY_SYMBOL.get(s.toLowerCase()) ?? null;
}

export function allSoundGuides(): SoundGuide[] {
  return GUIDES.filter((g) => g.symbol !== "r");
}

/** Minimal pairs for the pronunciation laboratory. */
export const MINIMAL_PAIRS: Array<{ focus: string; pairs: Array<[string, string]> }> = [
  { focus: "/v/ and /w/", pairs: [["vest", "west"], ["vine", "wine"], ["veil", "whale"], ["verse", "worse"]] },
  { focus: "/θ/ and /t/", pairs: [["three", "tree"], ["thin", "tin"], ["thank", "tank"], ["both", "boat"]] },
  { focus: "/ð/ and /d/", pairs: [["they", "day"], ["then", "den"], ["though", "dough"], ["breathe", "breed"]] },
  { focus: "/ɪ/ and /iː/", pairs: [["ship", "sheep"], ["live", "leave"], ["fill", "feel"], ["sit", "seat"]] },
  { focus: "/æ/ and /e/", pairs: [["bad", "bed"], ["man", "men"], ["sat", "set"], ["pan", "pen"]] },
  { focus: "/ɜː/ and /ɔː/", pairs: [["work", "walk"], ["firm", "form"], ["bird", "bored"], ["shirt", "short"]] },
  { focus: "/s/ and /z/", pairs: [["price", "prize"], ["bus", "buzz"], ["place", "plays"], ["peace", "peas"]] },
  { focus: "/p/ and /b/", pairs: [["pay", "bay"], ["pin", "bin"], ["cap", "cab"], ["pear", "bear"]] },
];
