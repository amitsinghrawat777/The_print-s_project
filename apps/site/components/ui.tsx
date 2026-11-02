import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

type Variant = 'primary' | 'dark' | 'light' | 'ghost' | 'glass';
type Size = 'md' | 'lg' | 'sm';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong',
  dark: 'bg-ink text-white hover:bg-neutral-800',
  light: 'bg-white text-ink ring-1 ring-neutral-200 hover:bg-neutral-50',
  ghost: 'text-neutral-600 hover:text-ink hover:bg-neutral-100',
  glass: 'bg-white/10 text-white hover:bg-white/20',
};
const SIZES: Record<Size, string> = {
  sm: 'h-10 px-4 text-sm',
  md: 'h-11 px-5 text-sm',
  lg: 'h-13 px-6 text-base',
};

export function buttonClass(variant: Variant = 'dark', size: Size = 'md', extra = '') {
  return `inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

export function Button({
  variant,
  size,
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant,
  size,
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export function Card({ title, children, className = '' }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl bg-white p-6 ring-1 ring-neutral-200 sm:p-8 ${className}`}>
      {title && <h2 className="mb-4 text-lg font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
      {children}
    </p>
  );
}

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  // grey, not blue: blue is kept for things you can click
  return <p className="text-sm font-semibold tracking-wide text-neutral-500 uppercase">{children}</p>;
}

/** A numbered step marker, used the same way on every page. */
export function StepNumber({ n, dark = false }: { n: number; dark?: boolean }) {
  return (
    <span
      className={`flex size-8 items-center justify-center rounded-full text-sm font-bold ${dark ? 'bg-white text-ink' : 'bg-ink text-white'}`}
      aria-hidden
    >
      {n}
    </span>
  );
}
