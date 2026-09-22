import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/Button";
import { EntityListSearch } from "@/design-system";
import { canReadView } from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";
import {
  COM_FILTER_ALL,
  COM_FILTER_UNREAD,
  COM_MODULE_TITLE,
  COM_SEARCH_PLACEHOLDER,
  COM_SURFACE_ANNOUNCEMENTS,
  COM_SURFACE_MESSAGES,
  COM_SURFACE_NOTIFICATIONS,
} from "../../lib/pariteCommunicationUxContract";

export type CommunicationSurface = "messages" | "announcements" | "notifications";

export function CommunicationChrome({
  surface,
  title = COM_MODULE_TITLE,
  searchPlaceholder = COM_SEARCH_PLACEHOLDER,
  unreadLabel = COM_FILTER_UNREAD,
  countLabel,
  primaryAction,
  search,
  onSearch,
  unreadOnly,
  onUnreadOnly,
  children,
}: {
  surface: CommunicationSurface;
  title?: string;
  searchPlaceholder?: string;
  unreadLabel?: string;
  countLabel?: string;
  primaryAction?: ReactNode;
  search: string;
  onSearch: (value: string) => void;
  unreadOnly: boolean;
  onUnreadOnly: (value: boolean) => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const ctx = usePermissionContext();
  const canMessages = canReadView(ctx, "messages");
  const canAnnouncements = canReadView(ctx, "announcements");
  const canNotifications = canReadView(ctx, "notifications");

  return (
    <div className="space-y-3">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          {countLabel ? <p className="text-sm text-muted">{countLabel}</p> : null}
        </div>
        {primaryAction ? <div className="no-print shrink-0">{primaryAction}</div> : null}
      </header>
      <nav aria-label="Communication" className="flex flex-wrap gap-2">
        {canMessages ? (
          <Button
            type="button"
            size="sm"
            variant={surface === "messages" ? "primary" : "secondary"}
            onClick={() => navigate("/messages")}
          >
            {COM_SURFACE_MESSAGES}
          </Button>
        ) : null}
        {canAnnouncements ? (
          <Button
            type="button"
            size="sm"
            variant={surface === "announcements" ? "primary" : "secondary"}
            onClick={() => navigate("/annonces")}
          >
            {COM_SURFACE_ANNOUNCEMENTS}
          </Button>
        ) : null}
        {canNotifications ? (
          <Button
            type="button"
            size="sm"
            variant={surface === "notifications" ? "primary" : "secondary"}
            onClick={() => navigate("/notifications")}
          >
            {COM_SURFACE_NOTIFICATIONS}
          </Button>
        ) : null}
      </nav>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <EntityListSearch
          id={`communication-search-${surface}`}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
        />
        <div className="flex gap-2">
          <Button type="button" size="sm" variant={!unreadOnly ? "primary" : "secondary"} onClick={() => onUnreadOnly(false)}>
            {COM_FILTER_ALL}
          </Button>
          <Button type="button" size="sm" variant={unreadOnly ? "primary" : "secondary"} onClick={() => onUnreadOnly(true)}>
            {unreadLabel}
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}

export function useCommunicationListQuery() {
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  return { search, setSearch, unreadOnly, setUnreadOnly };
}
