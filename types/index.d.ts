import Cache from 'file-system-cache';
export declare enum CacheStatus {
    MISS = "miss",
    PENDING = "pending",
    HIT = "hit"
}
export declare type SsgCacheEntry<T> = {
    status: CacheStatus.HIT;
    data: T;
} | {
    status: CacheStatus.MISS | CacheStatus.PENDING;
};
export interface SsgCacheStore {
}
export declare class SsgCache {
    static CACHE_DIR: string;
    static BUILD_ID_PATH: string;
    static BUILD_CACHE_PATH: string;
    static init(): Promise<string>;
    id: string;
    cache: ReturnType<typeof Cache>;
    constructor();
    get<T extends keyof SsgCacheStore>(key: T | [T, ...string[]], fetcher: () => Promise<SsgCacheStore[T]>): Promise<SsgCacheStore[T]>;
}
