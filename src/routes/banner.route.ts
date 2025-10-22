import { createRouter } from "@/lib/create-app";
import { getAllCourtHandler, getCourtHandler } from "@/handlers/court.handler";

const bannerRoute = createRouter()
  .basePath("/banners")
  .get("/", ...getAllCourtHandler)
  .get("/:id", ...getCourtHandler);

export default bannerRoute;