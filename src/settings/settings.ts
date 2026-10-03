import { saveSettings, watchSettings, type Settings } from '../shared/settings.js';
import { fillSettingsForm, renderSettingsForm, showStatus, type SettingChange } from './settings-view.js';

export const ELEMENT_IDS = {
  form: 'settings-form',
  status: 'settings-status',
  siteAccess: 'site-access',
} as const;

const ALL_SITES: chrome.permissions.Permissions = { origins: ['<all_urls>'] };

type Save = (changes: Partial<Settings>) => Promise<Settings>;

/**
 * Every control saves on change; there is no Save button to forget. What was
 * stored is drawn back into the form, so a value the store clamped — 500 cards
 * a session — shows the number that will actually be used.
 */
export class SettingsPage {
  private readonly document: Document;
  private readonly save: Save;

  constructor(document: Document, save: Save = changes => saveSettings(changes)) {
    this.document = document;
    this.save = save;
  }

  init(): void {
    const form = this.document.getElementById(ELEMENT_IDS.form);
    const status = this.document.getElementById(ELEMENT_IDS.status);
    if (!form || !status) {
      console.error('[Settings] Required DOM elements not found!');
      return;
    }

    const change: SettingChange = (key, value) => {
      this.save({ [key]: value })
        .then(saved => {
          fillSettingsForm(this.document, saved);
          showStatus(status, 'Saved');
        })
        .catch((error: unknown) => {
          console.error('[Settings] Failed to save:', error);
          showStatus(status, 'Could not save', true);
        });
    };

    renderSettingsForm(form, change);

    // Another window's options page, or another machine through sync, can
    // change these while this one is open.
    watchSettings(settings => fillSettingsForm(this.document, settings));

    const siteAccess = this.document.getElementById(ELEMENT_IDS.siteAccess);
    if (siteAccess) void this.offerSiteAccess(siteAccess);
  }

  /**
   * Firefox treats host permissions as optional and lets the reader withdraw
   * them, which turns off the content script on every page. Chrome grants them
   * at install, so there the notice never shows.
   */
  private async offerSiteAccess(notice: HTMLElement): Promise<void> {
    if (await chrome.permissions.contains(ALL_SITES)) return;

    notice.hidden = false;
    notice.querySelector('button')?.addEventListener('click', () => {
      // Firefox only prompts from a call made synchronously in the click.
      chrome.permissions.request(ALL_SITES)
        .then(granted => { notice.hidden = granted; })
        .catch((error: unknown) => console.error('[Settings] Could not request site access:', error));
    });
  }
}

export const settingsPage = new SettingsPage(document);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => settingsPage.init());
} else {
  settingsPage.init();
}
