import { UserType } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { EmployeeDto } from "@/modules/administration/application/dto/EmployeeDto";
import { toEmployeeDto } from "@/modules/administration/application/mappers/EmployeeMapper";
import {
  ensureCanReadEmployees,
  ensureEmployeeTenant,
} from "@/modules/administration/application/services/serviceHelpers";

/**
 * Lectura batch para la tabla de Usuarios: 1 lectura de `users` + 1 lectura batch de Auth, nunca
 * N llamadas (§27 del ticket). Nombres de rol/sucursal se resuelven en el hook (`useEmployees`)
 * con `roles.listByTenant`/`branches.getActiveByTenant`, mismo patrón ya usado por
 * `CashShiftTable` (`roleNames`/`branchNames` como `ReadonlyMap`) -- este service no los resuelve
 * para no acoplar la lectura de empleados a la de roles/sucursales.
 */
export class GetEmployeesService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(tenantId: string, permissions: readonly string[]): Promise<EmployeeDto[]> {
    ensureCanReadEmployees(permissions);
    ensureEmployeeTenant(tenantId);

    const users = (await this.repositories.users.listByTenant(tenantId)).filter(
      (user) => user.type === UserType.employee,
    );
    const summaries = await this.repositories.auth.getEmployeeAuthSummariesByUserIds(
      tenantId,
      users.map((user) => user.id),
    );
    const summaryByUserId = new Map(summaries.map((summary) => [summary.userId, summary]));

    return users.map((user) => toEmployeeDto(user, summaryByUserId.get(user.id)));
  }
}
