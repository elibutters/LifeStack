import { redirect } from "next/navigation";

// The keys page moved to the account menu; old links and bookmarks still land there.
export default function Shortcuts() {
  redirect("/api-keys");
}
