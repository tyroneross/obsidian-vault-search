import { Plugin, TFile } from 'obsidian';
import { VaultIndex, buildEntry } from './index';
import { VaultSearchModal } from './modal';
import { VaultSearchSettings, DEFAULT_SETTINGS, VaultSearchSettingTab } from './settings';
import { clearSemanticCache } from './semantic';

// ---------------------------------------------------------------------------
// VaultSearchPlugin — plugin entry point
// ---------------------------------------------------------------------------

export default class VaultSearchPlugin extends Plugin {
  index: VaultIndex = new VaultIndex();
  settings: VaultSearchSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();

    // Build index after metadata cache is ready
    this.app.workspace.onLayoutReady(async () => {
      await this.index.rebuild(this.app);
      console.log(`[vault-search] index built: ${this.index.size} files`);
    });

    // Keep index in sync with vault changes
    this.registerEvent(
      this.app.vault.on('create', async (file) => {
        if (!(file instanceof TFile) || file.extension !== 'md') return;
        const entry = await buildEntry(this.app, file);
        this.index.set(file.path, entry);
      })
    );

    this.registerEvent(
      this.app.vault.on('modify', async (file) => {
        if (!(file instanceof TFile) || file.extension !== 'md') return;
        const entry = await buildEntry(this.app, file);
        this.index.set(file.path, entry);
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (!(file instanceof TFile) || file.extension !== 'md') return;
        this.index.delete(file.path);
      })
    );

    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (!(file instanceof TFile) || file.extension !== 'md') return;
        this.index.delete(oldPath);
        const entry = await buildEntry(this.app, file);
        this.index.set(file.path, entry);
      })
    );

    // Also update on metadata cache changes (catches frontmatter edits)
    this.registerEvent(
      this.app.metadataCache.on('changed', async (file) => {
        if (file.extension !== 'md') return;
        const entry = await buildEntry(this.app, file);
        this.index.set(file.path, entry);
      })
    );

    // Register the search command with Cmd+K hotkey
    this.addCommand({
      id: 'open-vault-search',
      name: 'Open Vault Search',
      hotkeys: [{ modifiers: ['Mod'], key: 'k' }],
      callback: () => new VaultSearchModal(this.app, this).open(),
    });

    // Settings tab
    this.addSettingTab(new VaultSearchSettingTab(this.app, this));
  }

  onunload(): void {
    clearSemanticCache();
    console.log('[vault-search] unloaded');
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
