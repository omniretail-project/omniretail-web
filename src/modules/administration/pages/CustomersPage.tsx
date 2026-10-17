"use client";

import { useState } from "react";
import type { CustomerDto } from "@/modules/administration/application/dto/CustomerDto";
import { CustomerDetailView } from "@/modules/administration/components/CustomerDetailView";
import { CustomerTable } from "@/modules/administration/components/CustomerTable";
import { useCustomers } from "@/modules/administration/hooks/useCustomers";
import { AccessDeniedState } from "@/shared/components/AccessDeniedState";
import { Modal } from "@/shared/components/Modal";
import { PageErrorState } from "@/shared/components/PageErrorState";
import { PageHeader } from "@/shared/components/PageHeader";

export function CustomersPage() {
  const { canRead, customers, error, loading, reload } = useCustomers();
  const [selected, setSelected] = useState<CustomerDto | null>(null);

  if (!loading && !canRead) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
        <PageHeader
          description="Consulte los clientes con mayor frecuencia de compra."
          title="Clientes"
        />
        <AccessDeniedState />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <PageHeader
        description="Consulte los clientes con mayor frecuencia de compra."
        title="Clientes"
      />

      {error ? <PageErrorState description={error} onRetry={() => void reload()} /> : null}

      {loading ? (
        <div
          aria-live="polite"
          className="flex min-h-56 items-center justify-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm font-medium text-[var(--color-text-muted)] shadow-sm"
        >
          <span
            aria-hidden="true"
            className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-structure)]"
          />
          Cargando clientes...
        </div>
      ) : (
        <CustomerTable customers={customers} onSelect={setSelected} />
      )}

      <Modal
        onClose={() => setSelected(null)}
        open={Boolean(selected)}
        size="lg"
        subtitle="Productos comprados y frecuencia de compra."
        title={selected ? `Detalle de ${selected.name}` : "Detalle del cliente"}
      >
        {selected ? <CustomerDetailView customer={selected} /> : null}
      </Modal>
    </div>
  );
}
