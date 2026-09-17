import type { ReactNode } from "react";
import "./studio.css";

export const metadata = {
  title: "Ad Studio",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default function AdsLayout({ children }: { children: ReactNode }) {
  return children;
}
