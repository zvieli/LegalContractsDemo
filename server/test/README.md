# LLM Arbitration Tests

This directory contains tests for the optimized LLM arbitration system.

## Test Files

### Core Functionality Tests
- `test_improved_llm.js` - **Main optimized LLM test** with consistency checks and performance validation
- `testLLM.js` - Legacy LLM basic functionality test
- `testEvidence.js` - Evidence processing tests
- `testTime.js` - Timing and performance tests

### Scenario Tests
- `test-v7-arbitration.js` - V7 arbitration system integration test
- `test-unpaid-rent.js` - Unpaid rent scenario test
- `test-rent-scenario.js` - General rent contract scenario test

## Running Tests

### Optimized LLM Test (Recommended)
```bash
cd server/test
node test_improved_llm.js
```

### All Tests
```bash
cd server
npm test
```

## Performance Expectations
- **test_improved_llm.js**: ~86s processing with validated results
- **Legacy tests**: May be slower and less reliable

## Test Data
- Uses test evidence from existing JSON files
- Simulates complex contract disputes
- Validates schema compliance and logical consistency

---
*Updated: October 10, 2025*