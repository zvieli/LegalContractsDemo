# CCIP Oracle Integration - V7 Implementation

## Overview

העליית Oracle מבוססת CCIP (Chainlink Cross-Chain Interoperability Protocol) לArbiTrust V7, המאפשרת בוררות אוטומטית חוצת רשתות ללא עלויות עבור מטרות חינוכיות.

## Architecture

### Core Components

1. **CCIP Contracts** (`contracts/ccip/`)
   - `CCIPArbitrationTypes.sol` - מבני נתונים וטיפוסים
   - `CCIPArbitrationSender.sol` - שליחת בקשות בוררות
   - `CCIPArbitrationReceiver.sol` - קבלת החלטות בוררות

2. **Enhanced Templates**
   - `NDATemplate.sol` - נוסף CCIP integration
   - `TemplateRentContract.sol` - נוסף CCIP integration

3. **ArbitrationService Extension**
   - `ArbitrationService.sol` - הורחב עם CCIP receiver capabilities

4. **V7 Backend Integration** (`server/ccip/`)
   - `ccipEventListener.js` - מאזין לאירועי CCIP
   - `ccipResponseHandler.js` - מטפל בתגובות CCIP

## Features

### Automatic Oracle Arbitration
- דיווח על הפרה מפעיל אוטומטית בוררות CCIP
- LLM (Ollama) מעבד את הראיות ומחזיר החלטה
- החלטה מיושמת אוטומטית דרך ArbitrationService

### Zero-Cost Educational Implementation
- שימוש ב-CCIP Local Simulator
- ללא תשלומים אמיתיים
- מתאים לסביבת פיתוח ולמידה

### Hybrid Approach
- שמירה על פונקציונליות קיימת
- הוספת יכולות CCIP כשכבה נוספת
- fallback למערכת בוררות מסורתית

## Usage

### 1. Contract Configuration

```solidity
// Configure CCIP in NDA/Rent contracts
contract.configureCCIP(ccipSenderAddress, true);

// Check CCIP availability
bool available = contract.isCCIPAvailable();
```

### 2. Automatic Arbitration

```solidity
// Reporting breach automatically triggers CCIP arbitration
contract.reportBreach(evidenceUri, claimAmount);
// -> Automatically calls CCIP Oracle if enabled
```

### 3. Manual Arbitration Trigger

```solidity
// Manually trigger CCIP arbitration for specific case
contract.triggerCCIPArbitration(caseId);
```

### 4. Backend Integration

```javascript
// Start V7 system with CCIP integration
npm run start:v7

// CCIP Event Listener automatically:
// 1. Listens for arbitration requests
// 2. Processes with Ollama LLM
// 3. Sends decisions to ArbitrationService
```

## Environment Configuration

Add to `.env`:

```bash
# CCIP Configuration
ARBITRATION_SERVICE_ADDRESS=0x...
CCIP_SENDER_ADDRESS=0x...
CCIP_RECEIVER_ADDRESS=0x...

# Private key for signing transactions
PRIVATE_KEY=0x...

# Chain configuration
CHAIN_ID=31337
RPC_URL=http://127.0.0.1:8545
```

## Deployment

### 1. Deploy CCIP Infrastructure

```bash
npx hardhat run tasks/ccip/deploy-ccip-arbitration.js
```

### 2. Configure Contracts

```bash
# Configure CCIP sender in templates
# Authorize receivers in ArbitrationService
```

### 3. Start V7 Backend

```bash
cd server
npm run start:v7
```

## Testing

### Local Development

```bash
# Start local network
npx hardhat node

# Deploy contracts
npx hardhat run tasks/ccip/deploy-ccip-arbitration.js --network localhost

# Start V7 backend with CCIP
cd server && npm run start:v7

# Create test dispute in frontend
# Watch automatic Oracle arbitration
```

### CCIP Local Simulator

הפרויקט משתמש ב-CCIP Local Simulator עבור:
- בדיקות ללא עלות
- סביבת פיתוח מקומית
- סימולציה של cross-chain communication

## Integration Flow

1. **Dispute Reporting**: User reports breach/dispute
2. **CCIP Trigger**: Contract automatically triggers CCIP arbitration
3. **Event Detection**: Backend detects CCIP arbitration request
4. **LLM Processing**: Ollama LLM analyzes evidence and makes decision
5. **Decision Sending**: Decision sent to ArbitrationService via CCIP
6. **Automatic Resolution**: ArbitrationService applies decision to contract

## Benefits

- **Zero Cost**: Educational implementation with no real fees
- **Automatic**: No manual arbitrator intervention needed
- **Transparent**: All decisions logged on-chain
- **Scalable**: Can handle multiple contracts and dispute types
- **Educational**: Perfect for learning Oracle and CCIP concepts

## Next Steps

1. פיתוח UI components לCCIP management
2. הוספת monitoring ו-analytics
3. שדרוג ל-production CCIP עם תשלומים אמיתיים
4. התאמת LLM models לסוגי סכסוכים שונים

---

**Note**: זהו implementation חינוכי. עבור production יש צורך בקונפיגורציה של CCIP אמיתי עם LINK tokens ותשלומים.