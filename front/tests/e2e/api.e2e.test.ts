import { test, expect } from '@playwright/test';

test.describe('Arbitration API', () => {
  test('should return health status', async ({ request }) => {
    const response = await request.get('http://localhost:3001/api/v7/arbitration/health');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('version');
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('healthy');
    expect(data.healthy).toBe(true);
  });

  test('should return arbitration service status', async ({ request }) => {
    const response = await request.get('http://localhost:3001/api/v7/arbitration/status');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('service');
    expect(data).toHaveProperty('version');
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('healthy');
    expect(data).toHaveProperty('mode');
  });

  test('should return decisions history', async ({ request }) => {
    const response = await request.get('http://localhost:3001/api/v7/arbitration/decisions');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
    // Each decision should have expected properties
    if (data.length > 0) {
      const decision = data[0];
      expect(decision).toHaveProperty('disputeId');
      expect(decision).toHaveProperty('verdict');
      expect(decision).toHaveProperty('rationale');
      expect(decision).toHaveProperty('confidence');
    }
  });

  test('should handle invalid requests gracefully', async ({ request }) => {
    // Test invalid endpoint
    const response = await request.get('http://localhost:3001/api/v7/arbitration/invalid-endpoint');
    expect(response.status()).toBe(404);

    const data = await response.json();
    expect(data).toHaveProperty('error');
    expect(data).toHaveProperty('availableEndpoints');
  });
});
