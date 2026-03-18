import { cn } from "@/lib/utils";
import { ArchiveBoxIcon, Bars4Icon, Cog6ToothIcon, ShoppingCartIcon } from "@heroicons/react/20/solid";
import React from "react";
import { Button } from "./ui/button";

type Page = "listings" | "items" | "orders" | "settings";

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  loggedIn: boolean;
  loggingIn: boolean;
  onLogin: () => void;
  onLogout: () => void;
}

const navItems: { id: Page; label: string; icon: React.JSX.Element }[] = [
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
    id: "settings",
    label: "Settings",
    icon: <Cog6ToothIcon className="w-5 h-5" />,
  },
];

const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate, loggedIn, loggingIn, onLogin, onLogout }) => {
  return (
    <nav className="flex flex-col h-full w-48 bg-background border-r border-border/50 select-none">
      {/* App branding */}
      <div className="px-4 py-4 border-b border-border/50">
        <h1 className="text-sm font-semibold text-foreground tracking-wide">Vinted Manager</h1>
      </div>

      {/* Nav items */}
      <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
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
        {loggedIn ? (
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
