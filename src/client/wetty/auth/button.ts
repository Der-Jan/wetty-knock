import { BROWSER_KEY_SCOPE, publicBlob } from '../../../protocol/browserAgent';
import { keyFingerprint, publicIdentity } from '../../../protocol/importedKeys';
import { createSshKeyControl } from './control';
import { editImportedKey, listImportedKeys } from './importedKeys';
import { editGeneratedKey, generatedKeyInfo, loadSshKey } from './keys';

const boundButtons = new WeakSet<HTMLButtonElement>();

async function keyEntries() {
  const [generated, imported] = await Promise.all([generatedKeyInfo(), listImportedKeys()]);
  const entries = imported.map((key) => ({
    name: key.comment || 'Imported key',
    blob: key.blob,
    sensitive: key.sensitive,
    publicKey: (publicIdentity(key.blob).rsa ? 'ssh-rsa ' : 'ssh-ed25519 ') + btoa(String.fromCharCode(...key.blob)),
    edit: (action: boolean | 'remove') => editImportedKey(key.blob, key.revision, action),
  }));
  if (generated) {
    entries.unshift({
      ...generated,
      name: 'Browser-generated key',
      blob: publicBlob(generated.publicKey),
      edit: (action) => editGeneratedKey(generated.revision, action),
    });
  }
  return { entries, generated };
}

function openManager(opener: HTMLButtonElement): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'ssh-key-manager';
  const heading = document.createElement('h2');
  heading.id = 'ssh-key-manager-title';
  heading.textContent = 'SSH keys';
  dialog.setAttribute('aria-labelledby', heading.id);
  const list = document.createElement('fieldset');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  function action(label: string, run: () => Promise<void> | void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.onclick = () => {
      list.disabled = true;
      status.textContent = '';
      void Promise.resolve()
        .then(run)
        .catch((error: unknown) => {
          status.textContent = error instanceof Error ? error.message : 'Key management failed';
        })
        .finally(() => {
          list.disabled = false;
        });
    };
    return button;
  }
  function iconAction(label: string, glyph: string, run: () => Promise<void>): HTMLButtonElement {
    const button = action(label, run);
    const icon = document.createElement('i');
    icon.className = `fas fa-${glyph}`;
    icon.setAttribute('aria-hidden', 'true');
    button.replaceChildren(icon);
    button.title = label;
    button.setAttribute('aria-label', label);
    return button;
  }
  async function refresh(): Promise<void> {
    const { entries, generated } = await keyEntries();
    list.replaceChildren();
    const fingerprints = await Promise.all(entries.map((entry) => keyFingerprint(entry.blob)));
    for (const [index, entry] of entries.entries()) {
      const row = document.createElement('section');
      const name = document.createElement('h3');
      name.textContent = entry.name;
      const fingerprint = fingerprints[index];
      const details = document.createElement('code');
      details.textContent = fingerprint;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = entry.sensitive === true;
      const label = document.createElement('label');
      label.append('Sensitive — approve every use', checkbox);
      checkbox.onchange = () => {
        list.disabled = true;
        void entry
          .edit(checkbox.checked)
          .then(refresh)
          .catch(() => {
            checkbox.checked = entry.sensitive === true;
            status.textContent = 'Could not change this key. Reopen the manager to refresh.';
          })
          .finally(() => {
            list.disabled = false;
          });
      };
      const actions = document.createElement('div');
      actions.className = 'ssh-key-actions';
      actions.append(
        iconAction('Copy public key', 'copy', async () => {
          try {
            await window.navigator.clipboard.writeText(entry.publicKey);
            status.textContent = 'Public key copied.';
          } catch {
            const field = document.createElement('textarea');
            field.readOnly = true;
            field.setAttribute('aria-label', 'Public key to copy');
            field.value = entry.publicKey;
            status.replaceChildren(field);
            field.focus();
            field.select();
          }
        }),
        iconAction('Remove', 'trash-can', async () => {
          if (
            // eslint-disable-next-line no-alert -- Confirm permanent removal of this specific private key.
            !window.confirm(
              `Remove ${entry.name} (${fingerprint}) from this browser? Remote authorized_keys entries are kept.`,
            )
          ) {
            return;
          }
          await entry.edit('remove');
          await refresh();
          status.textContent = 'Key removed from this browser.';
        }),
      );
      const title = document.createElement('header');
      title.append(name, actions);
      row.append(title, details, label);
      list.append(row);
    }
    if (!generated) {
      list.append(
        action('Create browser key', async () => {
          await loadSshKey(BROWSER_KEY_SCOPE);
          await refresh();
        }),
      );
    }
  }
  const header = document.createElement('header');
  const toolbar = opener.parentElement;
  header.append(heading, opener);
  opener.setAttribute('aria-expanded', 'true');
  dialog.append(header, list, status);
  dialog.setAttribute('closedby', 'any');
  if (!('closedBy' in Object.getPrototypeOf(dialog))) {
    // Older browsers send backdrop pointer events to the dialog itself.
    const outside = (event: PointerEvent): boolean => {
      const { left, top, right, bottom } = dialog.getBoundingClientRect();
      return (
        event.target === dialog &&
        (event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom)
      );
    };
    let startedOutside = false;
    dialog.addEventListener('pointerdown', (event) => {
      startedOutside = outside(event);
    });
    dialog.addEventListener('pointerup', (event) => {
      if (startedOutside && outside(event)) dialog.close();
      startedOutside = false;
    });
  }
  dialog.addEventListener(
    'close',
    () => {
      toolbar?.prepend(opener);
      opener.setAttribute('aria-expanded', 'false');
      dialog.remove();
      opener.focus();
    },
    { once: true },
  );
  document.body.append(dialog);
  dialog.showModal();
  void refresh().catch(() => {
    status.textContent = 'Unable to load browser SSH keys.';
  });
}

export function setupSshKeyButton(): void {
  const { button } = createSshKeyControl();
  if (boundButtons.has(button)) return;
  boundButtons.add(button);
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', () => {
    const dialog = button.closest('dialog');
    if (dialog) dialog.close();
    else openManager(button);
  });
}
