"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function InvitationHandler() {
  const router = useRouter();
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.substring(1));
    const type = params.get("type");
    if (type !== "invite" && type !== "recovery") return;

    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    // Admin-initiated emails carry implicit credentials. Remove them before
    // initializing our PKCE browser client, then explicitly verify the session.
    window.history.replaceState({}, document.title, window.location.pathname);
    if (!accessToken || !refreshToken) {
      router.replace("/auth/recovery-error");
      return;
    }

    const establishSession = async () => {
      try {
        const supabase = createClient();
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          console.error("Staff onboarding session rejected", {
            code: error.code,
            status: error.status,
          });
          router.replace("/auth/recovery-error");
          return;
        }
        router.replace("/auth/set-password");
      } catch {
        console.error("Staff onboarding session could not be established");
        router.replace("/auth/recovery-error");
      }
    };

    void establishSession();
  }, [router]);

  return null;
}
