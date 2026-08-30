/**
 * Applies the stored theme before first paint so a dark-mode user never sees a
 * white flash. Kept tiny and inline; it runs before hydration.
 */
export function ThemeScript() {
  const script = `(function(){try{var t=localStorage.getItem("nutricore-theme")||"system";document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
