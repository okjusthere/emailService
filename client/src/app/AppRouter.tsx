import { Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense, type PropsWithChildren } from "react";
import { AppShell } from "./AppShell.js";
import type { User } from "./types.js";
import { HomePage } from "../pages/HomePage.js";
import { CampaignComposerPage } from "../pages/CampaignComposerPage.js";
import { CampaignsPage } from "../pages/CampaignsPage.js";
import { CampaignDetailPage } from "../pages/CampaignDetailPage.js";
import { ContactsPage } from "../pages/ContactsPage.js";
import { LoadingBlock } from "../components/ui/Feedback.js";

const ReportsPage = lazy(() =>
  import("../pages/ReportsPage.js").then((module) => ({ default: module.ReportsPage }))
);
const SettingsPage = lazy(() =>
  import("../pages/SettingsPage.js").then((module) => ({ default: module.SettingsPage }))
);
const PropertyLibraryPage = lazy(() =>
  import("../pages/PropertyLibraryPage.js").then((module) => ({
    default: module.PropertyLibraryPage,
  }))
);

function Deferred({ children }: PropsWithChildren) {
  return (
    <Suspense
      fallback={
        <main className="simple-page">
          <LoadingBlock />
        </main>
      }
    >
      {children}
    </Suspense>
  );
}

export function AppRouter({ user }: { user: User }) {
  return (
    <AppShell user={user}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/campaigns/new" element={<HomePage />} />
        <Route path="/campaigns" element={<CampaignsPage />} />
        <Route path="/campaigns/:id/edit" element={<CampaignComposerPage user={user} />} />
        <Route path="/campaigns/:id/compose" element={<CampaignComposerPage user={user} />} />
        <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route
          path="/reports"
          element={
            <Deferred>
              <ReportsPage />
            </Deferred>
          }
        />
        <Route
          path="/settings"
          element={
            <Deferred>
              <SettingsPage user={user} />
            </Deferred>
          }
        />
        <Route
          path="/settings/operations"
          element={
            <Deferred>
              <SettingsPage user={user} />
            </Deferred>
          }
        />
        <Route
          path="/properties"
          element={
            <Deferred>
              <PropertyLibraryPage />
            </Deferred>
          }
        />
        <Route path="/listings" element={<Navigate to="/properties" replace />} />
        <Route path="/audiences" element={<Navigate to="/contacts?tab=lists" replace />} />
        <Route path="/analytics" element={<Navigate to="/reports" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
