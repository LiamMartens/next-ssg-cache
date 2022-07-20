import * as fs from 'fs-extra';
import * as path from 'path';
import uniqid from 'uniqid';
import Cache from 'file-system-cache';

export enum CacheStatus {
  MISS = 'miss',
  PENDING = 'pending',
  HIT = 'hit',
}

export type SsgCacheEntry<T> = {
  status: CacheStatus.HIT
  data: T
} | {
  status: CacheStatus.MISS | CacheStatus.PENDING
}

export interface SsgCacheStore {
}

export class SsgCache {
  public static CACHE_DIR = path.resolve(process.cwd(), 'node_modules/.cache/next-ssg-cache');
  public static BUILD_ID_PATH = path.resolve(SsgCache.CACHE_DIR, 'BUILD_ID');
  public static BUILD_CACHE_PATH = path.resolve(SsgCache.CACHE_DIR, 'cache');

  public static async init() {
    if (!fs.existsSync(SsgCache.CACHE_DIR)) {
      await fs.mkdirp(SsgCache.CACHE_DIR);
    }
    const id = uniqid();
    await fs.writeFile(SsgCache.BUILD_ID_PATH, id);
    return id;
  }

  public id: string;
  public cache: ReturnType<typeof Cache>;

  constructor() {
    try {
      const buildId = fs.readFileSync(SsgCache.BUILD_ID_PATH, {
        encoding: 'utf-8',
      });

      if (!buildId) {
        throw new Error('Empty build ID');
      }

      this.id = buildId;
      this.cache = Cache({
        basePath: SsgCache.BUILD_CACHE_PATH,
        ns: this.id,
      });
    } catch (err) {
      throw new Error('Build not initialized');
    }
  }

  public async get<T extends keyof SsgCacheStore>(key: T | [T, ...string[]], fetcher: () => Promise<SsgCacheStore[T]>): Promise<SsgCacheStore[T]> {
    const cacheKey = typeof key === 'string' ? key : key.join('/')

    try {
      const value = await this.cache.get(cacheKey, null) as SsgCacheEntry<SsgCacheStore[T]> | null;
      if (value) {
        if (value.status === CacheStatus.HIT) {
          return value.data;
        } else if (value.status === CacheStatus.PENDING) {
          return new Promise<SsgCacheStore[T]>((resolve, reject) => {
            setTimeout(() => {
              this.get(key, fetcher).then(resolve).catch(reject);
            }, 10)
          });
        }
      }

      await this.cache.set(cacheKey, {
        status: CacheStatus.PENDING,
      });

      console.log(`[next-ssg-cache] fetching ${cacheKey}`)
      const data = await fetcher();
      await this.cache.set(cacheKey, {
        status: CacheStatus.HIT,
        data,
      })

      return data;
    } catch (err) {
      console.error(err);
      console.error(`[next-ssg-cache] failed to fetch/read ${cacheKey}`)

      return new Promise<SsgCacheStore[T]>((resolve, reject) => {
        setTimeout(() => {
          this.get(key, fetcher).then(resolve).catch(reject);
        }, 10)
      });
    }
  }
}