import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ArchiveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7h18" />
      <path d="M5 7v12h14V7" />
      <path d="M8 7V4h8v3" />
      <path d="M10 12h4" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 12 4 4L19 6" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m15 18-6-6 6-6" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  );
}

export function FilterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5h16" />
      <path d="M7 12h10" />
      <path d="M10 19h4" />
    </Icon>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.6 2.5 15.4 0 18" />
      <path d="M12 3c-2.5 2.6-2.5 15.4 0 18" />
    </Icon>
  );
}

export function HistoryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </Icon>
  );
}

export function MobileIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="18" rx="2" width="10" x="7" y="3" />
      <path d="M11 18h2" />
    </Icon>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 20h9" />
      <path d="m16.5 3.5 4 4L8 20H4v-4L16.5 3.5z" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

export function PosIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="14" rx="2" width="16" x="4" y="5" />
      <path d="M8 9h8" />
      <path d="M8 13h2" />
      <path d="M14 13h2" />
    </Icon>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12 12 20 4 12V4h8l8 8z" />
      <path d="M8.5 8.5h.01" />
    </Icon>
  );
}
