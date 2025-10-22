import { createRouter } from "@/lib/create-app";
import { getAllClassHandler, getClassHandler } from "@/handlers/class.handler";

const classRouter = createRouter()
    .basePath("/classes")
    .get("/", ...getAllClassHandler)
    .get("/:id", ...getClassHandler)

export default classRouter;
