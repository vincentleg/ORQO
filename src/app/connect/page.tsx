import { redirect } from "next/navigation";
import { DEMO_RELATIONSHIP } from "@/lib/demo";

export default function ConnectIndex() {
  redirect(`/connect/${DEMO_RELATIONSHIP}`);
}
