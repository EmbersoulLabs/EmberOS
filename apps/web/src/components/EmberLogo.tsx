import { BRAND } from "@/lib/brand";

/** Official Ember OS app icon. */
export function EmberLogo({ className = "h-9 w-9" }: { className?: string }) {
  return (
    // Native img — Next.js Image optimizer returns 400 for these large PNGs
    <img
      src="/brand/logo-icon.png"
      alt=""
      width={36}
      height={36}
      className={`${className} shrink-0 object-contain`}
      decoding="async"
    />
  );
}

/** Official Ember OS logo mark (full brand lockup). */
export function EmberLogoWordmark({
  className = "",
}: {
  className?: string;
}) {
  return (
    <img
      src="/brand/logo-horizontal.png"
      alt={BRAND.company}
      width={280}
      height={280}
      className={`h-auto w-40 max-w-full shrink-0 object-contain sm:w-48 ${className}`}
      decoding="async"
    />
  );
}
