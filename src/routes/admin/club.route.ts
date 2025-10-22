import { createRouter, factory } from "@/lib/create-app";
import { createClubHandler, getAllClubHandler, getClubHandler, updateClubHandler, deleteClubHandler } from "@/handlers/admin/club.handler";

const adminClubRoute = createRouter()
    .basePath("/clubs")
    .post("/", ...createClubHandler)
    .get("/", ...getAllClubHandler)
    .get("/:id", ...getClubHandler)
    .put("/:id", ...updateClubHandler)
    .delete("/:id", ...deleteClubHandler);

export default adminClubRoute;