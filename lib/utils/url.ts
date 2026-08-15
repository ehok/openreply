import { z } from "zod";

/**
 * A URL that is safe to hand to a browser.
 *
 * Zod's `.url()` only asks whether the string parses as a URL, so it accepts
 * `javascript:`, `data:`, `file:` and friends. That matters here because these
 * values leave the app as somewhere a browser is told to go: a tracked link's
 * destination becomes the Location header of the public /r/<slug> redirect, and
 * a campaign's post URL becomes an `href` — including on the public report page,
 * where the person clicking it is not the person who entered it.
 */
export const httpUrlSchema = z.string().url().refine((value) => {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "Link must start with http:// or https://");

/** Predicate form of {@link httpUrlSchema}, for values that are dropped rather than rejected. */
export function isHttpUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && httpUrlSchema.safeParse(value).success;
}
