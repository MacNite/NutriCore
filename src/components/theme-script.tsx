import { headers } from "next/headers";

/**
 * Applies the stored theme before first paint so a dark-mode user never sees a
 * white flash. Kept tiny and inline; it runs before hydration.
 *
 * The nonce comes from the middleware, which mints one per response and names
 * it in the Content-Security-Policy. Without it this script is exactly what the
 * policy is there to stop - an inline one - and the browser would refuse to run
 * it, bringing the white flash back.
 */
export async function ThemeScript() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const script = `(function(){try{var t=localStorage.getItem("nutricore-theme")||"system";document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: script }} />;
}
