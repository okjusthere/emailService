import { BarChart3, ContactRound, Home, Menu, Megaphone, Settings2, X } from "lucide-react";
import { useEffect, useState, type PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";
import type { User } from "./types.js";

const navigation = [
  ["/", "Home", Home],
  ["/campaigns", "Campaigns", Megaphone],
  ["/contacts", "Contacts", ContactRound],
  ["/reports", "Reports", BarChart3],
  ["/settings", "Settings", Settings2],
] as const;

export function AppShell({ user, children }: PropsWithChildren<{ user: User }>) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const closeOnCompactLayout = () => {
      if (window.innerWidth <= 960) setOpen(false);
    };
    closeOnCompactLayout();
    window.addEventListener("resize", closeOnCompactLayout);
    return () => window.removeEventListener("resize", closeOnCompactLayout);
  }, []);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className={open ? "app-sidebar open" : "app-sidebar"}>
        <div className="app-brand">
          <div className="brand-mark small">H</div>
          <div>
            <strong>Homix</strong>
            <span>Marketing</span>
          </div>
          <button
            className="icon-button mobile-only"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === "/"} onClick={() => setOpen(false)}>
              <Icon size={18} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="app-user">
          <span>{(user.displayName ?? user.email).slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user.displayName ?? user.email}</strong>
            <small>{user.role === "ADMIN" ? "Administrator" : "Marketer"}</small>
          </div>
        </div>
      </aside>
      <section className="app-workspace">
        <header className="app-topbar">
          <button
            className="icon-button mobile-only"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
          >
            <Menu size={20} />
          </button>
          <span className="delivery-note">
            <i /> Email service ready
          </span>
          <span>{user.displayName ?? user.email}</span>
        </header>
        <div id="main-content">{children}</div>
      </section>
      {open ? (
        <button className="nav-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />
      ) : null}
    </div>
  );
}
