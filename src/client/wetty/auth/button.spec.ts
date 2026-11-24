import { expect } from 'chai';
import { IDBFactory } from 'fake-indexeddb';
import { JSDOM } from 'jsdom';
import 'mocha';
import { setupSshKeyButton } from './button';
import { generatedKeyInfo } from './keys';

describe('SSH key manager', () => {
  it('creates, copies, flags and removes a key through the existing toolbar control', async function managerActions() {
    this.timeout(15000);
    const previous = { window: globalThis.window, document: globalThis.document, indexedDB: globalThis.indexedDB };
    const dom = new JSDOM('<body></body>');
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, indexedDB: new IDBFactory() });
    dom.window.HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
    try {
      setupSshKeyButton();
      setupSshKeyButton();
      document.querySelector('button')?.click();
      const list = document.querySelector('dialog[open] fieldset');
      if (!list) throw new Error('Missing key manager');
      async function waitFor(ready: () => boolean): Promise<void> {
        if (ready()) return;
        await new Promise<void>((resolve) => {
          const observer = new dom.window.MutationObserver(() => {
            if (ready()) {
              observer.disconnect();
              resolve();
            }
          });
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        });
      }
      const find = (label: string) =>
        Array.from(document.querySelectorAll<HTMLButtonElement>('dialog button')).find((b) => b.textContent === label);
      await waitFor(() => !!find('Create browser key'));
      expect(await generatedKeyInfo()).to.equal(undefined);
      find('Create browser key')?.click();
      await waitFor(() => !!find('Copy public key') && !document.querySelector('fieldset:disabled'));
      let copied = '';
      Object.defineProperty(dom.window.navigator, 'clipboard', {
        value: {
          writeText: (value: string) => {
            copied = value;
          },
        },
      });
      find('Copy public key')?.click();
      await waitFor(() => copied !== '' && !document.querySelector('fieldset:disabled'));
      expect(copied).to.equal((await generatedKeyInfo())?.publicKey);
      document.querySelector<HTMLInputElement>('input[type=checkbox]')?.click();
      await waitFor(() => !document.querySelector('fieldset:disabled'));
      expect((await generatedKeyInfo())?.sensitive).to.equal(true);
      dom.window.confirm = () => true;
      find('Remove')?.click();
      await waitFor(() => !!find('Create browser key'));
      expect(await generatedKeyInfo()).to.equal(undefined);
    } finally {
      Object.assign(globalThis, previous);
      dom.window.close();
    }
  });
});
