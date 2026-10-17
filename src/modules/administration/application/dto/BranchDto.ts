import type { Branch } from "@/core/entities";

export type BranchDto = Omit<Branch, "tenantId">;

export type BranchInputDto = Pick<
  Branch,
  "code" | "name" | "type" | "address" | "phone" | "email" | "status"
>;
