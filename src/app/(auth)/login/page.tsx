import { redirect } from "next/navigation";

// TRD §3 lists /login; DESIGN.md §3.1 puts sign-in at "/".
export default function Login() {
  redirect("/");
}
