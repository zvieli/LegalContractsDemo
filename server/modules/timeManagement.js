/**
 * V7 Time Management Module
 * Handles late fee calculations and time-based contract data
 */

/**
 * Calculate late fee based on overdue period
 * @param {number|string} dueDate - Due date timestamp (seconds or milliseconds)
 * @param {number|string} baseAmount - Base amount (ETH)
 * @param {number} lateFeeBps - Late fee in basis points (default 500 = 5%)
 * @returns {number} - Late fee amount in ETH
 */
export function calculateLateFee(dueDate, baseAmount, lateFeeBps = 500) {
  try {
    // Normalize inputs
    const dueDateMs = typeof dueDate === 'string' ? parseInt(dueDate) : dueDate;
    const normalizedDueDate = dueDateMs < 1e12 ? dueDateMs * 1000 : dueDateMs; // Convert to milliseconds if needed
    const amount = typeof baseAmount === 'string' ? parseFloat(baseAmount) : baseAmount;
    
    const currentTime = Date.now();
    const timeDifference = currentTime - normalizedDueDate;
    
    // If not overdue, no late fee
    if (timeDifference <= 0) {
      return 0;
    }
    
    // Calculate days overdue (minimum 1 day for any lateness)
    const daysOverdue = Math.max(1, Math.ceil(timeDifference / (24 * 60 * 60 * 1000)));
    
    // Calculate late fee: base amount * (late fee % / 100) * days overdue
    // For monthly compounds: compound daily if desired
    const lateFeePercent = lateFeeBps / 10000; // Convert basis points to decimal
    
    // Simple daily compound: (1 + daily_rate)^days - 1
    const dailyRate = lateFeePercent / 30; // Assuming monthly rate, divide by 30 for daily
    const compoundMultiplier = Math.pow(1 + dailyRate, daysOverdue) - 1;
    
    const lateFee = amount * compoundMultiplier;
    
    // Cap the late fee at reasonable maximum (e.g., 50% of base amount)
    const maxLateFee = amount * 0.5;
    
    return Math.min(lateFee, maxLateFee);
    
  } catch (error) {
    console.error('Error calculating late fee:', error);
    return 0;
  }
}

/**
 * Get comprehensive time-based data for a contract
 * @param {number|string} dueDate - Due date timestamp
 * @param {number|string} contractEndDate - Contract end date (optional)
 * @returns {Object} - Time-based contract data
 */
export function getTimeBasedData(dueDate, contractEndDate = null) {
  try {
    const dueDateMs = typeof dueDate === 'string' ? parseInt(dueDate) : dueDate;
    const normalizedDueDate = dueDateMs < 1e12 ? dueDateMs * 1000 : dueDateMs;
    
    const currentTime = Date.now();
    const timeDifference = normalizedDueDate - currentTime;
    const isOverdue = timeDifference < 0;
    
    // Calculate time remaining or overdue
    const absTimeDiff = Math.abs(timeDifference);
    const days = Math.floor(absTimeDiff / (24 * 60 * 60 * 1000));
    const hours = Math.floor((absTimeDiff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((absTimeDiff % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((absTimeDiff % (60 * 1000)) / 1000);
    
    const countdown = { days, hours, minutes, seconds };
    
    // Contract end date processing
    let contractEndData = null;
    if (contractEndDate) {
      const endDateMs = typeof contractEndDate === 'string' ? parseInt(contractEndDate) : contractEndDate;
      const normalizedEndDate = endDateMs < 1e12 ? endDateMs * 1000 : endDateMs;
      const endTimeDiff = normalizedEndDate - currentTime;
      const daysUntilExpiry = Math.floor(endTimeDiff / (24 * 60 * 60 * 1000));
      
      contractEndData = {
        endDate: normalizedEndDate,
        daysUntilExpiry,
        isExpired: endTimeDiff < 0,
        isNearExpiry: daysUntilExpiry <= 30 && daysUntilExpiry > 0
      };
    }
    
    return {
      dueDate: normalizedDueDate,
      currentTime,
      isOverdue,
      daysOverdue: isOverdue ? days : 0,
      countdown,
      timeDifference,
      contractEnd: contractEndData,
      status: getPaymentStatus(timeDifference),
      urgency: getUrgencyLevel(timeDifference, isOverdue)
    };
    
  } catch (error) {
    console.error('Error getting time-based data:', error);
    return {
      error: error.message,
      isOverdue: false,
      daysOverdue: 0,
      countdown: { days: 0, hours: 0, minutes: 0, seconds: 0 }
    };
  }
}

/**
 * Get payment status based on time difference
 * @param {number} timeDifference - Time difference in milliseconds
 * @returns {string} - Payment status
 */
function getPaymentStatus(timeDifference) {
  if (timeDifference < 0) {
    return 'OVERDUE';
  } else if (timeDifference < 24 * 60 * 60 * 1000) { // Less than 24 hours
    return 'DUE_SOON';
  } else if (timeDifference < 7 * 24 * 60 * 60 * 1000) { // Less than 7 days
    return 'UPCOMING';
  } else {
    return 'CURRENT';
  }
}

/**
 * Get urgency level for UI styling
 * @param {number} timeDifference - Time difference in milliseconds
 * @param {boolean} isOverdue - Whether payment is overdue
 * @returns {string} - Urgency level
 */
function getUrgencyLevel(timeDifference, isOverdue) {
  if (isOverdue) {
    const daysOverdue = Math.floor(Math.abs(timeDifference) / (24 * 60 * 60 * 1000));
    if (daysOverdue > 7) return 'CRITICAL';
    if (daysOverdue > 3) return 'HIGH';
    return 'MEDIUM';
  } else {
    if (timeDifference < 24 * 60 * 60 * 1000) return 'HIGH'; // Less than 24 hours
    if (timeDifference < 3 * 24 * 60 * 60 * 1000) return 'MEDIUM'; // Less than 3 days
    return 'LOW';
  }
}

/**
 * Calculate total payment amount including late fees
 * @param {Object} paymentData - Payment calculation data
 * @returns {Object} - Complete payment breakdown
 */
export function calculateTotalPayment(paymentData) {
  try {
    const { baseAmount, dueDate, lateFeeBps = 500 } = paymentData;
    
    const lateFee = calculateLateFee(dueDate, baseAmount, lateFeeBps);
    const totalAmount = parseFloat(baseAmount) + lateFee;
    const timeData = getTimeBasedData(dueDate);
    
    return {
      baseAmount: parseFloat(baseAmount),
      lateFee,
      totalAmount,
      lateFeeBps,
      timeData,
      breakdown: {
        principal: parseFloat(baseAmount),
        penalty: lateFee,
        total: totalAmount
      },
      paymentStatus: timeData.status,
      urgency: timeData.urgency
    };
    
  } catch (error) {
    console.error('Error calculating total payment:', error);
    return {
      error: error.message,
      baseAmount: 0,
      lateFee: 0,
      totalAmount: 0
    };
  }
}

/**
 * Get payment schedule for future payments
 * @param {number} startDate - Start date timestamp
 * @param {number} paymentInterval - Payment interval in days
 * @param {number} numberOfPayments - Number of payments to generate
 * @param {number} baseAmount - Base payment amount
 * @returns {Array} - Payment schedule
 */
export function generatePaymentSchedule(startDate, paymentInterval, numberOfPayments, baseAmount) {
  try {
    const schedule = [];
    const startMs = typeof startDate === 'string' ? parseInt(startDate) : startDate;
    const normalizedStart = startMs < 1e12 ? startMs * 1000 : startMs;
    
    for (let i = 0; i < numberOfPayments; i++) {
      const paymentDate = normalizedStart + (i * paymentInterval * 24 * 60 * 60 * 1000);
      const paymentNumber = i + 1;
      
      schedule.push({
        paymentNumber,
        dueDate: paymentDate,
        dueDateFormatted: new Date(paymentDate).toLocaleDateString(),
        baseAmount: parseFloat(baseAmount),
        status: paymentDate < Date.now() ? 'DUE' : 'SCHEDULED',
        timeUntilDue: paymentDate - Date.now()
      });
    }
    
    return schedule;
    
  } catch (error) {
    console.error('Error generating payment schedule:', error);
    return [];
  }
}

/**
 * Format time countdown for display
 * @param {Object} countdown - Countdown object with days, hours, minutes, seconds
 * @returns {string} - Formatted time string
 */
export function formatCountdown(countdown) {
  try {
    const { days, hours, minutes, seconds } = countdown;
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
    
  } catch (error) {
    return '0s';
  }
}

/**
 * Check if contract is in grace period
 * @param {number} dueDate - Due date timestamp
 * @param {number} gracePeriodHours - Grace period in hours (default 24)
 * @returns {boolean} - Whether contract is in grace period
 */
export function isInGracePeriod(dueDate, gracePeriodHours = 24) {
  try {
    const dueDateMs = typeof dueDate === 'string' ? parseInt(dueDate) : dueDate;
    const normalizedDueDate = dueDateMs < 1e12 ? dueDateMs * 1000 : dueDateMs;
    const currentTime = Date.now();
    const gracePeriodMs = gracePeriodHours * 60 * 60 * 1000;
    
    return currentTime <= normalizedDueDate + gracePeriodMs;
    
  } catch (error) {
    console.error('Error checking grace period:', error);
    return false;
  }
}

/**
 * Get time-based color coding for UI
 * @param {Object} timeData - Time data from getTimeBasedData
 * @returns {Object} - Color codes for UI elements
 */
export function getTimeBasedColors(timeData) {
  const { isOverdue, status, urgency } = timeData;
  
  const colors = {
    OVERDUE: { background: '#fee2e2', border: '#ef4444', text: '#dc2626' },
    DUE_SOON: { background: '#fef3c7', border: '#f59e0b', text: '#d97706' },
    UPCOMING: { background: '#dbeafe', border: '#3b82f6', text: '#2563eb' },
    CURRENT: { background: '#d1fae5', border: '#10b981', text: '#059669' }
  };
  
  return colors[status] || colors.CURRENT;
}

/**
 * Validate time-based input parameters
 * @param {Object} params - Parameters to validate
 * @returns {Object} - Validation result
 */
export function validateTimeParams(params) {
  const errors = [];
  
  if (params.dueDate) {
    const dueDate = typeof params.dueDate === 'string' ? parseInt(params.dueDate) : params.dueDate;
    if (isNaN(dueDate) || dueDate <= 0) {
      errors.push('Invalid due date');
    }
  }
  
  if (params.baseAmount) {
    const amount = typeof params.baseAmount === 'string' ? parseFloat(params.baseAmount) : params.baseAmount;
    if (isNaN(amount) || amount < 0) {
      errors.push('Invalid base amount');
    }
  }
  
  if (params.lateFeeBps !== undefined) {
    if (isNaN(params.lateFeeBps) || params.lateFeeBps < 0 || params.lateFeeBps > 10000) {
      errors.push('Invalid late fee basis points (must be 0-10000)');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}