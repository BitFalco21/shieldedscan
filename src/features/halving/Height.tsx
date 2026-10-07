import { formatCount } from "@/lib/format";

export interface HeightProps {
  value: number;
}

/** A block height, grouped. Heights are the exact figures on the halving page and read as such. */
export function Height({ value }: HeightProps) {
  return <span className="font-mono tabular-nums">{formatCount(value)}</span>;
}
