import type { BankAccountType } from "@/core/entities";
import type { BankAccountDto } from "@/modules/administration/application/dto/BankAccountDto";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { StatusBadge } from "@/shared/components/StatusBadge";

const accountTypeLabels: Record<BankAccountType, string> = {
  monetary: "Monetaria",
  savings: "Ahorro",
};

interface BankAccountTableProps {
  accounts: BankAccountDto[];
  onSelect: (account: BankAccountDto) => void;
}

export function BankAccountTable({ accounts, onSelect }: BankAccountTableProps) {
  const columns: DataTableColumn<BankAccountDto>[] = [
    {
      key: "bankName",
      header: "Banco",
      cell: (account) => (
        <span className="font-semibold text-[var(--color-title)]">{account.bankName}</span>
      ),
    },
    {
      key: "holderName",
      header: "Titular",
      cell: (account) => <span className="text-[var(--color-text)]">{account.holderName}</span>,
    },
    {
      key: "alias",
      header: "Alias",
      cell: (account) => <span className="text-[var(--color-text)]">{account.alias}</span>,
    },
    {
      key: "accountNumber",
      header: "Número",
      cell: (account) => (
        <span className="whitespace-nowrap font-mono font-medium tracking-wide text-[var(--color-title)]">
          {account.accountNumberMasked}
        </span>
      ),
    },
    {
      key: "accountType",
      header: "Tipo",
      cell: (account) => (
        <span className="text-[var(--color-text)]">{accountTypeLabels[account.accountType]}</span>
      ),
    },
    {
      key: "currency",
      header: "Moneda",
      cell: (account) => (
        <span className="font-semibold text-[var(--color-title)]">{account.currency}</span>
      ),
    },
    {
      key: "status",
      header: "Estado",
      cell: (account) => <StatusBadge status={account.status} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={accounts}
      emptyMessage="Aún no hay cuentas bancarias registradas."
      headerClassName="bg-[var(--color-structure)] text-white [&_th]:text-white"
      onRowClick={onSelect}
      rowKey={(account) => account.id}
    />
  );
}
