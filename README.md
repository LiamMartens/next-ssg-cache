# next-ssg-cache
**Note: this module is only compatible because of the required `async` method injected into `next.config.js`. It is possible to use this with pre-12 versions of Next.js but you will need to call the cache init method just before the build kicks off**

This module provides a build-time cache to speed up your SSG builds.

In real world applications, it often happens you need to fetch data which is shared between all pages of a Next application.
We often resort to simply fetching it for each page on build time resulting in a lot of redundant network calls and a much longer build time.
With `next-ssg-cache` you will be able to utilize a build time cache to minimize the amount of API calls.

## Usage (with Typescript)
### Step 1: Initialize the cache
The easiest way to do this is by adding the `SsgCache.init` call inside the `next.config.js` file.
This method will assign a unique cache ID to your build.

```js
import { SsgCache } from 'next-ssg-cache';

/* @README async configuration is only supported in Next.js >=12.1 */
export default async () => {
  await SsgCache.init()

  /** @type {import('next').NextConfig} */
  return {
    reactStrictMode: true,
  };
}
```

### Step 2: Type your cache
For type-safety, it is important to type the cached data you are expecting. You can do this using module augmentation.
Just create a file called `next-ssg-cache-store.d.ts` (this file can have any name) and add the following code:

```ts
import 'next-ssg-cache';

declare module 'next-ssg-cache' {
  interface SsgCacheStore {
    /* @README here you will type each cache entry you will be expecting. */
    pages: any[]
  }
}
```

### Step 3: Use the cache in your getStaticProps or getStaticPaths methods
Using the cache is very simple, you just need to create a cache instance (which will automatically use the current cache ID) and request the data. For example:

```ts
import { SsgCache } from 'next-ssg-cache';

export const getStaticProps: GetStaticProps<PageProps> = async (ctx) => {
  const cacheInstance = new SsgCache();
  const data = return cacheInstance.get('pages', async () => (
    fetchAllPages()
  ));
}
```

It is also possible to add parameters to the cache keys. For example, if you need to fetch data per locale (you don't want these to get mixed up)

```ts
import { SsgCache } from 'next-ssg-cache';

export const getStaticProps: GetStaticProps<PageProps> = async (ctx) => {
  const cacheInstance = new SsgCache();
  const data = return cacheInstance.get(['pages', 'en-us'], async () => (
    fetchAllPages('en-us')
  ));
}
```

## FAQ
### Where is the cache stored?
A file based cache is used and stored in `node_modules/.cache/next-ssg-cache`

### What kind of gains can I expect?
On a real world project I was able to reduce my build time from 1m down to 15s.