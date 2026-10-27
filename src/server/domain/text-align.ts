/**
 * Word-level alignment between an intended (reference) sentence and what the
 * speech recogniser heard. This is a *recognition* comparison, not a
 * pronunciation judgement: a mismatch can come from accent, noise or the
 * recogniser itself, and the UI must say so.
 */

export type AlignmentOp = "match" | "substitution" | "omission" | "insertion";

export interface AlignedWord {
  op: AlignmentOp;
  reference: string | null;
  recognized: string | null;
}

const CONTRACTIONS: Record<string, string> = {
  "i'm": "i am",
  "you're": "you are",
  "we're": "we are",
  "they're": "they are",
  "it's": "it is",
  "that's": "that is",
  "there's": "there is",
  "i've": "i have",
  "we've": "we have",
  "i'll": "i will",
  "we'll": "we will",
  "you'll": "you will",
  "can't": "cannot",
  "won't": "will not",
  "don't": "do not",
  "doesn't": "does not",
  "didn't": "did not",
  "isn't": "is not",
  "aren't": "are not",
  "wasn't": "was not",
  "couldn't": "could not",
  "shouldn't": "should not",
  "wouldn't": "would not",
  "i'd": "i would",
  "let's": "let us",
};

/** Lower-case, unify apostrophes, expand contractions, strip punctuation. */
export function normalizeWords(text: string): string[] {
  const lowered = text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/-/g, " ");
  const words: string[] = [];
  for (const raw of lowered.split(/\s+/)) {
    const word = raw.replace(/^'+|'+$/g, "");
    if (!word) continue;
    const expanded = CONTRACTIONS[word];
    if (expanded) words.push(...expanded.split(" "));
    else words.push(word);
  }
  return words;
}

export function alignWords(reference: string, recognized: string): AlignedWord[] {
  const a = normalizeWords(reference);
  const b = normalizeWords(recognized);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i]![0] = i;
  for (let j = 0; j <= m; j++) dp[0]![j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  const out: AlignedWord[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i]![j] === dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      out.unshift({
        op: a[i - 1] === b[j - 1] ? "match" : "substitution",
        reference: a[i - 1]!,
        recognized: b[j - 1]!,
      });
      i--;
      j--;
    } else if (i > 0 && dp[i]![j] === dp[i - 1]![j]! + 1) {
      out.unshift({ op: "omission", reference: a[i - 1]!, recognized: null });
      i--;
    } else {
      out.unshift({ op: "insertion", reference: null, recognized: b[j - 1]! });
      j--;
    }
  }
  return out;
}

/** Share of reference words the recogniser heard exactly (0-1). */
export function recognitionMatchRate(alignment: AlignedWord[]): number {
  const referenceWords = alignment.filter((w) => w.reference !== null).length;
  if (referenceWords === 0) return 0;
  return alignment.filter((w) => w.op === "match").length / referenceWords;
}
