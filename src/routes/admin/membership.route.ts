import { createRouter } from "@/lib/create-app";
import {
  getAllMembershipHandler,
  getMembershipHandler,
  createMembershipHandler,
  updateMembershipHandler,
  deleteMembershipHandler,
} from "@/handlers/admin/membership.handler";

const adminMembershipRoute = createRouter()
    .basePath("/memberships")
    .get("/", ...getAllMembershipHandler)
    .get("/:id", ...getMembershipHandler)
    .post("/", ...createMembershipHandler)
    .put("/:id", ...updateMembershipHandler)
    .delete("/:id", ...deleteMembershipHandler);

export default adminMembershipRoute;