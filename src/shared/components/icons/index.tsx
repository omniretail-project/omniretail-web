import type { SVGProps } from "react";

/**
 * Set de iconos livianos, puramente presentacionales (sin logica de
 * negocio) para pantallas que necesitan iconografia fuera del Sidebar
 * (que ya tiene el suyo propio para navegacion). Mismo estilo visual
 * (stroke, 24x24, esquinas redondeadas) para que se sientan parte del
 * mismo sistema.
 */
function BaseIcon({ children, className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      {children}
    </svg>
  );
}

export function LockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <rect height="11" rx="2" width="16" x="4" y="11" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </BaseIcon>
  );
}

export function ShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M12 3 4 6v6c0 5 3.4 7.8 8 9 4.6-1.2 8-4 8-9V6Z" />
    </BaseIcon>
  );
}

export function MailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <rect height="16" rx="2" width="20" x="2" y="4" />
      <path d="m3 6 9 7 9-7" />
    </BaseIcon>
  );
}

export function PhoneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M5 4h4l1.5 4.5-2 1.5a12 12 0 0 0 6 6l1.5-2L20 15v4a1 1 0 0 1-1 1C10.6 20 4 13.4 4 5a1 1 0 0 1 1-1Z" />
    </BaseIcon>
  );
}

export function MapPinIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M12 21s7-5.2 7-11a7 7 0 0 0-14 0c0 5.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </BaseIcon>
  );
}

export function CreditCardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <rect height="14" rx="2" width="20" x="2" y="5" />
      <path d="M2 10h20" />
    </BaseIcon>
  );
}

export function PackageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="m3 7 9 5 9-5" />
      <path d="M12 22V12" />
      <path d="M21 7v10l-9 5-9-5V7l9-5 9 5Z" />
    </BaseIcon>
  );
}

export function TruckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M10 17h4V5H2v12h3" />
      <path d="M14 8h4l4 4v5h-3" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </BaseIcon>
  );
}

export function DownloadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 19h16" />
    </BaseIcon>
  );
}

export function CompassIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-2 6-6 2 2-6Z" />
    </BaseIcon>
  );
}

export function PencilIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </BaseIcon>
  );
}

export function ArchiveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <rect height="4" rx="1" width="18" x="3" y="3" />
      <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7" />
      <path d="M10 12h4" />
    </BaseIcon>
  );
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </BaseIcon>
  );
}

export function RefreshIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </BaseIcon>
  );
}

export function ClipboardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <rect height="4" rx="1" width="8" x="8" y="2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </BaseIcon>
  );
}

export function SendIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </BaseIcon>
  );
}

export function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </BaseIcon>
  );
}

export function SaveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </BaseIcon>
  );
}

export function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </BaseIcon>
  );
}

export function LinkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </BaseIcon>
  );
}

export function ExternalLinkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" x2="21" y1="14" y2="3" />
    </BaseIcon>
  );
}

export function UserPlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" x2="19" y1="8" y2="14" />
      <line x1="22" x2="16" y1="11" y2="11" />
    </BaseIcon>
  );
}

export function BroomIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5Z" />
      <path d="M6 18h12" />
      <path d="M8 22h8" />
      <path d="M12 14v4" />
    </BaseIcon>
  );
}
