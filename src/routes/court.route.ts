import { createRouter } from "@/lib/create-app";
import { getAllCourtHandler, getCourtHandler } from "@/handlers/court.handler";

const courtRoute = createRouter()
  .basePath("/courts")
  .get("/", ...getAllCourtHandler)
  .get("/:id", ...getCourtHandler);

export default courtRoute;