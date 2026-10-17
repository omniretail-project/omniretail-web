import { PlanStatus } from "@/core/enums";
import type { PlanRepository } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockPlanRepository extends BaseMockRepository implements PlanRepository {
  async listActive() {
    return this.read((db) => db.planDefinitions.filter((item) => item.status === PlanStatus.active));
  }
  async getById(id: string) {
    return this.read((db) => db.planDefinitions.find((item) => item.id === id) ?? null);
  }
  async getByCode(code: Parameters<PlanRepository["getByCode"]>[0]) {
    return this.read((db) => db.planDefinitions.find((item) => item.code === code) ?? null);
  }
}
