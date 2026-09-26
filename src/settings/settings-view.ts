import { createElement } from '../shared/dom-element.js';
import { SETTING_SPECS, type SettingKey, type Settings } from '../shared/settings.js';

/**
 * What the options page says about each setting. The control itself follows
 * from the setting's spec — a number box, a checkbox or a menu — so a new
 * boolean needs only a line here to appear on the page.
 */
interface FieldCopy {
  key: SettingKey;
  label: string;
  hint?: string;
  /** Labels for a choice setting's options, in the order the spec lists them. */
  options?: Readonly<Record<string, string>>;
}

interface SectionCopy {
  title: string;
  fields: readonly FieldCopy[];
}

export const SECTIONS: readonly SectionCopy[] = [
  {
    title: 'Definitions',
    fields: [
      {
        key: 'primaryLanguage',
        label: 'Show first',
        hint: 'Which reading leads, in the popup, the word list and on flashcards.',
        options: { mandarin: 'Mandarin', cantonese: 'Cantonese' },
      },
      {
        key: 'script',
        label: 'Headword script',
        hint: 'The other form is still shown beside it.',
        options: {
          'as-written': 'As written on the page',
          traditional: 'Traditional',
          simplified: 'Simplified',
        },
      },
      {
        key: 'hideRomanisation',
        label: 'Hide Pinyin and Jyutping until pressed',
        hint: 'For reading practice: say the word before checking it.',
      },
    ],
  },
  {
    title: 'Flashcards',
    fields: [
      {
        key: 'maxCards',
        label: 'Cards per session',
        hint: 'Reviews that are due fill the session first.',
      },
      {
        key: 'maxNewCards',
        label: 'New cards per session',
        hint: 'Set to 0 to catch up on reviews without adding words.',
      },
      {
        key: 'minCount',
        label: 'Look-ups before a word joins the deck',
        hint: '+ Study adds a word at once, whatever this is set to.',
      },
    ],
  },
];

export type SettingChange = <K extends SettingKey>(key: K, value: Settings[K]) => void;

function controlId(key: SettingKey): string {
  return `setting-${key}`;
}

function createControl(field: FieldCopy, onChange: SettingChange): HTMLElement {
  const spec = SETTING_SPECS[field.key];
  const id = controlId(field.key);

  switch (spec.kind) {
    case 'integer': {
      const input = createElement<HTMLInputElement>({
        tag: 'input',
        id,
        className: 'setting-number',
        attributes: {
          type: 'number',
          min: String(spec.min),
          max: String(spec.max),
          step: '1',
          inputmode: 'numeric',
        },
      });
      input.addEventListener('change', () => {
        // An emptied box is not a request for zero; the stored value is drawn
        // back over it once the save comes round.
        if (input.value.trim() === '') return;
        onChange(field.key, Number(input.value) as Settings[typeof field.key]);
      });
      return input;
    }

    case 'boolean': {
      const input = createElement<HTMLInputElement>({
        tag: 'input',
        id,
        className: 'setting-toggle',
        attributes: { type: 'checkbox' },
      });
      input.addEventListener('change', () => {
        onChange(field.key, input.checked as Settings[typeof field.key]);
      });
      return input;
    }

    case 'choice': {
      const select = createElement<HTMLSelectElement>({
        tag: 'select',
        id,
        className: 'setting-select',
        children: spec.options.map(option =>
          createElement<HTMLOptionElement>({
            tag: 'option',
            attributes: { value: option },
            textContent: field.options?.[option] ?? option,
          }),
        ),
      });
      select.addEventListener('change', () => {
        onChange(field.key, select.value as Settings[typeof field.key]);
      });
      return select;
    }
  }
}

function createField(field: FieldCopy, onChange: SettingChange): HTMLElement {
  const control = createControl(field, onChange);
  const isToggle = SETTING_SPECS[field.key].kind === 'boolean';

  const text = createElement({
    className: 'setting-text',
    children: [
      createElement({
        tag: 'label',
        className: 'setting-label',
        attributes: { for: controlId(field.key) },
        textContent: field.label,
      }),
      ...(field.hint
        ? [createElement({ tag: 'p', className: 'setting-hint', textContent: field.hint })]
        : []),
    ],
  });

  return createElement({
    className: isToggle ? 'setting setting--toggle' : 'setting',
    children: [text, control],
  });
}

export function renderSettingsForm(container: HTMLElement, onChange: SettingChange): void {
  container.replaceChildren(
    ...SECTIONS.map(section =>
      createElement({
        tag: 'section',
        className: 'settings-section',
        children: [
          createElement({ tag: 'h2', textContent: section.title }),
          ...section.fields.map(field => createField(field, onChange)),
        ],
      }),
    ),
  );
}

/** Draw the stored values into the controls, whoever changed them. */
export function fillSettingsForm(document: Document, settings: Settings): void {
  for (const key of Object.keys(settings) as SettingKey[]) {
    const control = document.querySelector(`#${controlId(key)}`);
    const value = settings[key];

    if (control instanceof HTMLInputElement && control.type === 'checkbox') {
      control.checked = value === true;
    } else if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
      control.value = String(value);
    }
  }
}

export function showStatus(statusEl: HTMLElement, message: string, isError = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle('is-error', isError);
}
