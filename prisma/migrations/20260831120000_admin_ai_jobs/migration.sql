CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "AiJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "AiApprovalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER',
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "UserInvitation" (
  "id" TEXT NOT NULL, "email" TEXT NOT NULL, "name" TEXT, "role" "UserRole" NOT NULL DEFAULT 'USER',
  "tokenHash" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "acceptedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
  "invitedById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserInvitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserInvitation_tokenHash_key" ON "UserInvitation"("tokenHash");
CREATE INDEX "UserInvitation_email_createdAt_idx" ON "UserInvitation"("email", "createdAt");
CREATE INDEX "UserInvitation_expiresAt_idx" ON "UserInvitation"("expiresAt");
ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "MealInput" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "text" TEXT NOT NULL, "sourceUrl" TEXT, "meal" "MealType" NOT NULL,
  "diaryDate" DATE NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MealInput_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MealInput_userId_createdAt_idx" ON "MealInput"("userId", "createdAt");
ALTER TABLE "MealInput" ADD CONSTRAINT "MealInput_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "AiJob" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, "mealInputId" TEXT,
  "status" "AiJobStatus" NOT NULL DEFAULT 'QUEUED', "retryCount" INTEGER NOT NULL DEFAULT 0, "maxRetries" INTEGER NOT NULL DEFAULT 2,
  "model" TEXT, "errorMessage" TEXT, "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "failedAt" TIMESTAMP(3), CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiJob_status_createdAt_idx" ON "AiJob"("status", "createdAt");
CREATE INDEX "AiJob_userId_createdAt_idx" ON "AiJob"("userId", "createdAt");
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_mealInputId_fkey" FOREIGN KEY ("mealInputId") REFERENCES "MealInput"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "AiProposal" (
  "id" TEXT NOT NULL, "jobId" TEXT NOT NULL, "approvalStatus" "AiApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "confidence" TEXT NOT NULL, "proposed" JSONB NOT NULL, "accepted" JSONB, "provenance" JSONB NOT NULL,
  "reviewedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AiProposal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiProposal_jobId_key" ON "AiProposal"("jobId");
ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AiJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
