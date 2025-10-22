import { createRouter } from "@/lib/create-app";
import { createClassHandler, deleteClassHandler, getAllClassHandler, getClassHandler, updateClassHandler } from "@/handlers/admin/class.handler";

const adminClassRoute = createRouter()
  .basePath("/classes")
  .get("/", ...getAllClassHandler)
  .get("/:id", ...getClassHandler)
  .post("/", ...createClassHandler)
  .put("/:id", ...updateClassHandler)
  .delete("/:id", ...deleteClassHandler);

export default adminClassRoute;