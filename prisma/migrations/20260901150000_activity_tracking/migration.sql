CREATE TABLE "ActivityEntry" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "activityKey" TEXT NOT NULL,
  "intensityKey" TEXT NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "metSnapshot" DECIMAL(5,2) NOT NULL,
  "weightKgSnapshot" DECIMAL(6,2),
  "activeKcalSnapshot" DECIMAL(10,4),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ActivityEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ActivityEntry_userId_date_idx" ON "ActivityEntry"("userId", "date");
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
