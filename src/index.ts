import * as fs from 'fs-extra';
import * as path from 'path';
import debug from 'debug';
import uniqid from 'uniqid';

export enum CacheStatus {
  MISS = 0,
  PENDING = 1,
  HIT = 2,
}

export type SsgCacheEntry<T> = {
  data: T
  exp?: number
}

export type SsgCacheGetOptions = {
  skipCache?: boolean
  ttl?: number
}

export interface SsgCacheStore {
}

export class SsgCache<S extends SsgCacheStore = SsgCacheStore> {
  public static CACHE_DIR =
    process.env.VERCEL === '1'
      ? path.resolve('/tmp/.next-ssg-cache')
      : path.resolve(process.cwd(), 'node_modules/.cache/next-ssg-cache');
  public static BUILD_ID_PATH = path.resolve(SsgCache.CACHE_DIR, 'BUILD_ID');
  public static BUILD_CACHE_PATH = path.resolve(SsgCache.CACHE_DIR, 'cache');
  public static cache: Record<string, SsgCacheEntry<any>> = {};
  public static cacheStatus: Record<string, CacheStatus> = {};

  public static async init() {
    if (!fs.existsSync(SsgCache.CACHE_DIR)) {
      await fs.mkdir(SsgCache.CACHE_DIR, {
        recursive: true,
      });
    }

    const id = uniqid();
    await fs.writeFile(SsgCache.BUILD_ID_PATH, id);
    return id;
  }

  public id: string;
  public persistent: boolean;

  public maxTimeout = 60000;
  public debugInstance = debug('next-ssg-cache');

  constructor() {
    const hasBuildId = fs.existsSync(SsgCache.BUILD_ID_PATH)
    const buildId = !hasBuildId ? uniqid() : fs.readFileSync(SsgCache.BUILD_ID_PATH, {
      encoding: 'utf-8',
    });

    if (!buildId) {
      throw new Error('Empty build ID');
    }

    try {
      if (!hasBuildId) {
        fs.writeFileSync(SsgCache.BUILD_ID_PATH, buildId)
      }
      this.persistent = true
    } catch (err) {
      this.debugInstance(`Unable to write build ID: (%O)`, err)
      this.persistent = false
    }

    this.id = buildId;

    if (this.persistent) {
      const path = this.path()
      try {
        if (!fs.existsSync(path)) {
          fs.mkdirSync(path, {
            recursive: true,
          });
        }
      } catch(err) {
        console.warn('[next-ssg-cache] Running in memory-only mode')
        this.debugInstance(`Unable to create cache directory, running in memory-only mode: (%O)`, err)
        this.persistent = false
      }
    } else {
      console.warn('[next-ssg-cache] Running in memory-only mode')
    }
  }

  public path(keys: string[] = [], ext?: 'cache' | 'stat') {
    const resolved = keys.length
      ? path.resolve(SsgCache.BUILD_CACHE_PATH, this.id, keys.join('-').replace(/\//g, '-'))
      : path.resolve(SsgCache.BUILD_CACHE_PATH, this.id)
    return ext ? `${resolved}.${ext}` : resolved;
  }

  public async writeCacheStatus(keys: string[], status: CacheStatus) {
    const statPath = this.path(keys, 'stat')
    if (this.persistent) {
      await fs.writeFile(statPath, String(status), {
        encoding: 'utf-8',
      });
    } else {
      SsgCache.cacheStatus[statPath] = status
    }
  }

  public async readCacheStatus(keys: string[]) {
    const statPath = this.path(keys, 'stat')
    if (this.persistent) {
      if (fs.existsSync(statPath)) {
        const status = await fs.readFile(statPath, {
          encoding: 'utf-8',
          flag: 'r',
        });
        if (!Number.isNaN(Number(status))) {
          return Number(status) as CacheStatus;
        }
      }
    } else {
      return SsgCache.cacheStatus[statPath] ?? CacheStatus.MISS;
    }
    return CacheStatus.MISS;
  }

  public async writeCache<T extends Extract<keyof S, string>>(keys: [T, ...string[]], data: S[T], ttl?: number) {
    const cachePath = this.path(keys, 'cache')
    const cacheData = {
      data,
      ...(typeof ttl === 'number' ? {
        exp: Date.now() + ttl,
      } : {}),
    }
    if (this.persistent) {
      await fs.writeFile(cachePath, JSON.stringify(cacheData), {
        encoding: 'utf-8',
      });
    } else {
      SsgCache.cache[cachePath] = cacheData
    }
  }

  public async readCache<T extends Extract<keyof S, string>>(keys: [T, ...string[]]): Promise<SsgCacheEntry<S[T]> | null> {
    try {
      const cachePath = this.path(keys, 'cache')
      if (this.persistent) {
        if (fs.existsSync(cachePath)) {
          const data = await fs.readFile(cachePath, 'utf-8')
          return data ? JSON.parse(data) : null
        } else {
          this.debugInstance('cache miss %o', keys)
        }
      } else {
        return SsgCache.cache[cachePath] ?? null
      }
      return null
    } catch (err) {
      this.debugInstance('failed to read cache entry %o, %O', keys, err)
    }
    return null
  }

  public async waitForCacheToResolve<T extends Extract<keyof S, string>>(keys: [T, ...string[]]) {
    const status = await this.readCacheStatus(keys);
    if (status !== CacheStatus.PENDING) {
      return status;
    }

    return new Promise<CacheStatus>((resolve) => {
      const watchPath = this.path(keys, 'stat');
      const listener = async () => {
        const status = await this.readCacheStatus(keys)
        if (status !== CacheStatus.PENDING) {
          fs.unwatchFile(watchPath, listener);
          resolve(status);
        }
      }
      fs.watchFile(watchPath, listener);
    });
  }

  public async wait(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  public async retry<P extends Promise<any>>(fn: () => P, maxTimes: number, ms: number = 100) {
    let retryCount = 0
    while (true) {
      try {
        const result = await fn();
        return result;
      } catch (err) {
        this.debugInstance('try-error: %O', err);
        if (retryCount >= maxTimes) {
          throw err;
        }
        await this.wait(ms);
      }
    }
  }

  public async get<T extends Extract<keyof S, string>>(key: T | [T, ...string[]], fetcher: () => Promise<S[T]>, options?: SsgCacheGetOptions): Promise<S[T]> {
    const cacheKeys = (typeof key === 'string' ? [key] : key) as [T, ...string[]]

    try {
      if (!options?.skipCache) {
        const status = await this.waitForCacheToResolve(cacheKeys);
        const value = await this.readCache(cacheKeys);

        if (
          value
          && status === CacheStatus.HIT
          && (
            typeof options?.ttl !== 'number'
            || typeof value.exp !== 'number'
            || Date.now() < value.exp
          )
        ) {
          this.debugInstance('cache-hit %s', cacheKeys)
          return value.data;
        }
      }

      await this.writeCacheStatus(cacheKeys, CacheStatus.PENDING);
      this.debugInstance('fetching: %s', cacheKeys);
      const data = await fetcher();
      await this.writeCache(cacheKeys, data, options?.ttl);
      await this.writeCacheStatus(cacheKeys, CacheStatus.HIT);

      return data;
    } catch (err) {
      this.debugInstance('get-error: %o, %O', cacheKeys, err);
      return this.retry(
        () => this.get(key, fetcher, options),
        5,
      )
    }
  }
}