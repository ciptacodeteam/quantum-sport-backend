import { createRouter } from "@/lib/create-app";
import { getBannerHandler, getAllBannerHandler,  } from "@/handlers/banner.handler";
import { createBannerHandler, deleteBannerHandler, updateBannerHandler } from "@/handlers/admin/banner.handler";

const adminBannerRoute = createRouter()
  .basePath("/banners")
  .get("/", ...getAllBannerHandler)
  .get("/:id", ...getBannerHandler)
  .post("/", ...createBannerHandler)
  .put("/:id", ...updateBannerHandler)
  .delete("/:id", ...deleteBannerHandler);

export default adminBannerRoute;
