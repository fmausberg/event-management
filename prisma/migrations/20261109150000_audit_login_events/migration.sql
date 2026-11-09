-- Platform login events have no company; existing tenant entries keep their scope.
ALTER TABLE "AuditLog" ALTER COLUMN "companyId" DROP NOT NULL;
