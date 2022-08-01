import * as fs from 'fs-extra';
import * as path from 'path';
import lockFile from 'lockfile';
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
  exp?: number
} | {
  status: CacheStatus.MISS | CacheStatus.PENDING
}

export type SsgCacheGetOptions = {
  skipCache?: boolean
  ttl?: number
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
  public maxTimeout = 60000;

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
        if (retryCount >= maxTimes) {
          throw err;
        }
        await this.wait(ms);
      }
    }
  }

  public async lock(path: string) {
    await new Promise<void>((resolve, reject) => (
      lockFile.lock(path, (err) => {
        if (err) reject(err);
        resolve();
      })
    ));
  }

  public async unlock(path: string) {
    await new Promise<void>((resolve, reject) => (
      lockFile.unlock(path, (err) => {
        if (err) reject(err);
        resolve();
      })
    ));
  }

  public async waitForUnlock(path: string) {
    const checkForLock = () => new Promise<boolean>((resolve, reject) => {
      lockFile.check(path, (err, isLocked) => {
        resolve(isLocked)
      })
    })

    return Promise.race([
      new Promise<void>(async (resolve) => {
        while (await checkForLock()) {
          await this.wait(100)
        }
      }),
      new Promise<void>(async (resolve, reject) => {
        await this.wait(this.maxTimeout)
        reject(new Error(`[next-ssg-cache] Timed-out whilst waiting for cache file to unlock (${this.maxTimeout}ms)`))
      }),
    ]);
  }

  public async get<T extends keyof SsgCacheStore>(key: T | [T, ...string[]], fetcher: () => Promise<SsgCacheStore[T]>, options?: SsgCacheGetOptions): Promise<SsgCacheStore[T]> {
    const cacheKey = typeof key === 'string' ? key : key.join('/')

    try {
      if (!options?.skipCache) {
        const value = await this.retry(async () => {
          return await this.cache.get(cacheKey, null) as SsgCacheEntry<SsgCacheStore[T]> | null
        }, 3);

        if (value) {
          if (
            value.status === CacheStatus.HIT
            && (
              typeof options?.ttl !== 'number'
              || typeof value.exp !== 'number'
              || Date.now() < value.exp
            )
          ) {
            return value.data;
          } else if (value.status === CacheStatus.PENDING) {
            return new Promise<SsgCacheStore[T]>((resolve, reject) => {
              setTimeout(() => {
                this.get(key, fetcher).then(resolve).catch(reject);
              }, 10)
            });
          }
        }
      }

      await this.waitForUnlock(this.cache.path(cacheKey));
      await this.lock(this.cache.path(cacheKey));

      await this.cache.set(cacheKey, {
        status: CacheStatus.PENDING,
      })

      console.log(`[next-ssg-cache] fetching ${cacheKey}`)
      const data = await fetcher();
      await this.cache.set(cacheKey, {
        status: CacheStatus.HIT,
        data,
        ...(typeof options?.ttl === 'number' ? {
          exp: Date.now() + options.ttl,
        } : {}),
      })

      await this.unlock(this.cache.path(cacheKey));

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