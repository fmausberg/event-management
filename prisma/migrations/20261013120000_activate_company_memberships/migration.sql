-- Memberships are active regardless of account existence or email verification.
-- Keep SUSPENDED memberships unchanged and retain the legacy enum for compatibility.
UPDATE "CompanyMembership" SET "status" = 'ACTIVE', "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'INVITED';
