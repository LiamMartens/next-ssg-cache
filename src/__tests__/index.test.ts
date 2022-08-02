import { SsgCache } from '../';

describe('index', () => {
  const mockFetcher = jest.fn(async () => ({
    name: 'Liam',
  }));

  it('should work', async () => {
    await SsgCache.init();

    const cacheInstance = new SsgCache<{
      test: { name: string }
    }>();
    const coldResult = await cacheInstance.get('test', mockFetcher);
    expect(coldResult.name).toEqual('Liam');
    expect(mockFetcher).toBeCalledTimes(1);

    mockFetcher.mockClear();
    const warmResult = await cacheInstance.get('test', mockFetcher);
    expect(warmResult.name).toEqual('Liam');
    expect(mockFetcher).toBeCalledTimes(0);
  })
});