import { createRouter } from "@/lib/create-app";
import { getAllClassHandler, getClassHandler } from "@/handlers/class.handler";

const classRoute = createRouter()
    .basePath("/classes")
    .get("/", ...getAllClassHandler)
    .get("/:id", ...getClassHandler)

export default classRoute;
