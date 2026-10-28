-- Banner records are shared by all branches. Images and banner records are preserved.
ALTER TABLE "banners" DROP COLUMN IF EXISTS "branchId";
