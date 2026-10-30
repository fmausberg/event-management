CREATE TABLE "EventReviewResendToken" (
  "tokenHash" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventReviewResendToken_pkey" PRIMARY KEY ("tokenHash")
);
CREATE UNIQUE INDEX "EventReviewResendToken_requestId_key" ON "EventReviewResendToken"("requestId");
CREATE INDEX "EventReviewResendToken_reviewId_idx" ON "EventReviewResendToken"("reviewId");
ALTER TABLE "EventReviewResendToken" ADD CONSTRAINT "EventReviewResendToken_reviewId_fkey"
  FOREIGN KEY ("reviewId") REFERENCES "EventReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
