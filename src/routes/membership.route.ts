import { createRouter } from "@/lib/create-app";
import {
  getAllMembershipHandler,
  getMembershipHandler,
} from "@/handlers/membership.handler";

const membershipRoute = createRouter()
    .basePath("/memberships")
    .get("/", ...getAllMembershipHandler)
    .get("/:id", ...getMembershipHandler);

export default membershipRoute;