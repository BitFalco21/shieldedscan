import type { Transaction } from "@/domain";
import { Counterparty } from "./Counterparty";

/**
 * Hidden below `sm`, on the header and every cell alike (a header hidden without its cells
 * shifts every row by one). On a phone the table scrolls sideways, so the same line sits under the
 * hash in the first column instead: shown, never dropped, and on screen.
 */
export const COUNTERPARTY_CELL_CLASS = "hidden sm:table-cell";

export interface CounterpartyCellProps {
  tx: Transaction;
  /** The address whose page this is: the side shown is read from it. */
  address: string;
}

/** The FROM / TO column of an address's history, from `sm` up. */
export function CounterpartyCell({ tx, address }: CounterpartyCellProps) {
  return (
    <td className={COUNTERPARTY_CELL_CLASS}>
      <Counterparty tx={tx} address={address} />
    </td>
  );
}
