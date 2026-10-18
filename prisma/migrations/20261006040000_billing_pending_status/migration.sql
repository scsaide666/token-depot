-- Commit the new enum label separately before constraints refer to it.
ALTER TYPE "ApiRequestStatus" ADD VALUE 'PENDING';
