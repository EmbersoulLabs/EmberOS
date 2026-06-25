import { BRAND } from "@/lib/brand";

/** Official EmberSoul flame icon — transparent PNG, flame centered. */
export function EmberLogo({ className = "h-9 w-9" }: { className?: string }) {
  return (
    // Native img — Next.js Image optimizer returns 400 for these large PNGs
    <img
      src="/brand/logo-icon-transparent.png"
      alt=""
      width={36}
      height={36}
      className={`${className} shrink-0 object-contain`}
      decoding="async"
    />
  );
}

/** Full EMBERSOUL LABS horizontal wordmark (official PNG, transparent). */
export function EmberLogoWordmark({
  className = "",
}: {
  className?: string;
}) {
  return (
    <img
      src="/brand/logo-horizontal-transparent.png"
      alt={BRAND.company}
      width={280}
      height={80}
      className={`h-auto w-52 max-w-full shrink-0 object-contain sm:w-60 ${className}`}
      decoding="async"
    />
  );
}
