import type { IncidentType } from "@/core/entities";

export interface IncidentTypeRepository {
  getAll(): Promise<IncidentType[]>;
  getById(id: string): Promise<IncidentType | null>;
  create(input: Omit<IncidentType, "id">): Promise<IncidentType>;
  update(id: string, input: Partial<Omit<IncidentType, "id">>): Promise<IncidentType>;
  delete(id: string): Promise<void>;
}
