import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export const OverviewIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </Icon>
);

export const CalendarIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="1.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);

export const SignOutIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M9.5 4.5h-3a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h3M15 8l4 4-4 4M19 12H9.5" />
  </Icon>
);

export const ChevronLeftIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M14.5 6l-6 6 6 6" />
  </Icon>
);

export const ChevronRightIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M9.5 6l6 6-6 6" />
  </Icon>
);

export const SleepIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M20 15.5A7.5 7.5 0 0 1 10 5.5 8.5 8.5 0 1 0 20 15.5z" />
  </Icon>
);

export const UserIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="3.25" />
    <path d="M5.5 19.5c.8-3.2 3.2-5 6.5-5s5.7 1.8 6.5 5" />
  </Icon>
);

export const LinkIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M9.5 14.5l5-5" />
    <path d="M11 8.5l.8-.8a3.2 3.2 0 0 1 4.5 4.5l-.8.8M13 15.5l-.8.8a3.2 3.2 0 0 1-4.5-4.5l.8-.8" />
  </Icon>
);

export const KeyIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="8" cy="15" r="3.25" />
    <path d="M10.3 12.7L18.5 4.5M15.5 7.5l2.5 2.5M13 10l2 2" />
  </Icon>
);

export const ShieldIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 4l6.5 2.5v5c0 4-2.7 6.7-6.5 8.5-3.8-1.8-6.5-4.5-6.5-8.5v-5z" />
    <path d="M9.5 12l1.8 1.8 3.4-3.6" />
  </Icon>
);

export const ChevronUpIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M6 14.5l6-6 6 6" />
  </Icon>
);

export const FinanceIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 19.5h16" />
    <path d="M6.5 16V11M12 16V6.5M17.5 16v-3.5" />
  </Icon>
);

export const LogIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="4.5" y="4.5" width="15" height="15" rx="1.5" />
    <path d="M8.5 12.5l2.5 2.5 4.5-5" />
  </Icon>
);
