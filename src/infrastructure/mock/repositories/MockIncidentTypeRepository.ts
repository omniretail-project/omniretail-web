import type { IncidentTypeRepository } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockIncidentTypeRepository
  extends BaseMockRepository
  implements IncidentTypeRepository
{
  async getAll() {
    return this.read((db) => db.incidentTypes);
  }

  async getById(id: string) {
    return this.read((db) => db.incidentTypes.find((item) => item.id === id) ?? null);
  }

  async create(input: Parameters<IncidentTypeRepository["create"]>[0]) {
    const item = this.store.mutate((db) => {
      const created = { ...input, id: this.id("incident-type") };
      db.incidentTypes.push(created);
      return created;
    });
    this.emit("incident-type.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      action: "created",
    });
    return item;
  }

  async update(id: string, input: Parameters<IncidentTypeRepository["update"]>[1]) {
    const item = this.store.mutate((db) => {
      const index = db.incidentTypes.findIndex((incidentType) => incidentType.id === id);
      if (index < 0) throw this.missing("IncidentType", id);
      const current = db.incidentTypes[index];
      if (!current) throw this.missing("IncidentType", id);
      const updated = { ...current, ...input };
      db.incidentTypes[index] = updated;
      return updated;
    });
    this.emit("incident-type.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      action: item.active ? "updated" : "archived",
    });
    return item;
  }

  async delete(id: string) {
    const item = this.store.mutate((db) => {
      const index = db.incidentTypes.findIndex((incidentType) => incidentType.id === id);
      if (index < 0) throw this.missing("IncidentType", id);
      const [deleted] = db.incidentTypes.splice(index, 1);
      if (!deleted) throw this.missing("IncidentType", id);
      return deleted;
    });
    this.emit("incident-type.changed", {
      entityId: id,
      tenantId: item?.tenantId,
      action: "deleted",
    });
  }
}
