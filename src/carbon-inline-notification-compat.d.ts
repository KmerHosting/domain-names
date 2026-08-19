import type { ReactNode } from "react";
import "@carbon/react";

declare module "@carbon/react" {
  interface InlineNotificationProps {
    /**
     * Transitional compatibility slot for three existing contextual actions.
     * Navigation remains available from the canonical Carbon shell.
     * Replace these call sites with ActionableNotification in a follow-up cleanup.
     */
    actions?: ReactNode;
  }
}
