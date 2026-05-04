import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type VaultSearchPlugin from './main';
import { getEmbedder, getOnDeviceModelState, MODEL_ID_HF } from './ondevice';
import { canUseCli, isCliAvailable, resetCliAvailabilityCache } from './semantic';

// ---------------------------------------------------------------------------
// Settings schema
// ---------------------------------------------------------------------------

export type SemanticBackend = 'auto' | 'cli' | 'ondevice';

export interface VaultSearchSettings {
  maxResults: number;
  semanticEnabled: boolean;
  vectorScriptPath: string;
  semanticBackend: SemanticBackend;
}

export const DEFAULT_SETTINGS: VaultSearchSettings = {
  maxResults: 30,
  semanticEnabled: true,
  vectorScriptPath: '~/ObsidianVault/tools/scripts/vault_vector.py',
  semanticBackend: 'auto',
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

    // -----------------------------------------------------------------------
    // Index
    // -----------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // Semantic
    // -----------------------------------------------------------------------

    containerEl.createEl('h3', { text: 'Semantic search' });

    new Setting(containerEl)
      .setName('Semantic mode')
      .setDesc('Enable ? prefix for semantic search. Works on Mac (CLI or on-device) and iOS (on-device).')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.semanticEnabled)
          .onChange(async (value) => {
            this.plugin.settings.semanticEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Semantic backend')
      .setDesc(
        'Auto: uses CLI (Ollama) on desktop when available, falls back to on-device. ' +
        'CLI: desktop only. On-device: transformers.js ONNX, works on Mac and iOS.'
      )
      .addDropdown(drop =>
        drop
          .addOption('auto', 'Auto (recommended)')
          .addOption('cli', 'CLI only (Mac + Ollama)')
          .addOption('ondevice', 'On-device only (Mac + iOS)')
          .setValue(this.plugin.settings.semanticBackend)
          .onChange(async (value) => {
            this.plugin.settings.semanticBackend = value as SemanticBackend;
            resetCliAvailabilityCache();
            await this.plugin.saveSettings();
          })
      );

    // vault_vector.py path override
    new Setting(containerEl)
      .setName('vault_vector.py path')
      .setDesc('Absolute (or ~-prefixed) path to vault_vector.py. Only used by the CLI backend.')
      .addText(text =>
        text
          .setPlaceholder('~/ObsidianVault/tools/scripts/vault_vector.py')
          .setValue(this.plugin.settings.vectorScriptPath)
          .onChange(async (value) => {
            this.plugin.settings.vectorScriptPath = value || DEFAULT_SETTINGS.vectorScriptPath;
            resetCliAvailabilityCache();
            await this.plugin.saveSettings();
          })
      );

    // -----------------------------------------------------------------------
    // On-device model controls
    // -----------------------------------------------------------------------

    containerEl.createEl('h3', { text: 'On-device model' });

    // Model status line (read-only)
    const { state, error } = getOnDeviceModelState();
    const stateLabels: Record<string, string> = {
      cold: 'Not loaded — will load on first semantic query',
      warming: 'Loading…',
      ready: 'Ready',
      error: `Error: ${error ?? 'unknown'}`,
    };
    const statusEl = containerEl.createEl('p', {
      text: `Model status: ${stateLabels[state] ?? state}`,
      cls: 'vault-search-stats',
    });
    statusEl.style.cssText = 'color: var(--text-muted); font-size: 0.85em; margin-bottom: 8px;';

    const modelInfoEl = containerEl.createEl('p', {
      text: `Model: ${MODEL_ID_HF} (int8-quantized, ~137 MB download on first use — cached locally forever after)`,
      cls: 'vault-search-stats',
    });
    modelInfoEl.style.cssText = 'color: var(--text-muted); font-size: 0.85em; margin-bottom: 8px;';

    // Pre-warm button
    new Setting(containerEl)
      .setName('Pre-warm on-device model')
      .setDesc('Download and load the ONNX model now so the first semantic query is fast. Safe to run multiple times.')
      .addButton(btn => {
        const { state } = getOnDeviceModelState();
        const alreadyReady = state === 'ready';
        btn
          .setButtonText(alreadyReady ? 'Model ready' : 'Load model now')
          .setDisabled(alreadyReady)
          .onClick(async () => {
            btn.setDisabled(true).setButtonText('Loading…');
            try {
              await getEmbedder(this.plugin);
              btn.setButtonText('Model ready');
              new Notice('On-device model loaded successfully.');
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              btn.setDisabled(false).setButtonText('Retry load');
              new Notice(`Model load failed: ${msg.slice(0, 120)}`, 8000);
            }
            // Refresh the settings panel to show updated state
            this.display();
          });
      });

    // Diagnostics button
    new Setting(containerEl)
      .setName('Show diagnostics')
      .setDesc('Surface backend selection info, model path, embeddings.json stats, and last query info.')
      .addButton(btn =>
        btn
          .setButtonText('Show diagnostics')
          .onClick(async () => {
            await this.showDiagnostics();
          })
      );

    // -----------------------------------------------------------------------
    // Index stats
    // -----------------------------------------------------------------------

    const statsEl = containerEl.createEl('p', {
      text: `Index contains ${this.plugin.index.size} files.`,
      cls: 'vault-search-stats',
    });
    statsEl.style.cssText = 'color: var(--text-muted); font-size: 0.85em; margin-top: 12px;';
  }

  private async showDiagnostics(): Promise<void> {
    const lines: string[] = ['=== Vault Search Diagnostics ==='];

    // Backend selection
    const isMobile = !!(this.plugin.app as any).isMobile;
    lines.push(`Platform: ${isMobile ? 'iOS/Mobile' : 'Desktop'}`);
    lines.push(`Backend setting: ${this.plugin.settings.semanticBackend}`);

    const cli = isCliAvailable();
    lines.push(`child_process available: ${cli}`);
    if (cli) {
      const cliOk = await canUseCli(this.plugin.settings.vectorScriptPath);
      lines.push(`Ollama reachable: ${cliOk}`);
      lines.push(`vault_vector.py path: ${this.plugin.settings.vectorScriptPath}`);
    }

    // On-device model state
    const { state, error } = getOnDeviceModelState();
    lines.push(`On-device model state: ${state}${error ? ` (${error})` : ''}`);
    lines.push(`Model ID: ${MODEL_ID_HF}`);

    const basePath = (this.plugin.app.vault.adapter as any).basePath as string;
    lines.push(`Model cache dir: ${basePath}/.obsidian/plugins/vault-search/models/`);

    // embeddings.json
    try {
      const raw = await this.plugin.app.vault.adapter.read('.vector/embeddings.json');
      const data = JSON.parse(raw);
      lines.push(`embeddings.json: ${data.chunks?.length ?? '?'} chunks, dim=${data.dimension}, model=${data.model}`);
      lines.push(`Vector store updated: ${data.updated ?? 'unknown'}`);
    } catch {
      lines.push('embeddings.json: NOT FOUND — run vault_vector.py embed');
    }

    const msg = lines.join('\n');
    console.log('[vault-search diagnostics]\n' + msg);
    new Notice(msg, 12000);
  }
}
