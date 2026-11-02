import Image, { type StaticImageData } from 'next/image';

/** A desktop app screenshot in a plain window frame. */
export function WindowFrame({ src, alt, priority }: { src: StaticImageData; alt: string; priority?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10">
      <div className="flex h-8 items-center gap-1.5 border-b border-neutral-200 bg-neutral-100 px-3" aria-hidden>
        <span className="size-2.5 rounded-full bg-neutral-300" />
        <span className="size-2.5 rounded-full bg-neutral-300" />
        <span className="size-2.5 rounded-full bg-neutral-300" />
      </div>
      <Image src={src} alt={alt} priority={priority} sizes="(min-width: 1024px) 900px, 100vw" className="block h-auto w-full" />
    </div>
  );
}

/** A phone screenshot, cropped to the top of the screen. */
export function PhoneFrame({ src, alt, className = '' }: { src: StaticImageData; alt: string; className?: string }) {
  return (
    <div className={`rounded-[2.2rem] bg-ink p-2 shadow-2xl ring-1 ring-white/10 ${className}`}>
      <div className="relative aspect-[9/19] overflow-hidden rounded-[1.7rem] bg-white">
        <Image src={src} alt={alt} fill sizes="280px" className="object-cover object-top" />
      </div>
    </div>
  );
}
