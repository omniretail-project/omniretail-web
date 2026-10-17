interface BusinessConfigToggleProps {
  checked: boolean;
  description: string;
  disabled?: boolean;
  disabledHint?: string;
  id: string;
  label: string;
  onChange: (checked: boolean) => void;
}

export function BusinessConfigToggle({
  checked,
  description,
  disabled = false,
  disabledHint,
  id,
  label,
  onChange,
}: BusinessConfigToggleProps) {
  const descriptionId = `${id}-description`;

  return (
    <div
      className={`flex min-h-28 items-start justify-between gap-4 rounded-lg border p-4 transition-all duration-150 ${
        checked
          ? "border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5"
          : "border-[var(--color-border)] bg-[var(--color-surface)]"
      } ${disabled ? "opacity-60" : "hover:border-[var(--color-primary)]/40 hover:shadow-sm"}`}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--color-text)]" id={`${id}-label`}>
          {label}
        </p>
        <p className="mt-1 text-sm leading-5 text-[var(--color-text-muted)]" id={descriptionId}>
          {description}
          {disabled && disabledHint ? (
            <span className="mt-1 block font-medium text-[var(--color-warning)]">
              {disabledHint}
            </span>
          ) : null}
        </p>
      </div>
      <button
        aria-checked={checked}
        aria-describedby={descriptionId}
        aria-labelledby={`${id}-label`}
        className="shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        id={id}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span
          aria-hidden="true"
          className={`relative block h-6 w-11 rounded-full border transition-colors ${
            checked
              ? "border-[var(--color-primary)] bg-[var(--color-primary)]"
              : "border-[var(--color-border)] bg-[var(--color-app-background)]"
          }`}
        >
          <span
            className={`absolute top-0.5 block h-5 w-5 rounded-full bg-[var(--color-surface)] shadow-sm transition-transform ${
              checked ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </span>
      </button>
    </div>
  );
}
