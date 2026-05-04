import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type VaultSearchPlugin from './main';

// ---------------------------------------------------------------------------
// Settings schema
// ---------------------------------------------------------------------------

export interface VaultSearchSettings {
  maxResults: number;
  semanticEnabled: boolean;
  vectorScriptPath: string;
}

export const DEFAULT_SETTINGS: VaultSearchSettings = {
  maxResults: 30,
  semanticEnabled: true,
  vectorScriptPath: '~/ObsidianVault/tools/scripts/vault_vector.py',
};

// ---------------------------------------------------------------------------
// Settings tab UI
// ---------------------------------------------------------------------------

export class VaultSearchSettingTab extends PluginSettingTab {
  plugin: VaultSearchPlugin;

  constructor(app: App, plugin: VaultSearchPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Vault Search' });

    // Rebuild index
    new Setting(containerEl)
      .setName('Rebuild index')
      .setDesc('Re-scan all vault files and rebuild the in-memory search index. Use if results feel stale.')
      .addButton(btn =>
        btn
          .setButtonText('Rebuild now')
          .setCta()
          .onClick(async () => {
            btn.setDisabled(true).setButtonText('Rebuilding…');
            await this.plugin.index.rebuild(this.app);
            btn.setDisabled(false).setButtonText('Rebuild now');
            new Notice(`Vault Search: index rebuilt (${this.plugin.index.size} files)`);
          })
      );

    // Max results
    new Setting(containerEl)
      .setName('Max results')
      .setDesc('Maximum number of results returned in Quick and Facet modes (10–100).')
      .addSlider(slider =>
        slider
          .setLimits(10, 100, 5)
          .setValue(this.plugin.settings.maxResults)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxResults = value;
            await this.plugin.saveSettings();
          })
      );

    // Semantic mode toggle
    new Setting(containerEl)
      .setName('Semantic mode')
      .setDesc('Enable ? prefix to shell out to vault_vector.py. Mac desktop only — automatically disabled on iOS.')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.semanticEnabled)
          .onChange(async (value) => {
            this.plugin.settings.semanticEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    // vault_vector.py path override
    new Setting(containerEl)
      .setName('vault_vector.py path')
      .setDesc('Absolute (or ~-prefixed) path to vault_vector.py. Default: ~/ObsidianVault/tools/scripts/vault_vector.py')
      .addText(text =>
        text
          .setPlaceholder('~/ObsidianVault/tools/scripts/vault_vector.py')
          .setValue(this.plugin.settings.vectorScriptPath)
          .onChange(async (value) => {
            this.plugin.settings.vectorScriptPath = value || DEFAULT_SETTINGS.vectorScriptPath;
            await this.plugin.saveSettings();
          })
      );

    // Index stats
    const statsEl = containerEl.createEl('p', {
      text: `Index contains ${this.plugin.index.size} files.`,
      cls: 'vault-search-stats',
    });
    statsEl.style.cssText = 'color: var(--text-muted); font-size: 0.85em; margin-top: 12px;';
  }
}
