import type { Metadata } from "next";
import { BrandPage } from "@/features/brand/BrandPage";

export const metadata: Metadata = {
  title: "Brand identity",
  description:
    "The Phosphor design language: the ./shieldedscan name and mark, the palette and its contrast rules, the type, and what anyone may do with them.",
};

export default function Page() {
  return <BrandPage />;
}
