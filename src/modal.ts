import { App, SuggestModal, TFile } from 'obsidian';
import type VaultSearchPlugin from './main';
import { SearchResult, search, detectMode } from './search';
import { isSemanticAvailable } from './semantic';

// ---------------------------------------------------------------------------
// VaultSearchModal — single modal, three modes
// ---------------------------------------------------------------------------

export class VaultSearchModal extends SuggestModal<SearchResult> {
  private plugin: VaultSearchPlugin;
  private modeIndicator: HTMLElement | null = null;

  constructor(app: App, plugin: VaultSearchPlugin) {
    super(app);
    this.plugin = plugin;
    this.setPlaceholder('Search vault… (key:val for facet, ? for semantic)');
    this.setInstructions([
      { command: '↩', purpose: 'open' },
      { command: 'esc', purpose: 'close' },
      { command: 'key:value', purpose: 'facet filter' },
      { command: '?query', purpose: 'semantic (Mac)' },
    ]);
  }

  onOpen(): void {
    super.onOpen();
    // Inject mode indicator element below the input
    const inputEl = this.inputEl?.parentElement;
    if (inputEl) {
      this.modeIndicator = inputEl.createEl('div', { cls: 'vault-search-mode-indicator' });
      this.updateModeIndicator('');
    }
  }

  private updateModeIndicator(query: string): void {
    if (!this.modeIndicator) return;
    const mode = detectMode(query);
    const labels: Record<string, string> = {
      quick: 'Quick mode — filename + aliases',
      facet: 'Facet mode — frontmatter filters',
      semantic: isSemanticAvailable()
        ? 'Semantic mode (Mac-only) — vector search via vault_vector.py'
        : 'Semantic mode requires desktop Obsidian + vault_vector.py',
    };
    this.modeIndicator.setText(labels[mode] ?? '');
    this.modeIndicator.setAttribute('data-mode', mode);
  }

  async getSuggestions(query: string): Promise<SearchResult[]> {
    this.updateModeIndicator(query);
    if (!query.trim()) return [];
    return search(this.plugin.index, query, this.plugin.settings);
  }

  renderSuggestion(item: SearchResult, el: HTMLElement): void {
    el.addClass('vault-search-result');

    if (item.mode === 'semantic') {
      this.renderSemanticRow(item.result, el);
      return;
    }

    const { entry } = item;

    // Row layout: left (title + chips) + right (path)
    const left = el.createDiv({ cls: 'vault-search-left' });
    const right = el.createDiv({ cls: 'vault-search-right' });

    // Title row
    const titleRow = left.createDiv({ cls: 'vault-search-title-row' });
    titleRow.createEl('span', { text: entry.title, cls: 'vault-search-title' });

    if (entry.current_default) {
      titleRow.createEl('span', { text: '★', cls: 'vault-search-star' });
    }

    // Tag chips
    const chips = left.createDiv({ cls: 'vault-search-chips' });
    for (const [value, cls] of typeTags(entry)) {
      chips.createEl('span', { text: value, cls: `vault-search-chip vault-search-chip--${cls}` });
    }

    // Relative path
    right.createEl('span', { text: entry.path, cls: 'vault-search-path' });
  }

  private renderSemanticRow(
    result: import('./semantic').SemanticResult,
    el: HTMLElement,
  ): void {
    const left = el.createDiv({ cls: 'vault-search-left' });
    const right = el.createDiv({ cls: 'vault-search-right' });

    const titleRow = left.createDiv({ cls: 'vault-search-title-row' });
    titleRow.createEl('span', { text: result.pageId, cls: 'vault-search-title' });
    titleRow.createEl('span', { text: `[${result.score}]`, cls: 'vault-search-score' });

    if (result.heading && result.heading !== result.pageId) {
      left.createEl('span', { text: `§ ${result.heading}`, cls: 'vault-search-heading' });
    }
    if (result.preview) {
      left.createEl('p', { text: result.preview, cls: 'vault-search-preview' });
    }

    right.createEl('span', { text: result.path, cls: 'vault-search-path' });
  }

  onChooseSuggestion(item: SearchResult, _evt: MouseEvent | KeyboardEvent): void {
    if (item.mode === 'semantic') {
      this.openByPath(item.result.path);
      return;
    }
    this.openByPath(item.entry.path);
  }

  private openByPath(vaultPath: string): void {
    // vault_vector.py emits vault-relative paths; strip leading vault root if present
    const file = this.app.vault.getFileByPath(vaultPath)
      ?? this.app.vault.getMarkdownFiles().find(f => f.path === vaultPath || f.basename === vaultPath);

    if (file instanceof TFile) {
      this.app.workspace.getLeaf().openFile(file);
    } else {
      // Fallback: try to open by page-id slug (semantic result)
      const byBasename = this.app.vault.getMarkdownFiles().find(
        f => f.basename === vaultPath || f.basename === vaultPath.replace(/^wiki\//, '')
      );
      if (byBasename) {
        this.app.workspace.getLeaf().openFile(byBasename);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: collect type/entity/concept/tool/capability chips for a row
// ---------------------------------------------------------------------------

type ChipTuple = [value: string, cssKey: string];

function typeTags(entry: import('./index').IndexEntry): ChipTuple[] {
  const chips: ChipTuple[] = [];

  if (entry.type) chips.push([entry.type, 'type']);
  if (entry.entity_type) chips.push([entry.entity_type, 'entity']);
  if (entry.concept_type) chips.push([entry.concept_type, 'concept']);
  if (entry.tool_type) chips.push([entry.tool_type, 'tool']);
  if (entry.capability_kind) chips.push([entry.capability_kind, 'capability']);
  if (entry.lab_role) chips.push([entry.lab_role, 'lab']);
  if (entry.model_lifecycle) chips.push([entry.model_lifecycle, 'lifecycle']);

  return chips.slice(0, 4); // cap to avoid overflow
}
