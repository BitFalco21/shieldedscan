import { addressLabelLogo, type AddressLabel } from "@/domain";
import { EcosystemLogo } from "@/components/EcosystemLogo";
import { LabelIcon } from "@/components/LabelIcon";

export interface AddressLabelMarkProps {
  label: AddressLabel;
  className?: string;
}

/**
 * The mark drawn before an address label's name: the organisation's logo where the label names
 * one (`LABEL_LOGOS`), the tag glyph otherwise, so a name never stands bare.
 */
export function AddressLabelMark({ label, className = "" }: AddressLabelMarkProps) {
  const logo = addressLabelLogo(label);
  if (logo === null) return <LabelIcon className={className} />;
  return <EcosystemLogo logo={logo} data-label-logo className={className} />;
}
