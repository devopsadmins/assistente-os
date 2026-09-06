import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_ROOT = join(__dirname, '../../.cache/site-cloner');

export interface CacheMeta {
  url: string;
  timestamp: number;
  viewportConfig: ViewportConfig;
  hash: string;
}

export interface ViewportConfig {
  mobile: { width: number; height: number };
  tablet: { width: number; height: number };
  desktop: { width: number; height: number };
}

export interface SnapshotRef {
  /** absolute path to the sanitized <body> inner HTML */
  bodyHtmlPath: string;
  /** absolute path to the concatenated + url-rewritten CSS */
  cssPath: string;
  /** absolute path to the directory of downloaded assets */
  assetsDir: string;
  title: string;
  lang: string;
  assetCount: number;
}

export interface AnalysisCache {
  meta: CacheMeta;
  designTokens: DesignTokens;
  componentMap: ComponentMap[];
  screenshots: {
    fullPage: Record<string, string>;
    viewport: Record<string, string>;
    components: Record<string, string>;
  };
  interactions: InteractionMap[];
  /** Self-contained DOM+CSS+assets snapshot for faithful reproduction. */
  snapshot?: SnapshotRef;
}

export interface DesignTokens {
  colors: Record<string, string>;
  typography: {
    fontFamilies: Record<string, string>;
    fontSizes: Record<string, string>;
    fontWeights: Record<string, number>;
    lineHeights: Record<string, string>;
  };
  spacing: Record<string, string>;
  borderRadius: Record<string, string>;
  shadows: Record<string, string>;
  breakpoints: Record<string, string>;
  transitions: Record<string, string>;
  zIndices: Record<string, number>;
}

export interface ComponentMap {
  selector: string;
  type: string;
  props: Record<string, unknown>;
  children: ComponentMap[];
  styles: Record<string, string>;
  viewport: string;
}

export interface InteractionMap {
  type: 'carousel' | 'modal' | 'countdown' | 'accordion' | 'tabs' | 'dropdown' | 'form' | 'smooth-scroll';
  selector: string;
  config: Record<string, unknown>;
}

const DEFAULT_VIEWPORTS: ViewportConfig = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
};

export class CacheManager {
  private cacheDir: string;
  private ttl: number;

  constructor(cacheDir?: string, ttlHours = 24) {
    this.cacheDir = cacheDir || CACHE_ROOT;
    this.ttl = ttlHours * 60 * 60 * 1000;
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  generateKey(url: string, viewports: ViewportConfig = DEFAULT_VIEWPORTS): string {
    const configStr = JSON.stringify(viewports);
    return createHash('sha256').update(url + configStr).digest('hex').substring(0, 16);
  }

  getCachePath(key: string): string {
    return join(this.cacheDir, key);
  }

  isValid(meta: CacheMeta): boolean {
    return Date.now() - meta.timestamp < this.ttl;
  }

  async save(key: string, data: AnalysisCache): Promise<void> {
    const cachePath = this.getCachePath(key);
    if (!existsSync(cachePath)) {
      mkdirSync(cachePath, { recursive: true });
    }
    writeFileSync(join(cachePath, 'analysis.json'), JSON.stringify(data, null, 2));
    writeFileSync(join(cachePath, 'meta.json'), JSON.stringify(data.meta, null, 2));
  }

  load(key: string): AnalysisCache | null {
    const cachePath = this.getCachePath(key);
    const analysisPath = join(cachePath, 'analysis.json');
    const metaPath = join(cachePath, 'meta.json');

    if (!existsSync(analysisPath) || !existsSync(metaPath)) {
      return null;
    }

    try {
      const meta: CacheMeta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      if (!this.isValid(meta)) {
        return null;
      }
      const analysis: AnalysisCache = JSON.parse(readFileSync(analysisPath, 'utf-8'));
      return analysis;
    } catch {
      return null;
    }
  }

  clear(key?: string): void {
    if (key) {
      const cachePath = this.getCachePath(key);
      if (existsSync(cachePath)) {
        rmSync(cachePath, { recursive: true, force: true });
      }
    } else if (existsSync(this.cacheDir)) {
      rmSync(this.cacheDir, { recursive: true, force: true });
    }
  }

  list(): string[] {
    if (!existsSync(this.cacheDir)) return [];
    return readdirSync(this.cacheDir).filter((f: string) => {
      const path = join(this.cacheDir, f);
      return statSync(path).isDirectory();
    });
  }
}

export const cacheManager = new CacheManager();