import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** A link, not a button: it navigates to the search screen for that meal. */
export async function QuickAddLink({
  meal,
  date,
  foodId,
  label,
}: {
  meal: string;
  date: string;
  foodId?: string;
  label: string;
}) {
  const t = await getTranslations("a11y");
  const href = foodId
    ? `/foods/${foodId}?meal=${meal}&date=${date}`
    : `/foods?meal=${meal}&date=${date}`;

  return (
    <Link className="icon-btn" href={href} aria-label={`${t("addFood")}: ${label}`}>
      <span aria-hidden="true">＋</span>
    </Link>
  );
}
