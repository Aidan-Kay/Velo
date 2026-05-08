import type { BrowserWindow } from "electron";

import type { AppSettings } from "../../shared/types";
import type { AppState, NotificationDeps } from "../app-state";
import type { PollingManager } from "../polling";
import type { RelistingManager } from "../relisting";

/** Shared dependencies passed to every IPC domain module's setup() function. */
export interface IpcDeps {
  state: AppState;
  getSettings: () => AppSettings;
  setSettings: (s: AppSettings) => void;
  getWindow: () => BrowserWindow | null;
  polling: PollingManager;
  relisting: RelistingManager;
  notifDeps: NotificationDeps;
}
