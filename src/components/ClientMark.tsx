import { NET_UNIDENTIFIED_CLIENT, type NetClient } from "@/domain";
import { ZakuraMark } from "@/components/ZakuraMark";
import { ZcashdMark } from "@/components/ZcashdMark";
import { ZebraMark } from "@/components/ZebraMark";

/**
 * The mark for a Zcash node implementation, by the name it declared in its handshake.
 *
 * Three implementations carry a real mark — Zebra's badge, Zakura's blossom, zcashd's
 * metrics-screen coin — and everything else is a neutral dot: an unknown client, or a node
 * that sent no user agent, is drawn in ink rather than a guessed colour. The mark identifies;
 * it never ranks.
 *
 * Always beside the client's name, so it is decorative (`aria-hidden`). One component so every
 * surface draws a client the same way.
 */
export interface ClientMarkProps {
  client: NetClient;
  /** Rendered size in px, square. */
  size?: number;
}

export function ClientMark({ client, size = 18 }: ClientMarkProps) {
  switch (client) {
    case "Zebra":
      return <ZebraMark size={size} />;
    case "Zakura":
      return <ZakuraMark size={size} />;
    case "zcashd":
      return <ZcashdMark size={size} />;
    default:
      return (
        <svg
          viewBox="0 0 24 24"
          width={size}
          height={size}
          aria-hidden
          focusable="false"
          className="shrink-0 text-ink-faint"
          data-client={client === NET_UNIDENTIFIED_CLIENT ? "unidentified" : "other"}
        >
          <circle cx="12" cy="12" r="5" fill="currentColor" />
        </svg>
      );
  }
}
