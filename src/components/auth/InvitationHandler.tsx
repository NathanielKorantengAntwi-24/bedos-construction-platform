"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function InvitationHandler() {
  useEffect(() => {
    const supabase = createClient();

    const handleInvitation = async () => {
      const hash = window.location.hash;

      if (hash.includes("access_token=")) {
        const params = new URLSearchParams(hash.substring(1));

        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");

        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error) {
            console.error("Invitation session error:", error);
            return;
          }

          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );

          window.location.href = "/auth/set-password";
          return;
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        window.location.href = "/auth/set-password";
      }
    };

    handleInvitation();
  }, []);

  return null;
}