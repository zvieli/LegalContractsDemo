import { test, expect } from '@playwright/test';

test('should return health status', async ({ request }) => {
  const res = await request.get('/api/v7/arbitration/health');
  expect(res.ok()).toBeTruthy();
});
