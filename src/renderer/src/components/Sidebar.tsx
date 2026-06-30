import { cn } from "@/lib/utils";
import {
  ArchiveBoxIcon,
  Bars4Icon,
  ChartBarIcon,
  ClipboardDocumentListIcon,
  Cog6ToothIcon,
  SparklesIcon,
  ChatBubbleLeftRightIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  TagIcon,
} from "@heroicons/react/20/solid";
import { Button } from "@shared/components/ui/button";
import React from "react";

type Page = "dashboard" | "listings" | "items" | "orders" | "purchases" | "offers" | "automations" | "inbox" | "settings" | "activity";

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  loggedIn: boolean;
  checkingSession: boolean;
  loggingIn: boolean;
  onLogin: () => void;
  onLogout: () => void;
}

const navItems: { id: Page; label: string; icon: React.JSX.Element }[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: <ChartBarIcon className="w-5 h-5" />,
  },
  {
    id: "listings",
    label: "Listings",
    icon: <Bars4Icon className="w-5 h-5" />,
  },
  {
    id: "items",
    label: "Items",
    icon: <ArchiveBoxIcon className="w-5 h-5" />,
  },
  {
    id: "orders",
    label: "Orders",
    icon: <ShoppingCartIcon className="w-5 h-5" />,
  },
  {
    id: "offers",
    label: "Offers",
    icon: <TagIcon className="w-5 h-5" />,
  },
  {
    id: "purchases",
    label: "Purchases",
    icon: <ShoppingBagIcon className="w-5 h-5" />,
  },
  {
    id: "automations",
    label: "Automations",
    icon: <SparklesIcon className="w-5 h-5" />,
  },
  {
    id: "inbox",
    label: "Inbox",
    icon: <ChatBubbleLeftRightIcon className="w-5 h-5" />,
  },
  {
    id: "activity",
    label: "Activity Log",
    icon: <ClipboardDocumentListIcon className="w-5 h-5" />,
  },
  {
    id: "settings",
    label: "Settings",
    icon: <Cog6ToothIcon className="w-5 h-5" />,
  },
];

const ACTIVE_CLASSES = ["bg-primary", "text-primary-foreground"];
const INACTIVE_CLASSES = ["text-muted-foreground", "hover:text-foreground", "hover:bg-accent"];

function applyNavClasses(container: HTMLElement, activeId: string) {
  const buttons = container.querySelectorAll<HTMLElement>("[data-nav-id]");
  for (const btn of buttons) {
    if (btn.dataset.navId === activeId) {
      btn.classList.remove(...INACTIVE_CLASSES);
      btn.classList.add(...ACTIVE_CLASSES);
    } else {
      btn.classList.remove(...ACTIVE_CLASSES);
      btn.classList.add(...INACTIVE_CLASSES);
    }
  }
}

const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate, loggedIn, checkingSession, loggingIn, onLogin, onLogout }) => {
  const navRef = React.useRef<HTMLDivElement>(null);

  // Keep DOM in sync when currentPage changes from outside (keyboard shortcut)
  React.useEffect(() => {
    if (navRef.current) applyNavClasses(navRef.current, currentPage);
  }, [currentPage]);

  const handleNav = React.useCallback(
    (page: Page) => {
      // Apply active highlight immediately via DOM, outside React's batch
      if (navRef.current) applyNavClasses(navRef.current, page);
      onNavigate(page);
    },
    [onNavigate],
  );

  return (
    <nav className="flex flex-col h-full w-48 bg-background border-r border-border/50 select-none">
      {/* Nav items */}
      <div ref={navRef} className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            data-nav-id={item.id}
            onClick={() => handleNav(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-150 cursor-pointer",
              currentPage === item.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      {/* Login / logout */}
      <div className="px-2 py-3 border-t border-border/50">
        {checkingSession ? (
          <div className="flex items-center gap-2 px-3 py-1.5">
            <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
            <span className="text-xs text-muted-foreground">Restoring session…</span>
          </div>
        ) : loggedIn ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-3">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs text-muted-foreground">Connected</span>
            </div>
            <Button variant="outline" onClick={onLogout} className="w-full text-sm py-1.5 h-auto">
              Log out
            </Button>
          </div>
        ) : (
          <Button onClick={onLogin} disabled={loggingIn} className="w-full text-sm py-1.5 h-auto">
            {loggingIn ? "Logging in…" : "Log in to Vinted"}
          </Button>
        )}
      </div>
    </nav>
  );
};

export default Sidebar;
