/**
 * Test Time Management Module
 */

import { 
  calculateLateFee, 
  getTimeBasedData, 
  calculateTotalPayment,
  generatePaymentSchedule,
  formatCountdown,
  isInGracePeriod 
} from '../modules/timeManagement.js';

function testTimeManagement() {
  console.log('⏰ Testing Time Management Module...\n');
  
  // Test late fee calculation
  console.log('Testing late fee calculation:');
  
  // Test case 1: Payment overdue by 5 days
  const dueDate1 = Date.now() - (5 * 24 * 60 * 60 * 1000); // 5 days ago
  const baseAmount1 = 1.0; // 1 ETH
  const lateFee1 = calculateLateFee(dueDate1, baseAmount1, 500); // 5% monthly
  console.log(`  Overdue by 5 days: ${lateFee1.toFixed(4)} ETH late fee`);
  
  // Test case 2: Payment not yet due
  const dueDate2 = Date.now() + (3 * 24 * 60 * 60 * 1000); // 3 days from now
  const lateFee2 = calculateLateFee(dueDate2, baseAmount1, 500);
  console.log(`  Not yet due: ${lateFee2.toFixed(4)} ETH late fee`);
  
  // Test case 3: Payment overdue by 30 days
  const dueDate3 = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days ago
  const lateFee3 = calculateLateFee(dueDate3, baseAmount1, 500);
  console.log(`  Overdue by 30 days: ${lateFee3.toFixed(4)} ETH late fee`);
  
  // Test time-based data
  console.log('\nTesting time-based data:');
  
  const timeData1 = getTimeBasedData(dueDate1);
  console.log(`  5 days overdue:`, {
    isOverdue: timeData1.isOverdue,
    daysOverdue: timeData1.daysOverdue,
    status: timeData1.status,
    urgency: timeData1.urgency
  });
  
  const timeData2 = getTimeBasedData(dueDate2);
  console.log(`  3 days until due:`, {
    isOverdue: timeData2.isOverdue,
    daysOverdue: timeData2.daysOverdue,
    status: timeData2.status,
    urgency: timeData2.urgency,
    countdown: timeData2.countdown
  });
  
  // Test total payment calculation
  console.log('\nTesting total payment calculation:');
  
  const paymentData = {
    baseAmount: '1.5',
    dueDate: dueDate1, // 5 days overdue
    lateFeeBps: 600 // 6%
  };
  
  const totalPayment = calculateTotalPayment(paymentData);
  console.log(`  Payment breakdown:`, {
    base: totalPayment.baseAmount,
    lateFee: totalPayment.lateFee.toFixed(4),
    total: totalPayment.totalAmount.toFixed(4),
    status: totalPayment.paymentStatus,
    urgency: totalPayment.urgency
  });
  
  // Test payment schedule generation
  console.log('\nTesting payment schedule generation:');
  
  const startDate = Date.now();
  const schedule = generatePaymentSchedule(startDate, 30, 3, 1.0); // 3 monthly payments of 1 ETH
  console.log(`  Generated ${schedule.length} payments:`);
  schedule.forEach((payment, index) => {
    console.log(`    Payment ${payment.paymentNumber}: ${payment.dueDateFormatted} - ${payment.baseAmount} ETH (${payment.status})`);
  });
  
  // Test countdown formatting
  console.log('\nTesting countdown formatting:');
  
  const testCountdowns = [
    { days: 5, hours: 12, minutes: 30, seconds: 45 },
    { days: 0, hours: 2, minutes: 15, seconds: 30 },
    { days: 0, hours: 0, minutes: 5, seconds: 10 },
    { days: 0, hours: 0, minutes: 0, seconds: 30 }
  ];
  
  testCountdowns.forEach(countdown => {
    const formatted = formatCountdown(countdown);
    console.log(`  ${JSON.stringify(countdown)} -> "${formatted}"`);
  });
  
  // Test grace period
  console.log('\nTesting grace period:');
  
  const graceDueDate1 = Date.now() - (12 * 60 * 60 * 1000); // 12 hours ago
  const graceDueDate2 = Date.now() - (30 * 60 * 60 * 1000); // 30 hours ago
  
  console.log(`  12 hours overdue, in grace period: ${isInGracePeriod(graceDueDate1, 24)}`);
  console.log(`  30 hours overdue, in grace period: ${isInGracePeriod(graceDueDate2, 24)}`);
  
  // Test edge cases
  console.log('\nTesting edge cases:');
  
  // Invalid inputs
  const invalidLateFee = calculateLateFee('invalid', 'invalid', -100);
  console.log(`  Invalid inputs late fee: ${invalidLateFee}`);
  
  const invalidTimeData = getTimeBasedData(null);
  console.log(`  Invalid time data:`, invalidTimeData.error || 'No error');
  
  console.log('\n✅ Time management tests completed!');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testTimeManagement();
}

export default testTimeManagement;