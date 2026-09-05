"use client";

import { useId } from "react";
import {
  BODY_VIEW,
  DEFAULT_SHAPE_STYLE,
  buildBodyFigure,
  clipShapes,
  outlineShapes,
  type BodyAppearance,
  type BodyOutlineInput,
  type BodyShapeStyle,
} from "@/lib/body-visualization";

/**
 * The figure on its own, with no measurement overlay. Used by the picker and by
 * the empty state, so both show exactly the drawing the progress card will use.
 */
export function BodyFigureDrawing({
  input,
  appearance,
  style = DEFAULT_SHAPE_STYLE,
  label,
}: {
  input: BodyOutlineInput;
  appearance: BodyAppearance;
  /** How the shape panel will draw it, so the preview shows the same stance. */
  style?: BodyShapeStyle;
  label: string;
}) {
  const id = useId();
  const figure = buildBodyFigure(input, appearance, style);

  return (
    <svg viewBox={`0 0 ${BODY_VIEW.width} ${BODY_VIEW.height}`} role="img" aria-label={label}>
      <defs>
        <clipPath id={id}>
          {clipShapes(figure.outline, "body").map((d, index) => (
            <path key={index} d={d} />
          ))}
        </clipPath>
      </defs>

      {figure.hairBack ? <path d={figure.hairBack} fill="var(--text-muted)" opacity="0.85" /> : null}

      <g fill="var(--surface-2)">
        {outlineShapes(figure.outline).map((d, index) => (
          <path key={index} d={d} />
        ))}
      </g>

      <g clipPath={`url(#${id})`}>
        <path d={figure.briefs} fill="var(--text-muted)" opacity="0.4" />
        <path d={figure.waistband} fill="var(--text-muted)" opacity="0.62" />
        {figure.bra ? <path d={figure.bra} fill="var(--text-muted)" opacity="0.4" /> : null}
        {figure.contours.map((d, index) => (
          <path key={index} d={d} fill="none" stroke="var(--line-strong)" strokeWidth="1.1" />
        ))}
        <circle cx={figure.navel.cx} cy={figure.navel.cy} r={figure.navel.r} fill="var(--line-strong)" />
      </g>

      <g fill="none" stroke="var(--accent)" strokeWidth="2">
        {outlineShapes(figure.outline).map((d, index) => (
          <path key={index} d={d} />
        ))}
      </g>

      <path d={figure.hairFront} fill="var(--text-muted)" opacity="0.85" />
    </svg>
  );
}
