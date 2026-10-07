"use client";

export interface ExportJsonButtonProps {
  /** The object to download — serialised on click, entirely client-side. */
  data: unknown;
  filename: string;
  /**
   * Merge the text content of the element with this id in as `rawHex`, read at click time.
   *
   * The transaction page already renders the hex once; carrying it inside `data` as well would
   * serialise the same bytes a second time into the RSC payload. Absent element → `rawHex:
   * null`, which is what the domain object says for a transaction whose hex was not carried.
   */
  withRawHexFrom?: string;
}

/**
 * Downloads `data` as a JSON file. A Blob and an anchor click: nothing leaves the machine,
 * nothing is fetched, nothing is stored. What lands in the file is the rendered domain object
 * verbatim, so the export matches what the page shows.
 *
 *  - The anchor is in the document before it is clicked: Firefox ignores a synthetic click on
 *    an element outside the tree.
 *  - `revokeObjectURL` is deferred a tick: revoking straight after `click()` races the
 *    browser's own read of the blob and cancels the download.
 */
export function ExportJsonButton({ data, filename, withRawHexFrom }: ExportJsonButtonProps) {
  const download = () => {
    const payload =
      withRawHexFrom === undefined
        ? data
        : {
            ...(data as Record<string, unknown>),
            rawHex: document.getElementById(withRawHexFrom)?.textContent ?? null,
          };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 0);
  };

  return (
    <button
      type="button"
      onClick={download}
      className="panel inline-flex cursor-pointer items-center gap-1.5 px-3 py-1 text-xs text-ink-dim hover:text-green"
    >
      {/* A glyph, not an icon library — the same constraint CopyButton works under. */}
      <span aria-hidden>↓</span>
      export json
    </button>
  );
}
