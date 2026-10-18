"use client";

import { useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { SegmentedControl } from "@/components/dashboard/usage/segmented-control";
import { ApiPreferencesSection } from "./api-preferences-section";
import { ProfileSection } from "./profile-section";
import { SecuritySection } from "./security-section";
import { SettingsSection } from "./settings-section";
import type { AccountSession } from "@/lib/account-types";
import type { PublicModel } from "@/lib/model-types";
import { themeOptions } from "@/lib/theme-config";

const subscribe = () => () => {};
const densityOptions = [{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }] as const;

export function SettingsPage({ sessions, catalog, loadError, apiBaseUrl }: { sessions: AccountSession[]; catalog: PublicModel[]; loadError: boolean; apiBaseUrl: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const selectedTheme = mounted && (theme === "light" || theme === "dark") ? theme : "system";

  return (
    <div className="settings-page max-w-[var(--content-settings)]">
      <h1 className="ui-page-title">Settings</h1>
      <p className="ui-page-description">Manage your account and workspace preferences.</p>
      <div data-density={density} className="settings-panel mt-6 rounded-lg border border-border bg-card px-4 sm:px-6">
        <ProfileSection />
        <SettingsSection id="appearance" title="Appearance" description="Make the interface feel right for you.">
          <div className="max-w-[520px] space-y-6">
            <div className="settings-preference-row">
              <div><h3 className="text-[13px] font-medium">Theme</h3><p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">Choose a theme or match your device.</p></div>
              <SegmentedControl label="Theme" value={selectedTheme} options={themeOptions} onChange={setTheme} />
            </div>
            <div className="settings-preference-row">
              <div><h3 className="text-[13px] font-medium">Interface density</h3><p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">Adjust the spacing between settings.</p></div>
              <SegmentedControl label="Interface density" value={density} options={densityOptions} onChange={setDensity} />
            </div>
          </div>
        </SettingsSection>
        <ApiPreferencesSection catalog={catalog} loadError={loadError} apiBaseUrl={apiBaseUrl} />
        <SecuritySection sessions={sessions} />
      </div>
      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">Profile changes are saved to your account. Interface density and API preferences remain local previews.</p>
    </div>
  );
}
