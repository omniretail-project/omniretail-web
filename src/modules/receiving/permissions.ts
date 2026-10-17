import type { PermissionDefinition } from "@/shared/types/permissions.types";

export const receivingPermissions = [
  {
    key: "receiving.receipts.read",
    module: "receiving",
    name: "Leer recepciones",
    description: "Permite consultar recepciones.",
  },
  {
    key: "receiving.receipts.create",
    module: "receiving",
    name: "Crear recepciones",
    description: "Permite crear recepciones.",
  },
  {
    key: "receiving.receipts.confirm",
    module: "receiving",
    name: "Confirmar recepciones",
    description: "Permite confirmar recepciones.",
  },
  {
    key: "receiving.incidents.manage",
    module: "receiving",
    name: "Gestionar incidencias",
    description: "Permite administrar incidencias.",
  },
] satisfies PermissionDefinition[];
