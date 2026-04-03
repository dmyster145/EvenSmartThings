import { type ReactElement, type ReactNode, useState } from 'react';
import {
  AppShell,
  Badge,
  Button,
  Card,
  Page,
  ScreenHeader,
  SectionHeader,
  Select,
  SettingsGroup,
  StatusDot,
} from 'even-toolkit/web';
import {
  IcEditSettings,
  IcEditTrash,
  IcGuideSwip,
  IcMenuEvenHub,
  IcMenuHome,
  IcStatusAlert,
  IcStatusInfo,
  IcStatusSaved,
} from 'even-toolkit/web/icons/svg-icons';

type ListOrderKey = 'main' | 'scenes' | 'rooms' | 'devices' | 'favorites';
type CompanionTab = 'overview' | 'organize' | 'connection';
type CompanionIconKey = 'home' | 'hub' | 'settings' | 'saved' | 'alert' | 'info' | 'scroll' | 'trash';

type InfoRow = {
  title: string;
  subtitle: string;
  icon: CompanionIconKey;
};

const NAV_ITEMS: Array<{ id: CompanionTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'organize', label: 'Organize' },
  { id: 'connection', label: 'Connection' },
];

const LIST_ORDER_OPTIONS = [
  { value: 'alphabetical', label: 'Alphabetical' },
  { value: 'reverse', label: 'Reverse' },
  { value: 'custom', label: 'Custom' },
];

const GLASSES_MENU_OPTIONS = [
  { value: 'resume', label: 'Resume last screen' },
  { value: 'main', label: 'Main screen' },
  { value: 'scenes', label: 'Scenes' },
  { value: 'devices', label: 'Devices' },
  { value: 'favorites', label: 'Favorites' },
];

const LIST_ORDER_ROWS: Array<{ key: ListOrderKey; label: string }> = [
  { key: 'main', label: 'Home screen' },
  { key: 'scenes', label: 'Scenes' },
  { key: 'rooms', label: 'Rooms' },
  { key: 'devices', label: 'Devices' },
  { key: 'favorites', label: 'Favorites' },
];

const STATS_ROWS = [
  { key: 'enabled', label: 'All' },
  { key: 'totalDevices', label: 'Total Devices' },
  { key: 'online', label: 'Online' },
  { key: 'offline', label: 'Offline' },
  { key: 'deviceType', label: 'Device Type' },
  { key: 'protocol', label: 'Protocol' },
  { key: 'onlineStatus', label: 'Online Status' },
  { key: 'switchStatus', label: 'On / Off Status' },
  { key: 'brightness', label: 'Brightness' },
  { key: 'capabilityReadings', label: 'Capability Readings' },
];

const OPEN_IN_EVEN_ROWS: InfoRow[] = [
  {
    title: 'Open from the Even app',
    subtitle: 'The glasses bridge only works when this URL is opened inside the Even app on your phone.',
    icon: 'hub',
  },
  {
    title: 'Finish setup on phone first',
    subtitle: 'Use the companion on your phone to connect SmartThings, then return to the glasses for quick actions.',
    icon: 'home',
  },
];

const OVERVIEW_ROWS: InfoRow[] = [
  {
    title: 'Launch into the right view faster',
    subtitle: 'Use a startup default to jump straight into the screen you need most often.',
    icon: 'home',
  },
  {
    title: 'Keep favorites short and useful',
    subtitle: 'A small favorites set gives you the fastest repeat path to lights, outlets, and common scenes.',
    icon: 'saved',
  },
  {
    title: 'Use list order for muscle memory',
    subtitle: 'Custom ordering helps the same rooms and devices stay under the same gestures every time.',
    icon: 'scroll',
  },
];

const CONNECTION_ROWS: InfoRow[] = [
  {
    title: 'Reconnect when authorization expires',
    subtitle: 'The phone companion can renew access, but a broken SmartThings session still needs a reconnect flow.',
    icon: 'alert',
  },
  {
    title: 'Keep the phone nearby',
    subtitle: 'The phone companion stays responsible for bridge connectivity and SmartThings routing while you use the glasses.',
    icon: 'settings',
  },
];

function borderClassName(): string {
  return 'border border-border';
}

function iconChipClassName(icon: CompanionIconKey): string {
  if (icon === 'saved') return 'bg-positive-alpha text-positive';
  if (icon === 'alert' || icon === 'trash') return 'bg-negative-alpha text-negative';
  return 'bg-accent-alpha text-text';
}

function IconForKey({ icon }: { icon: CompanionIconKey }): ReactElement {
  const common = { width: 18, height: 18 };
  if (icon === 'home') return <IcMenuHome {...common} />;
  if (icon === 'hub') return <IcMenuEvenHub {...common} />;
  if (icon === 'settings') return <IcEditSettings {...common} />;
  if (icon === 'saved') return <IcStatusSaved {...common} />;
  if (icon === 'alert') return <IcStatusAlert {...common} />;
  if (icon === 'scroll') return <IcGuideSwip {...common} />;
  if (icon === 'trash') return <IcEditTrash {...common} />;
  return <IcStatusInfo {...common} />;
}

function SurfaceCard({ children, className = '' }: { children: ReactNode; className?: string }): ReactElement {
  return (
    <Card
      padding="default"
      className={`bg-surface shadow-[0_8px_20px_rgba(0,0,0,0.04)] ${borderClassName()} ${className}`.trim()}
    >
      {children}
    </Card>
  );
}

function IntroCard(): ReactElement {
  return (
    <Card
      padding="default"
      className={`mb-4 bg-surface shadow-[0_10px_24px_rgba(0,0,0,0.05)] ${borderClassName()}`}
    >
      <div className="mb-4 h-1 rounded-full bg-surface-lighter" />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-[6px] bg-accent-alpha">
            <img src="/smartthings.png" alt="SmartThings" className="h-6 w-6 object-contain" />
          </span>
          <div>
            <p className="text-[11px] tracking-[-0.11px] uppercase text-text-dim">Even Hub Companion</p>
            <h1 className="text-[20px] tracking-[-0.6px] font-normal text-text">SmartThings Controls</h1>
          </div>
        </div>
        <Badge variant="accent">Companion</Badge>
      </div>
      <p className="mt-3 text-[15px] tracking-[-0.15px] text-text-dim">
        Control SmartThings scenes, devices, and favorites from your glasses with a setup flow tuned for quick repeat actions.
      </p>
    </Card>
  );
}

function InfoRows({
  label,
  rows,
}: {
  label: string;
  rows: InfoRow[];
}): ReactElement {
  return (
    <SettingsGroup label={label}>
      {rows.map((row) => (
        <div key={row.title} className="legacy-info-row">
          <span className={`legacy-info-row__icon ${iconChipClassName(row.icon)}`}>
            <IconForKey icon={row.icon} />
          </span>
          <div className="legacy-info-row__content">
            <p className="legacy-info-row__title">{row.title}</p>
            <p className="legacy-info-row__subtitle">{row.subtitle}</p>
          </div>
        </div>
      ))}
    </SettingsGroup>
  );
}

function CompanionTabBar({
  activeTab,
  onNavigate,
}: {
  activeTab: CompanionTab;
  onNavigate: (tab: CompanionTab) => void;
}): ReactElement {
  return (
    <Card
      padding="sm"
      className={`mb-4 bg-surface shadow-[0_8px_20px_rgba(0,0,0,0.04)] ${borderClassName()}`}
    >
      <div className="grid grid-cols-3 gap-1">
        {NAV_ITEMS.map((item) => {
          const active = item.id === activeTab;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={
                active
                  ? 'h-11 rounded-[6px] bg-accent text-text-highlight shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                  : 'h-11 rounded-[6px] text-text-dim transition-colors hover:bg-surface-light hover:text-text'
              }
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function SettingsRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="legacy-setting-row">
      <label htmlFor={htmlFor} className="legacy-setting-label">
        {label}
      </label>
      <div className="legacy-setting-control">{children}</div>
    </div>
  );
}

function CustomOrderPanel({ list }: { list: ListOrderKey }): ReactElement {
  return (
    <div id={`custom-order-${list}`} className="legacy-inline-panel" hidden>
      <p className="custom-order-hint">Select an item, then use Up or Down to reorder it.</p>
      <div className="custom-order-controls">
        <Button id={`custom-order-${list}-up`} type="button" variant="secondary" size="sm" aria-label="Move up">
          ↑ Up
        </Button>
        <Button id={`custom-order-${list}-down`} type="button" variant="secondary" size="sm" aria-label="Move down">
          ↓ Down
        </Button>
        <Button id={`custom-order-${list}-done`} type="button" variant="secondary" size="sm">
          Done
        </Button>
      </div>
      <ul id={`custom-order-${list}-ul`} className="reorder-list" />
    </div>
  );
}

function ToggleRow({ id, label }: { id: string; label: string }): ReactElement {
  return (
    <div className="legacy-setting-row">
      <span className="legacy-setting-label">{label}</span>
      <div className="legacy-setting-control flex justify-end">
        <label className="legacy-switch">
          <input id={id} type="checkbox" className="legacy-switch-input" />
          <span className="legacy-switch-track" aria-hidden="true" />
        </label>
      </div>
    </div>
  );
}

function OverviewTab(): ReactElement {
  return (
    <>
      <ScreenHeader
        title="Overview"
        subtitle="Launch defaults, right-panel visibility, and the fastest path back to the devices you use most."
        className="mt-0"
      />

      <SectionHeader title="Launch Behavior" className="mt-0" />
      <SurfaceCard className="mb-3">
        <p className="text-[15px] tracking-[-0.15px] text-text">
          App launches should feel instant. Set a fixed destination or resume your last useful screen so repeat actions take fewer gestures.
        </p>
        <p className="mt-1 text-[13px] tracking-[-0.13px] text-text-dim">
          This preference is honored whenever the app opens, whether you launch it from a QR code, the phone companion, or the glasses.
        </p>
      </SurfaceCard>

      <SettingsGroup label="App Launch">
        <SettingsRow label="Default view" htmlFor="glasses-menu-default">
          <Select id="glasses-menu-default" defaultValue="main" options={GLASSES_MENU_OPTIONS} />
        </SettingsRow>
      </SettingsGroup>

      <SectionHeader title="Right Panel" />
      <SettingsGroup label="Stats">
        {STATS_ROWS.map(({ key, label }) => (
          <ToggleRow key={key} id={`stat-${key}`} label={label} />
        ))}
      </SettingsGroup>

      <SectionHeader title="Quick Start" />
      <InfoRows label="Best Practice" rows={OVERVIEW_ROWS} />

      <SectionHeader title="Documentation" />
      <SurfaceCard>
        <p className="text-[15px] tracking-[-0.15px] text-text">
          Open the local docs when you want setup instructions, usage notes, or implementation details for this SmartThings companion.
        </p>
        <div className="mt-4">
          <a href="doc.html" target="_blank" rel="noopener" className="doc-link">
            Open docs
          </a>
        </div>
      </SurfaceCard>
    </>
  );
}

function OrganizeTab(): ReactElement {
  return (
    <>
      <ScreenHeader
        title="Organize"
        subtitle="Order every list, maintain favorites for fast access, and rename items locally for better scan speed."
        className="mt-0"
      />

      <SectionHeader title="List Order" className="mt-0" />
      <SettingsGroup label="Menus">
        {LIST_ORDER_ROWS.map(({ key, label }) => (
          <div key={key}>
            <SettingsRow label={label} htmlFor={`list-order-${key}`}>
              <Select id={`list-order-${key}`} defaultValue="alphabetical" options={LIST_ORDER_OPTIONS} />
            </SettingsRow>
            <CustomOrderPanel list={key} />
          </div>
        ))}
      </SettingsGroup>

      <SectionHeader title="Favorites" />
      <SurfaceCard>
        <p className="text-[13px] tracking-[-0.13px] text-text-dim">
          Favorites combine scenes and devices into one short path on the glasses.
        </p>
        <ul className="favorites-list mt-4" id="favorites-list" />
        <div className="btn-group mt-4">
          <Button id="add-favorite-btn" type="button" variant="secondary">
            Add to Favorites
          </Button>
        </div>
        <div id="add-favorite-picker" className="picker-box" style={{ display: 'none' }}>
          <label htmlFor="picker-scenes" className="legacy-field-label">
            Scenes
          </label>
          <select id="picker-scenes" size={4} className="legacy-multiselect" />
          <label htmlFor="picker-devices" className="legacy-field-label mt-3">
            Devices
          </label>
          <select id="picker-devices" size={4} className="legacy-multiselect" />
          <div className="btn-group mt-3">
            <Button id="picker-add-btn" type="button">
              Add selected
            </Button>
            <Button id="picker-cancel-btn" type="button" variant="secondary">
              Done
            </Button>
          </div>
        </div>
      </SurfaceCard>

      <SectionHeader title="Custom Names" />
      <SurfaceCard>
        <p className="text-[13px] tracking-[-0.13px] text-text-dim">
          Local names help the glasses interface stay short, recognizable, and fast to scan.
        </p>
        <ul className="renames-list mt-4" id="renames-list" />
        <div className="btn-group mt-4">
          <Button id="add-rename-btn" type="button" variant="secondary">
            Add custom name
          </Button>
        </div>
        <div id="add-rename-form" className="form-box" style={{ display: 'none' }}>
          <label htmlFor="rename-type" className="legacy-field-label">
            Type
          </label>
          <Select
            id="rename-type"
            defaultValue="scene"
            options={[
              { value: 'scene', label: 'Scene' },
              { value: 'room', label: 'Room' },
              { value: 'device', label: 'Device' },
            ]}
          />
          <label htmlFor="rename-item" className="legacy-field-label mt-3">
            Item
          </label>
          <select id="rename-item" className="legacy-select" />
          <label htmlFor="rename-name" className="legacy-field-label mt-3">
            Display name
          </label>
          <input id="rename-name" type="text" placeholder="New name" maxLength={64} className="legacy-input" />
          <div className="btn-group mt-3">
            <Button id="rename-save-btn" type="button">
              Save
            </Button>
            <Button id="rename-cancel-btn" type="button" variant="secondary">
              Done
            </Button>
          </div>
        </div>
      </SurfaceCard>
    </>
  );
}

function ConnectionTab(): ReactElement {
  return (
    <>
      <ScreenHeader
        title="Connection"
        subtitle="SmartThings auth, reconnect actions, and device-level debug utilities for this companion."
        className="mt-0"
      />

      <SectionHeader title="SmartThings" className="mt-0" />
      <SurfaceCard>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-[13px] tracking-[-0.13px] text-text-dim">
            <StatusDot connected />
            <span>Device session</span>
          </div>
          <Badge variant="positive">Connected</Badge>
        </div>
        <p id="smartthings-connection-status" role="status" aria-live="polite" className="mt-4" />
        <div className="btn-group mt-4">
          <Button id="reconnect-smartthings-btn" type="button" variant="secondary">
            Reconnect
          </Button>
          <Button id="disconnect-smartthings-btn" type="button" variant="secondary">
            Disconnect
          </Button>
        </div>
        <div id="disconnect-smartthings-confirm" className="confirm-box" style={{ display: 'none' }}>
          <p className="legacy-subcopy">
            Disconnect SmartThings for this device? You will need to connect again before the glasses can keep controlling scenes and devices.
          </p>
          <div className="btn-group">
            <button type="button" id="disconnect-smartthings-confirm-cancel" className="secondary">
              Cancel
            </button>
            <button type="button" id="disconnect-smartthings-confirm-do" className="negative">
              Disconnect
            </button>
          </div>
        </div>
      </SurfaceCard>

      <SectionHeader title="Companion Access" />
      <InfoRows label="Operational Notes" rows={CONNECTION_ROWS} />

      <SectionHeader title="Debug" />
      <SurfaceCard>
        <p className="text-[15px] tracking-[-0.15px] text-text">
          Keep the runtime console off during normal use. Turn it on only when you need to capture phone-side logs for troubleshooting.
        </p>
      </SurfaceCard>
    </>
  );
}

export function ConfigShell(): ReactElement {
  const [activeTab, setActiveTab] = useState<CompanionTab>('overview');

  return (
    <AppShell className="bg-bg" header={<div />}>
      <Page className="mx-auto w-full max-w-[760px] px-3 pb-12 pt-4">
        <section id="open-in-even" className="pb-6">
          <SurfaceCard>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-accent-alpha text-text">
                  <IcMenuEvenHub width={22} height={22} />
                </span>
                <div>
                  <p className="text-[11px] tracking-[-0.11px] uppercase text-text-dim">Launch Requirement</p>
                  <h1 className="text-[20px] tracking-[-0.6px] font-normal text-text">Open in Even App</h1>
                </div>
              </div>
              <Badge variant="accent">Even App</Badge>
            </div>
            <p className="mt-3 text-[15px] tracking-[-0.15px] text-text-dim">
              Open this URL in the Even app on your phone. A regular browser cannot connect to the glasses bridge.
            </p>
          </SurfaceCard>

          <SectionHeader title="Before You Continue" />
          <InfoRows label="Requirements" rows={OPEN_IN_EVEN_ROWS} />
        </section>

        <section id="config" className="pb-6" style={{ display: 'none' }}>
          <SurfaceCard>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-[6px] bg-accent-alpha">
                  <img src="/smartthings.png" alt="SmartThings" className="h-6 w-6 object-contain" />
                </span>
                <div>
                  <p className="text-[11px] tracking-[-0.11px] uppercase text-text-dim">Connection Setup</p>
                  <h1 className="text-[20px] tracking-[-0.6px] font-normal text-text">Connect SmartThings</h1>
                </div>
              </div>
              <Badge variant="accent">OAuth</Badge>
            </div>
            <p className="mt-3 text-[15px] tracking-[-0.15px] text-text-dim">
              Use SmartThings OAuth to connect this app. The backend stores refresh tokens and can renew access tokens when they expire.
            </p>
            <div className="btn-group mt-4">
              <Button id="connect-smartthings-btn" type="button">
                Connect SmartThings
              </Button>
            </div>
            <p id="config-status" role="status" aria-live="polite" className="mt-4" />
          </SurfaceCard>
        </section>

        <section id="glasses-active" style={{ display: 'none' }}>
          <IntroCard />
          <CompanionTabBar activeTab={activeTab} onNavigate={setActiveTab} />

          <div hidden={activeTab !== 'overview'}>
            <OverviewTab />
          </div>

          <div hidden={activeTab !== 'organize'}>
            <OrganizeTab />
          </div>

          <div hidden={activeTab !== 'connection'}>
            <ConnectionTab />
          </div>
        </section>

        <div className="mt-4">
          <Button id="toggle-debug-btn" type="button" variant="secondary">
            Enable debug console
          </Button>
        </div>

        <div id="debug-log-container" className="debug-console-panel mt-4" style={{ display: 'none' }}>
          <div className="btn-group">
            <Button id="copy-debug-log-btn" type="button" variant="secondary" size="sm">
              Copy log
            </Button>
            <Button id="clear-debug-log-btn" type="button" variant="secondary" size="sm">
              Clear log
            </Button>
          </div>
          <pre id="debug-log" className="debug-console-output" aria-live="polite" />
        </div>

        <div id="config-toast" className="toast" role="status" aria-live="polite" style={{ display: 'none' }} />
      </Page>
    </AppShell>
  );
}
