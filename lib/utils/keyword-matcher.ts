/**
 * Keyword Matcher
 *
 * Matches comment text against a set of keywords with support for:
 * - Case-insensitive matching
 * - Whole-word or partial matching
 * - Multi-keyword OR logic (any match = true)
 * - Emoji and special character stripping
 */

export interface KeywordMatchResult {
  matched: boolean;
  matchedKeyword: string | null;
}

/**
 * Fold the two Turkish letters that Unicode case rules get wrong.
 *
 * JavaScript's toLowerCase is locale-independent: "İ" becomes "i" plus a
 * combining dot rather than a plain "i", and "I" becomes "i" rather than "ı".
 * Either way the keyword and the comment stop comparing equal, so a campaign on
 * "İNDİRİM" would never fire on a comment saying "indirim". Neither letter has
 * a decomposition NFD can strip, so they are folded by hand, before any case
 * conversion happens.
 */
const TURKISH_DOTTED_I = /[\u0130\u0131]/g;

/**
 * Strip emojis and punctuation, and fold letters onto their ASCII base, keeping
 * only letters, digits and whitespace.
 *
 * The base-folding matters as much as the stripping. `\w` is ASCII-only in
 * JavaScript, so the previous `[^\w\s]` rule deleted every Turkish-specific
 * letter as if it were punctuation — "ışık" came out as "k". Matching on
 * `\p{L}` keeps them, and decomposing to NFD first lets the combining accents
 * be dropped, so "şekilde" and "sekilde" compare equal. That is deliberate:
 * plenty of people comment without a Turkish keyboard, and a campaign should
 * still catch them.
 */
export function stripSpecialCharacters(text: string): string {
  return text
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/gu,
      ""
    )
    .replace(TURKISH_DOTTED_I, "i")
    // NFD splits "ş" into "s" + a combining cedilla; dropping the marks leaves
    // the base letter. Runs before the punctuation pass so the freed-up marks
    // are gone rather than turned into spaces mid-word.
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if a comment text matches any of the given keywords.
 *
 * @param commentText - The raw comment text to check
 * @param keywords - Array of keywords to match against
 * @param wholeWordMatch - If true, keyword must be a standalone word.
 *                         If false, partial matches are allowed (e.g. "linking" matches "link")
 * @returns Match result with the first matched keyword (if any)
 */
export function matchKeywords(
  commentText: string,
  keywords: string[],
  wholeWordMatch: boolean = true
): KeywordMatchResult {
  if (!commentText || keywords.length === 0) {
    return { matched: false, matchedKeyword: null };
  }

  const cleanedText = stripSpecialCharacters(commentText).toLowerCase();

  if (!cleanedText) {
    return { matched: false, matchedKeyword: null };
  }

  for (const keyword of keywords) {
    const cleanedKeyword = stripSpecialCharacters(keyword).toLowerCase();

    if (!cleanedKeyword) continue;

    if (wholeWordMatch) {
      // Build a regex for whole-word matching
      const escapedKeyword = cleanedKeyword.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );
      const regex = new RegExp(`\\b${escapedKeyword}\\b`, "i");
      if (regex.test(cleanedText)) {
        return { matched: true, matchedKeyword: keyword };
      }
    } else {
      // Partial match — keyword substring exists anywhere in the cleaned text
      if (cleanedText.includes(cleanedKeyword)) {
        return { matched: true, matchedKeyword: keyword };
      }
    }
  }

  return { matched: false, matchedKeyword: null };
}
