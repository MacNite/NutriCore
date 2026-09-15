"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { shrinkImage } from "@/lib/shrink-image";

export type ImageFieldStatus = "idle" | "shrinking" | "tooLarge";

/** Swaps what the input will post. Returns whether the browser allowed it. */
function replaceFile(input: HTMLInputElement, file: File) {
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    return true;
  } catch {
    return false;
  }
}

/**
 * A file input that never posts a photograph larger than the upload limit.
 *
 * An oversized body is truncated before any of this application's code runs
 * (see `shrink-image.ts`), so the limit has to be honoured in the browser or
 * not at all. A picture over the limit is shrunk in place; one that cannot be
 * shrunk is dropped, with the form's own "too large" message, rather than
 * posted to be cut in half.
 *
 * Submission is held while that happens. It takes a fraction of a second, but
 * "a fraction of a second" is exactly long enough for the tap that follows
 * closing the photo picker, and the whole point is that the oversized bytes are
 * never sent.
 */
export function useImageShrink({
  maxBytes,
  onSelect,
}: {
  maxBytes: number;
  /** The file that will actually be posted, or null while there is none. */
  onSelect?: (file: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ImageFieldStatus>("idle");
  const shrinking = useRef(false);
  /** A submit that arrived mid-shrink, to be made good once it finishes. */
  const deferred = useRef(false);
  /** Guards against an older shrink finishing after a newer pick replaced it. */
  const picks = useRef(0);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    /* Capture phase, so this runs before React reaches the form's action and
       can stop it being dispatched with a file that is still being shrunk.
       `preventDefault` covers the plain browser submit the same form falls back
       to before hydration.

       Held, not dropped: the shrink finishes in a fraction of a second, but it
       is the fraction right after the photo picker closes, and a button that
       swallows the tap that lands in it reads as a broken button. */
    const hold = (event: Event) => {
      if (!shrinking.current) return;
      event.preventDefault();
      event.stopPropagation();
      deferred.current = true;
    };
    form.addEventListener("submit", hold, true);
    return () => form.removeEventListener("submit", hold, true);
  }, []);

  const onChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const file = input.files?.[0] ?? null;
      const pick = ++picks.current;

      if (!file || file.size <= maxBytes) {
        shrinking.current = false;
        setStatus("idle");
        onSelect?.(file);
        return;
      }

      shrinking.current = true;
      deferred.current = false;
      setStatus("shrinking");
      onSelect?.(null);

      const smaller = await shrinkImage(file, maxBytes);
      if (pick !== picks.current) return;
      shrinking.current = false;

      if (smaller && replaceFile(input, smaller)) {
        setStatus("idle");
        onSelect?.(smaller);
        // The submit that was held above, now that there is something to send.
        if (deferred.current) {
          deferred.current = false;
          input.form?.requestSubmit();
        }
        return;
      }

      // Dropped on purpose: the alternative is a request the server cannot read.
      // Nothing is resubmitted here - the message below is what has to be read.
      deferred.current = false;
      input.value = "";
      setStatus("tooLarge");
      onSelect?.(null);
    },
    [maxBytes, onSelect],
  );

  return { ref, onChange, status };
}

/**
 * The labelled file input the meal and recipe forms both use.
 *
 * The messages are passed in rather than read here: each form names its photo
 * differently, and a component that reached into one namespace would be wrong
 * on the other.
 */
export function ImageField({
  id,
  name,
  label,
  hint,
  maxBytes,
  shrinkingLabel,
  tooLargeLabel,
  accept = "image/jpeg,image/png,image/webp",
}: {
  id: string;
  name: string;
  label: string;
  hint: string;
  maxBytes: number;
  /** Shown while an oversized picture is being brought under the limit. */
  shrinkingLabel: string;
  /** Shown when it could not be, and the selection was dropped. */
  tooLargeLabel: string;
  accept?: string;
}) {
  const { ref, onChange, status } = useImageShrink({ maxBytes });
  const hintId = `${id}-hint`;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input ref={ref} id={id} name={name} type="file" accept={accept} aria-describedby={hintId} onChange={onChange} />
      <span className="hint" id={hintId}>{hint}</span>
      {status === "shrinking" ? (
        <span className="hint" aria-live="polite">{shrinkingLabel}</span>
      ) : null}
      {status === "tooLarge" ? (
        <div className="notice notice-error" role="alert" style={{ marginTop: 8 }}>
          <span className="notice-icon" aria-hidden="true">!</span>
          <span>{tooLargeLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
