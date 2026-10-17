export interface IncidentType {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description?: string;
  active: boolean;
}
