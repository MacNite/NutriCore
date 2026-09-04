/**
 * Reads the elements of one huge top-level JSON array without parsing the
 * whole document.
 *
 * The USDA SR Legacy download is 208 MB spread over four files that are not
 * individually valid JSON: the first opens `{"SRLegacyFoods": [`, the middle
 * two are bare sequences of objects, and the last closes the array. They have
 * to be concatenated, and `JSON.parse` on the result needs several gigabytes of
 * heap for a document whose individual records are a few kilobytes each.
 *
 * So the buffer is scanned once at byte level for element boundaries and each
 * element is parsed on its own. UTF-8 makes this safe: every byte of a
 * multi-byte character has its high bit set, so it can never be mistaken for
 * one of the structural characters.
 */

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;

/**
 * Yields each element of the array held at `key`, as a parsed value. `null`
 * elements are yielded as-is - the Foundation download ends with 33 of them -
 * so the caller decides what to do with a hole.
 */
export function* iterateJsonArray(buffer, key) {
  const marker = Buffer.from(`"${key}"`, "utf8");
  const keyAt = buffer.indexOf(marker);
  if (keyAt < 0) throw new Error(`No "${key}" property found`);

  let start = buffer.indexOf(OPEN_BRACKET, keyAt + marker.length);
  if (start < 0) throw new Error(`"${key}" is not followed by an array`);
  start += 1;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let elementStart = -1;

  for (let i = start; i < buffer.length; i += 1) {
    const byte = buffer[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (byte === BACKSLASH) escaped = true;
      else if (byte === QUOTE) inString = false;
      continue;
    }

    if (byte === QUOTE) {
      inString = true;
      if (depth === 0 && elementStart < 0) elementStart = i;
      continue;
    }

    if (byte === OPEN_BRACE || byte === OPEN_BRACKET) {
      if (depth === 0) elementStart = i;
      depth += 1;
      continue;
    }

    if (byte === CLOSE_BRACE || byte === CLOSE_BRACKET) {
      if (depth === 0) {
        // The bracket that closes the array itself: anything still pending is
        // a bare literal such as the trailing `null`s.
        if (elementStart >= 0) yield parseElement(buffer, elementStart, i);
        return;
      }
      depth -= 1;
      if (depth === 0 && elementStart >= 0) {
        yield parseElement(buffer, elementStart, i + 1);
        elementStart = -1;
      }
      continue;
    }

    if (depth === 0) {
      // A bare literal (`null`, a number) between commas.
      if (byte === 0x2c) {
        if (elementStart >= 0) {
          yield parseElement(buffer, elementStart, i);
          elementStart = -1;
        }
      } else if (elementStart < 0 && byte > 0x20) {
        elementStart = i;
      }
    }
  }

  throw new Error(`"${key}" array is not terminated`);
}

function parseElement(buffer, from, to) {
  const text = buffer.toString("utf8", from, to).trim();
  if (text === "") return null;
  return JSON.parse(text);
}
