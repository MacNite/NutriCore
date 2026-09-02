"use client";

import { FoodSearchField, type FoodSearchFieldProps } from "@/components/food-search-field";

export function FoodSearch(props: Omit<FoodSearchFieldProps, "variant">) {
  return <FoodSearchField {...props} variant="page" />;
}
