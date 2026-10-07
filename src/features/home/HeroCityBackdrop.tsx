/**
 * The homepage's photographic backdrop: a rainy neon city, fixed behind the whole page.
 *
 * The asset is a generated photograph (`brand/hero-city-clean.png`); `brand/hero-city-derive.py`
 * cuts it into the sizes served here, so the derivation is reproducible.
 *
 * - A `<picture>` with a `srcSet`, not a CSS `background-image`, so the browser picks the cut by
 *   viewport width × device pixel ratio (2560 for a 2× laptop, 1280 for a phone). The 2560 cut is
 *   an upscale of a 1764px source, sharpened at derivation time (Lanczos + unsharp mask), since a
 *   browser's bilinear stretch reads soft.
 * - `position: fixed` + `object-cover`, anchored to the bottom, so the street stays under the
 *   panels and the scene holds still while the page scrolls. `background-attachment: fixed` is
 *   ignored by mobile Safari; a fixed element is not.
 * - The grade above it (`.hero-city-grade`) keeps text readable: a near-black pool behind the
 *   hero (`.crt-title`'s dark scanlines read as stripes over a lit background) and a take-down
 *   toward the bottom. Panels stay opaque `--panel`, the colour every token's contrast is
 *   measured against.
 *
 * Decorative: `alt=""` and `aria-hidden`. `fetchPriority="high"` because it is the largest
 * paint, above the fold on every viewport.
 */
export function HeroCityBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 select-none">
      <picture>
        <source
          type="image/webp"
          srcSet="/hero-city/city-1280.webp 1280w, /hero-city/city-1920.webp 1920w, /hero-city/city-2560.webp 2560w"
          sizes="100vw"
        />
        <img
          src="/hero-city/city-1920.jpg"
          srcSet="/hero-city/city-1280.jpg 1280w, /hero-city/city-1920.jpg 1920w, /hero-city/city-2560.jpg 2560w"
          sizes="100vw"
          alt=""
          fetchPriority="high"
          decoding="async"
          className="hero-city-plate h-full w-full object-cover object-bottom"
        />
      </picture>
      <div className="hero-city-grade absolute inset-0" />
    </div>
  );
}
