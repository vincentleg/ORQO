import { demoHref } from "@/lib/demo-path";
import { redirect } from "next/navigation";
import { DEMO_RELATIONSHIP } from "@/lib/demo";

export default function ConnectIndex() {
  redirect(demoHref(`/connect/${DEMO_RELATIONSHIP}`));
}
