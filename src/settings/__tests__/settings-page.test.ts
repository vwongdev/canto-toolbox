// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { SettingsPage } from '../settings.js';
import { SECTIONS } from '../settings-view.js';
import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  normaliseSettings,
  type Settings,
} from '../../shared/settings.js';

// The real page markup, minus the asset references happy-dom would try to fetch.
const HTML = readFileSync('src/settings/settings.html', 'utf-8')
  .replace(/<link\b[^>]*>/g, '')
  .replace(/<script\b[\s\S]*?<\/script>/g, '');

describe('SettingsPage', () => {
  let document: Document;
  let stored: Settings;
  let save: ReturnType<typeof vi.fn<(changes: Partial<Settings>) => Promise<Settings>>>;

  const control = <T extends HTMLElement>(key: string) =>
    document.querySelector(`#setting-${key}`) as T;

  function change(element: HTMLElement): void {
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  beforeEach(() => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
    stored = DEFAULT_SETTINGS;
    save = vi.fn(async changes => {
      stored = normaliseSettings({ ...stored, ...changes });
      return stored;
    });
    vi.mocked(chrome.storage.sync.get).mockResolvedValue({} as never);
    new SettingsPage(document, save).init();
  });

  // Anything stored but not on the page is a setting the reader cannot reach.
  it('offers a control for every setting', () => {
    const offered = SECTIONS.flatMap(section => section.fields.map(field => field.key));
    expect(offered.sort()).toEqual([...SETTING_KEYS].sort());
    for (const key of SETTING_KEYS) expect(control(key)).not.toBeNull();
  });

  it('shows the stored settings once they are read', async () => {
    await vi.waitFor(() => expect(control<HTMLInputElement>('maxCards').value).toBe('20'));
    expect(control<HTMLSelectElement>('primaryLanguage').value).toBe('mandarin');
    expect(control<HTMLInputElement>('hideRomanisation').checked).toBe(false);
  });

  it('saves a number as a number', () => {
    const input = control<HTMLInputElement>('minCount');
    input.value = '3';
    change(input);

    expect(save).toHaveBeenCalledWith({ minCount: 3 });
  });

  it('shows the value the store kept when it clamped the one typed', async () => {
    const input = control<HTMLInputElement>('maxCards');
    input.value = '500';
    change(input);

    await vi.waitFor(() => expect(input.value).toBe('100'));
    expect(document.getElementById('settings-status')!.textContent).toBe('Saved');
  });

  it('ignores an emptied number box', () => {
    const input = control<HTMLInputElement>('maxCards');
    input.value = '';
    change(input);

    expect(save).not.toHaveBeenCalled();
  });

  it('saves a toggle and a choice', () => {
    const toggle = control<HTMLInputElement>('hideRomanisation');
    toggle.checked = true;
    change(toggle);

    const select = control<HTMLSelectElement>('primaryLanguage');
    select.value = 'cantonese';
    change(select);

    expect(save).toHaveBeenCalledWith({ hideRomanisation: true });
    expect(save).toHaveBeenCalledWith({ primaryLanguage: 'cantonese' });
  });

  it('says so when a save fails', async () => {
    save.mockRejectedValueOnce(new Error('quota'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const toggle = control<HTMLInputElement>('hideRomanisation');
    toggle.checked = true;
    change(toggle);

    const status = document.getElementById('settings-status')!;
    await vi.waitFor(() => expect(status.textContent).toBe('Could not save'));
    expect(status.classList.contains('is-error')).toBe(true);
  });
});

describe('SettingsPage site access', () => {
  function open(): Document {
    const document = new DOMParser().parseFromString(HTML, 'text/html');
    vi.mocked(chrome.storage.sync.get).mockResolvedValue({} as never);
    new SettingsPage(document, vi.fn()).init();
    return document;
  }

  it('stays out of the way while the extension can read pages', async () => {
    const document = open();

    await vi.waitFor(() => expect(chrome.permissions.contains).toHaveBeenCalled());
    expect(document.getElementById('site-access')!.hidden).toBe(true);
  });

  // Firefox lets the reader withdraw host access, which silently stops hover.
  it('asks for access again once it has been withdrawn', async () => {
    vi.mocked(chrome.permissions.contains).mockResolvedValueOnce(false as never);
    const document = open();
    const notice = document.getElementById('site-access')!;
    await vi.waitFor(() => expect(notice.hidden).toBe(false));

    notice.querySelector('button')!.click();

    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['<all_urls>'] });
    await vi.waitFor(() => expect(notice.hidden).toBe(true));
  });
});
