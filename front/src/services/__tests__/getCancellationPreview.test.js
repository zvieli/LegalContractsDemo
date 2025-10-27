import { describe, it, expect, vi } from 'vitest';
import { ContractService } from '../../services/contractService';

describe('ContractService.getCancellationPreview', () => {
  it('returns on-chain view values when getCancellationRefunds exists', async () => {
    const svc = new ContractService(null, null, 1337);
    const tenantRefund = 1n * 10n ** 18n; // 1 ETH
    const landlordShare = 2n * 10n ** 18n; // 2 ETH
    const fee = 1n * 10n ** 17n; // 0.1 ETH

    const fakeRent = {
      getCancellationRefunds: vi.fn().mockResolvedValue([tenantRefund, landlordShare, fee])
    };

    svc.getEnhancedRentContract = vi.fn().mockResolvedValue(fakeRent);

    const res = await svc.getCancellationPreview('0x0000000000000000000000000000000000000001');
    expect(res.tenantRefund).toBe(tenantRefund);
    expect(res.landlordShare).toBe(landlordShare);
    expect(res.fee).toBe(fee);
  });

  it('fallback before start returns full refund to tenant', async () => {
    const svc = new ContractService(null, null, 1337);
    const total = 3n * 10n ** 18n; // 3 ETH
    const now = Math.floor(Date.now() / 1000);

    const fakeRent = {
      startDate: vi.fn().mockResolvedValue(now + 3600), // starts in 1h
      durationDays: vi.fn().mockResolvedValue(10),
      // updated to repository default: 200 bps = 2%
      cancellationFeeBps: vi.fn().mockResolvedValue(200)
    };

    svc.getEnhancedRentContract = vi.fn().mockResolvedValue(fakeRent);
    svc.getEscrowBalance = vi.fn().mockResolvedValue(total);

    const res = await svc.getCancellationPreview('0x0000000000000000000000000000000000000002');
    expect(res.tenantRefund).toBe(total);
    expect(res.landlordShare).toBe(0n);
    expect(res.fee).toBe(0n);
  });

  it('fallback during term prorates landlord share', async () => {
    const svc = new ContractService(null, null, 1337);
    const total = 10n * 10n ** 18n; // 10 ETH
    const now = Math.floor(Date.now() / 1000);
    const durationDays = 10;
    const startDate = now - Math.floor((durationDays / 2) * 86400);

    const fakeRent = {
      startDate: vi.fn().mockResolvedValue(startDate),
      durationDays: vi.fn().mockResolvedValue(durationDays),
      // updated to repository default: 200 bps = 2%
      cancellationFeeBps: vi.fn().mockResolvedValue(200)
    };

    svc.getEnhancedRentContract = vi.fn().mockResolvedValue(fakeRent);
    svc.getEscrowBalance = vi.fn().mockResolvedValue(total);

    const res = await svc.getCancellationPreview('0x0000000000000000000000000000000000000003');

    const periodSeconds = BigInt(durationDays) * 86400n;
    const timeUsed = BigInt(Math.floor(Date.now() / 1000) - startDate);
    const landlordShareExpected = (total * timeUsed) / periodSeconds;
    const tenantRefundExpected = total > landlordShareExpected ? total - landlordShareExpected : 0n;

    // with 200 bps fee, tenant refund is reduced by 2% of the tenant share
    const tenantRefundBeforeFee = tenantRefundExpected;
    const feeExpected = (tenantRefundBeforeFee * 200n) / 10000n;
    const tenantRefundAfterFee = tenantRefundBeforeFee > feeExpected ? tenantRefundBeforeFee - feeExpected : 0n;

    expect(res.tenantRefund).toBe(tenantRefundAfterFee);
    expect(res.landlordShare).toBe(landlordShareExpected);
    expect(res.fee).toBe(feeExpected);
  });
});
