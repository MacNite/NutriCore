import { redirect } from "next/navigation";
import { validDateKey } from "@/lib/date";

/** Legacy URL retained only as a date-preserving compatibility redirect. */
export default async function DiaryRedirect({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const validDate = date && validDateKey(date, "") === date ? date : null;
  redirect(validDate ? `/?date=${validDate}` : "/");
}
