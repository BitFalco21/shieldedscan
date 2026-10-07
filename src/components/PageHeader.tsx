import type { ReactNode } from "react";
import { Breadcrumb, type BreadcrumbItem } from "@/components/Breadcrumb";

export interface PageHeaderProps {
  /**
   * The small uppercase line above the title — a section name such as CHAIN or NETWORK.
   * Optional when a `breadcrumb` is given: on a detail page the trail is that line.
   */
  eyebrow?: ReactNode;
  /** The trail above a detail page's title. Drawn before the eyebrow when both are given. */
  breadcrumb?: readonly BreadcrumbItem[];
  title: ReactNode;
  /**
   * `page` (default) is a page's name — "Blocks", "Block #3,428,150". `identifier` is for a
   * title that IS a hash or an address: smaller, regular weight and free to break anywhere, so
   * 64 hex characters stay legible and selectable instead of blowing out a phone's width. It
   * lays the title out as a wrapping row, so a copy button can sit inside the `<h1>`.
   */
  titleVariant?: "page" | "identifier";
  /** Controls at the right of the title row — export, copy, prev/next. */
  actions?: ReactNode;
  /** The one line of facts under the title — confirmations, time, status. */
  meta?: ReactNode;
  /** The page's introduction, at the one lede width every page shares. */
  lede?: ReactNode;
  /** Anything else under the title, rendered as given, after the lede. */
  children?: ReactNode;
}

const TITLE: Record<NonNullable<PageHeaderProps["titleVariant"]>, string> = {
  page: "text-2xl font-bold tracking-tight text-ink-bright",
  identifier: "flex min-w-0 flex-wrap items-baseline gap-1 text-lg break-all text-ink-bright",
};

/**
 * The heading block every page opens with: an eyebrow microlabel (or a breadcrumb), the
 * `<h1>`, and what sits beneath it. The header owns spacing and lede width so pages cannot
 * drift apart; `children` remains for whatever a page genuinely needs beyond them.
 */
export function PageHeader({
  eyebrow,
  breadcrumb,
  title,
  titleVariant = "page",
  actions,
  meta,
  lede,
  children,
}: PageHeaderProps) {
  const heading =
    actions === undefined ? (
      <h1 className={`mt-1 ${TITLE[titleVariant]}`}>{title}</h1>
    ) : (
      <div className="mt-1 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h1 className={`min-w-0 ${TITLE[titleVariant]}`}>{title}</h1>
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      </div>
    );

  return (
    <header className="pt-8 pb-6">
      {breadcrumb === undefined ? null : <Breadcrumb items={breadcrumb} />}
      {eyebrow === undefined ? null : (
        <div className={breadcrumb === undefined ? "microlabel" : "microlabel mt-1"}>{eyebrow}</div>
      )}
      {heading}
      {meta === undefined ? null : (
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-dim">{meta}</div>
      )}
      {lede === undefined ? null : (
        <div className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">{lede}</div>
      )}
      {children}
    </header>
  );
}
