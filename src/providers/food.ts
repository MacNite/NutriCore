import { z } from "zod";
export const normalizedFoodSchema = z.object({ externalId:z.string(), barcode:z.string().optional(), name:z.string(), brand:z.string().optional(), basisAmount:z.number().positive(), basisUnit:z.enum(["G","ML"]), servingAmount:z.number().positive().optional(), servingUnit:z.string().optional(), nutrients:z.record(z.string(),z.number().nullable()), provenance:z.object({provider:z.string(),retrievedAt:z.date(),providerUpdatedAt:z.date().optional(),confidence:z.number().min(0).max(1).optional()}), raw:z.unknown().optional() });
export type NormalizedFood=z.infer<typeof normalizedFoodSchema>;
export interface FoodProvider { getByBarcode(barcode:string):Promise<NormalizedFood|null>; search(query:string):Promise<NormalizedFood[]> }
