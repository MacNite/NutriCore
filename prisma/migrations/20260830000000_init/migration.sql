-- NutriCore initial schema
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."Locale" AS ENUM ('de', 'en');

-- CreateEnum
CREATE TYPE "public"."BasisUnit" AS ENUM ('G', 'ML');

-- CreateEnum
CREATE TYPE "public"."SourceType" AS ENUM ('OPEN_FOOD_FACTS', 'USDA', 'USER', 'RECIPE', 'AI_RESEARCH', 'IMPORTED');

-- CreateEnum
CREATE TYPE "public"."MealType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS');

-- CreateEnum
CREATE TYPE "public"."FoodType" AS ENUM ('PACKAGED', 'GENERIC', 'RAW', 'COOKED', 'BEVERAGE', 'RECIPE');

-- CreateEnum
CREATE TYPE "public"."Goal" AS ENUM ('LOSE', 'MAINTAIN', 'GAIN', 'CUSTOM');

-- CreateEnum
CREATE TYPE "public"."BiologicalSex" AS ENUM ('MALE', 'FEMALE', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "public"."ActivityLevel" AS ENUM ('SEDENTARY', 'LIGHT', 'MODERATE', 'ACTIVE', 'VERY_ACTIVE');

-- CreateEnum
CREATE TYPE "public"."ResearchStatus" AS ENUM ('REQUESTED', 'SEARCHING', 'SOURCES_FOUND', 'EXTRACTING', 'MATCHING_INGREDIENTS', 'CALCULATING', 'AWAITING_CONFIRMATION', 'ACCEPTED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "language" "public"."Locale" NOT NULL DEFAULT 'de',
    "unitPreference" TEXT NOT NULL DEFAULT 'metric',
    "birthDate" DATE,
    "heightCm" DECIMAL(6,2),
    "weightKg" DECIMAL(6,2),
    "biologicalSex" "public"."BiologicalSex" NOT NULL DEFAULT 'UNSPECIFIED',
    "activityLevel" "public"."ActivityLevel" NOT NULL DEFAULT 'MODERATE',
    "goal" "public"."Goal" NOT NULL DEFAULT 'MAINTAIN',
    "targetWeightKg" DECIMAL(6,2),
    "isPregnant" BOOLEAN NOT NULL DEFAULT false,
    "isBreastfeeding" BOOLEAN NOT NULL DEFAULT false,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "researchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "onboardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NutritionTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bmrKcal" DECIMAL(8,2),
    "activityMultiplier" DECIMAL(4,2),
    "tdeeKcal" DECIMAL(8,2),
    "goalAdjustmentKcal" DECIMAL(8,2),
    "calculatedKcal" DECIMAL(8,2),
    "overrideKcal" DECIMAL(8,2),
    "proteinG" DECIMAL(8,2),
    "carbohydrateG" DECIMAL(8,2),
    "fatG" DECIMAL(8,2),
    "eligible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NutritionTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WeightEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "weightKg" DECIMAL(6,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeightEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NutrientDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameDe" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "canonicalUnit" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'micro',
    "sortOrder" INTEGER NOT NULL DEFAULT 1000,

    CONSTRAINT "NutrientDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Food" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "locale" "public"."Locale",
    "brand" TEXT,
    "barcode" TEXT,
    "foodType" "public"."FoodType" NOT NULL DEFAULT 'GENERIC',
    "sourceType" "public"."SourceType" NOT NULL,
    "externalProvider" TEXT,
    "externalId" TEXT,
    "basisAmount" DECIMAL(10,3) NOT NULL DEFAULT 100,
    "basisUnit" "public"."BasisUnit" NOT NULL,
    "servingSize" DECIMAL(10,3),
    "servingUnit" TEXT,
    "densityGPerMl" DECIMAL(10,5),
    "dataConfidence" DECIMAL(4,3),
    "isEstimated" BOOLEAN NOT NULL DEFAULT false,
    "rawState" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Food_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FoodAlias" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locale" "public"."Locale",

    CONSTRAINT "FoodAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FoodServing" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(10,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "gramEquivalent" DECIMAL(10,3),
    "mlEquivalent" DECIMAL(10,3),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FoodServing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FoodSource" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerId" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "providerUpdatedAt" TIMESTAMP(3),
    "url" TEXT,
    "confidence" DECIMAL(4,3),
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT,
    "assumptions" JSONB,
    "metadata" JSONB,

    CONSTRAINT "FoodSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FoodNutrient" (
    "foodId" TEXT NOT NULL,
    "nutrientKey" TEXT NOT NULL,
    "value" DECIMAL(18,6),
    "sourceValue" DECIMAL(18,6),
    "sourceUnit" TEXT,

    CONSTRAINT "FoodNutrient_pkey" PRIMARY KEY ("foodId","nutrientKey")
);

-- CreateTable
CREATE TABLE "public"."Recipe" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alternativeName" TEXT,
    "description" TEXT,
    "servings" DECIMAL(8,2) NOT NULL,
    "yieldWeightG" DECIMAL(10,2),
    "instructions" TEXT,
    "tags" TEXT[],
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" "public"."SourceType" NOT NULL DEFAULT 'RECIPE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RecipeIngredient" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "amount" DECIMAL(10,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "normalizedGrams" DECIMAL(10,3),
    "normalizedMl" DECIMAL(10,3),
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RecipeIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DiaryDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,

    CONSTRAINT "DiaryDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DiaryEntry" (
    "id" TEXT NOT NULL,
    "diaryDayId" TEXT NOT NULL,
    "meal" "public"."MealType" NOT NULL,
    "foodId" TEXT,
    "recipeId" TEXT,
    "label" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "normalizedAmount" DECIMAL(10,3),
    "normalizedUnit" "public"."BasisUnit",
    "nutritionSnapshot" JSONB NOT NULL,
    "provenanceSnapshot" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiaryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Favorite" (
    "userId" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("userId","foodId")
);

-- CreateTable
CREATE TABLE "public"."FoodUsageStats" (
    "userId" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "usualMeals" "public"."MealType"[],

    CONSTRAINT "FoodUsageStats_pkey" PRIMARY KEY ("userId","foodId")
);

-- CreateTable
CREATE TABLE "public"."ExternalFoodCache" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "barcode" TEXT,
    "normalizedName" TEXT NOT NULL,
    "brand" TEXT,
    "locale" "public"."Locale",
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "providerUpdatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "normalized" JSONB NOT NULL,
    "rawSnapshot" JSONB,

    CONSTRAINT "ExternalFoodCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SearchQueryCache" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "queryKey" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchQueryCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ResearchJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "language" "public"."Locale" NOT NULL,
    "status" "public"."ResearchStatus" NOT NULL DEFAULT 'REQUESTED',
    "model" TEXT,
    "assumptions" JSONB,
    "structuredResponse" JSONB,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ResearchSource" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "excerpt" TEXT,

    CONSTRAINT "ResearchSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ResearchCandidate" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "ResearchCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "public"."User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "public"."Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "public"."Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "public"."Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "public"."UserProfile"("userId");

-- CreateIndex
CREATE INDEX "NutritionTarget_userId_validFrom_idx" ON "public"."NutritionTarget"("userId", "validFrom");

-- CreateIndex
CREATE INDEX "WeightEntry_userId_date_idx" ON "public"."WeightEntry"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "WeightEntry_userId_date_key" ON "public"."WeightEntry"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "NutrientDefinition_key_key" ON "public"."NutrientDefinition"("key");

-- CreateIndex
CREATE INDEX "Food_barcode_idx" ON "public"."Food"("barcode");

-- CreateIndex
CREATE INDEX "Food_normalizedName_idx" ON "public"."Food"("normalizedName");

-- CreateIndex
CREATE INDEX "Food_ownerId_idx" ON "public"."Food"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Food_externalProvider_externalId_key" ON "public"."Food"("externalProvider", "externalId");

-- CreateIndex
CREATE INDEX "FoodAlias_foodId_idx" ON "public"."FoodAlias"("foodId");

-- CreateIndex
CREATE INDEX "FoodAlias_name_idx" ON "public"."FoodAlias"("name");

-- CreateIndex
CREATE INDEX "FoodServing_foodId_idx" ON "public"."FoodServing"("foodId");

-- CreateIndex
CREATE INDEX "FoodSource_foodId_idx" ON "public"."FoodSource"("foodId");

-- CreateIndex
CREATE INDEX "FoodNutrient_nutrientKey_idx" ON "public"."FoodNutrient"("nutrientKey");

-- CreateIndex
CREATE INDEX "Recipe_ownerId_name_idx" ON "public"."Recipe"("ownerId", "name");

-- CreateIndex
CREATE INDEX "RecipeIngredient_recipeId_idx" ON "public"."RecipeIngredient"("recipeId");

-- CreateIndex
CREATE INDEX "RecipeIngredient_foodId_idx" ON "public"."RecipeIngredient"("foodId");

-- CreateIndex
CREATE UNIQUE INDEX "DiaryDay_userId_date_key" ON "public"."DiaryDay"("userId", "date");

-- CreateIndex
CREATE INDEX "DiaryEntry_diaryDayId_meal_idx" ON "public"."DiaryEntry"("diaryDayId", "meal");

-- CreateIndex
CREATE INDEX "FoodUsageStats_userId_lastUsedAt_idx" ON "public"."FoodUsageStats"("userId", "lastUsedAt");

-- CreateIndex
CREATE INDEX "ExternalFoodCache_barcode_idx" ON "public"."ExternalFoodCache"("barcode");

-- CreateIndex
CREATE INDEX "ExternalFoodCache_normalizedName_idx" ON "public"."ExternalFoodCache"("normalizedName");

-- CreateIndex
CREATE INDEX "ExternalFoodCache_expiresAt_idx" ON "public"."ExternalFoodCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalFoodCache_provider_externalId_key" ON "public"."ExternalFoodCache"("provider", "externalId");

-- CreateIndex
CREATE INDEX "SearchQueryCache_expiresAt_idx" ON "public"."SearchQueryCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SearchQueryCache_provider_queryKey_key" ON "public"."SearchQueryCache"("provider", "queryKey");

-- CreateIndex
CREATE INDEX "ResearchJob_userId_createdAt_idx" ON "public"."ResearchJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchSource_jobId_idx" ON "public"."ResearchSource"("jobId");

-- CreateIndex
CREATE INDEX "ResearchCandidate_jobId_idx" ON "public"."ResearchCandidate"("jobId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "public"."AuditLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."NutritionTarget" ADD CONSTRAINT "NutritionTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WeightEntry" ADD CONSTRAINT "WeightEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Food" ADD CONSTRAINT "Food_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FoodAlias" ADD CONSTRAINT "FoodAlias_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "public"."Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FoodServing" ADD CONSTRAINT "FoodServing_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "public"."Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FoodSource" ADD CONSTRAINT "FoodSource_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "public"."Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FoodNutrient" ADD CONSTRAINT "FoodNutrient_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "public"."Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FoodNutrient" ADD CONSTRAINT "FoodNutrient_nutrientKey_fkey" FOREIGN KEY ("nutrientKey") REFERENCES "public"."NutrientDefinition"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Recipe" ADD CONSTRAINT "Recipe_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "public"."Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "public"."Food"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DiaryDay" ADD CONSTRAINT "DiaryDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DiaryEntry" ADD CONSTRAINT "DiaryEntry_diaryDayId_fkey" FOREIGN KEY ("diaryDayId") REFERENCES "public"."DiaryDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DiaryEntry" ADD CONSTRAINT "DiaryEntry_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "public"."Food"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DiaryEntry" ADD CONSTRAINT "DiaryEntry_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "public"."Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Favorite" ADD CONSTRAINT "Favorite_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "public"."Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FoodUsageStats" ADD CONSTRAINT "FoodUsageStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FoodUsageStats" ADD CONSTRAINT "FoodUsageStats_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "public"."Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ResearchJob" ADD CONSTRAINT "ResearchJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ResearchSource" ADD CONSTRAINT "ResearchSource_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "public"."ResearchJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ResearchCandidate" ADD CONSTRAINT "ResearchCandidate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "public"."ResearchJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Trigram indexes backing fast local fuzzy food search.
CREATE INDEX "Food_normalizedName_trgm_idx" ON "Food" USING gin ("normalizedName" gin_trgm_ops);
CREATE INDEX "Food_brand_trgm_idx" ON "Food" USING gin ("brand" gin_trgm_ops);
CREATE INDEX "ExternalFoodCache_normalizedName_trgm_idx" ON "ExternalFoodCache" USING gin ("normalizedName" gin_trgm_ops);
