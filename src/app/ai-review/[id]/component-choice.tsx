import { ESTIMATE_CHOICE, SKIP_CHOICE, componentGrams, isEstimatedComponent, type ProposedComponent } from "@/server/ai-types";

export interface ChoiceLabels {
  matched: string;
  unmatched: string;
  missingWeight: string;
  modelEstimate: string;
  skip: string;
  origin: Record<string, string>;
  gramsSource: Record<string, string>;
}

/**
 * One radio group per component: which food its numbers should come from.
 *
 * Open Food Facts is a database of branded products, so a generic word like
 * "Brot" resolves to one specific supermarket loaf. Naming it and letting it be
 * changed is the difference between a proposal and a silent substitution - and
 * each option carries the weight it would log, because a bread with a 30 g slice
 * and one with a 25 g slice give "2 Scheiben" different answers.
 *
 * A server component on purpose: it is plain radio inputs inside the approval
 * form, so choosing works with no JavaScript at all.
 */
export function ComponentChoice({
  component,
  index,
  labels,
  readOnly,
}: {
  component: ProposedComponent;
  index: number;
  labels: ChoiceLabels;
  readOnly: boolean;
}) {
  const candidates = component.candidates ?? [];
  const estimateAvailable = isEstimatedComponent(component);
  const name = `component-${index}`;

  // Nothing to choose between: report the state and leave the form alone.
  if (readOnly || (candidates.length === 0 && !estimateAvailable)) {
    if (component.canonicalFoodId) {
      const hasWeight = componentGrams(component, component.canonicalFoodId) !== null;
      return <span className={hasWeight ? undefined : "muted"}>{hasWeight ? labels.matched : labels.missingWeight}</span>;
    }
    if (estimateAvailable) return <span className="badge badge-ai">{labels.modelEstimate}</span>;
    return <span className="muted">{labels.unmatched}</span>;
  }

  return (
    <fieldset className="choice-set">
      <legend className="sr-only">{component.name}</legend>
      {candidates.map((candidate) => (
        <label className="choice" key={candidate.foodId}>
          <input
            type="radio"
            name={name}
            value={candidate.foodId}
            defaultChecked={component.canonicalFoodId === candidate.foodId}
          />
          <span>
            <strong>{candidate.name}</strong>
            {candidate.brand ? <span className="muted"> · {candidate.brand}</span> : null}
            <br />
            <span className="muted">
              {labels.origin[candidate.origin] ?? candidate.origin}
              {candidate.grams
                ? ` · ${Math.round(candidate.grams)} g · ${labels.gramsSource[candidate.gramsSource] ?? ""}`
                : ""}
            </span>
            {candidate.url ? (
              <>
                <br />
                <a href={candidate.url} rel="noreferrer noopener external" target="_blank">
                  {new URL(candidate.url).hostname}
                </a>
              </>
            ) : null}
          </span>
        </label>
      ))}

      {estimateAvailable ? (
        <label className="choice" key="estimate">
          <input
            type="radio"
            name={name}
            value={ESTIMATE_CHOICE}
            defaultChecked={!component.canonicalFoodId}
          />
          <span>
            <span className="badge badge-ai">{labels.modelEstimate}</span>
          </span>
        </label>
      ) : null}

      <label className="choice" key="skip">
        <input
          type="radio"
          name={name}
          value={SKIP_CHOICE}
          defaultChecked={!component.canonicalFoodId && !estimateAvailable}
        />
        <span className="muted">{labels.skip}</span>
      </label>
    </fieldset>
  );
}
