# Backend (Node.js V7)

## Overview
The backend provides LLM-based arbitration, evidence validation, dispute history, and contract integration. It exposes REST endpoints for frontend and contract workflows.

## Architecture
- **LLM Arbitration**: Receives dispute payloads, validates evidence, calls Ollama (or simulates), and returns JSON decisions.
- **Evidence Validation**: Validates canonicalization and digest of submitted evidence. Integrates with IPFS/Helia for off-chain storage.
- **Dispute History**: Tracks all resolutions and evidence for frontend display.
- **API Endpoints**: `/api/v7/arbitration/ollama-test`, `/api/v7/arbitration/status`, `/api/v7/arbitration/decisions`, `/api/v7/evidence/submit`.

## Integration Points
- Chainlink/CCIP event simulation
- Helia/IPFS evidence validation
- LLM backend decision logic
- Dispute history and notifications
- System health endpoints

## Admin Role Clarification
- Admin is system manager only (not arbitrator).
- Arbitration decisions are made by LLM backend and applied via `ArbitrationService`.

## Developer Notes
- See `modules/` for backend logic and API wiring.
- E2E tests: See `test/` and integration scripts.

## MVP Status
- All major integration points are implemented and tested.
# V7 Backend System - Installation & Setup Guide

## מערכת Backend V7 עבור בוררות LLM ואימות ראיות Helia

### תיאור המערכת

מערכת ה-V7 Backend מספקת שלושה רכיבים עיקריים:

1. **אימות ראיות IPFS/Helia** - אימות CID ויצירת digest עבור ראיות
2. **בוררות LLM** - אינטגרציה עם שירות בוררות מבוסס בינה מלאכותית  
3. **ניהול זמן ועמלות איחור** - חישובי עמלות איחור ותשלומים מבוססי זמן

### התקנה מהירה

```bash
# 1. התקנת תלויות
cd server
npm install

# 2. הגדרת משתני סביבה
cp .env.example .env
# ערוך את הקובץ .env לפי הצורך

# 3. הפעלת המערכת
npm run start:v7
```

### מבנה הפרויקט

```
server/
├── index.js                    # שרת Express עיקרי
├── start-v7.js                # סקריפט הפעלה מלא
├── setup.js                   # הקמה והתקנה
├── package.json               # תלויות ו-scripts
├── .env.example              # דוגמת משתני סביבה
├── modules/
│   ├── evidenceValidator.js   # אימות ראיות IPFS
│   ├── llmArbitration.js     # בוררות LLM
│   ├── timeManagement.js     # ניהול זמן ועמלות
│   ├── arbitratorAPI.js      # API לשירות הבוררות
│   └── v7Integration.js      # אינטגרציה מלאה
└── tests/
    ├── testEvidence.js       # בדיקות אימות ראיות
    ├── testLLM.js           # בדיקות בוררות LLM
    └── testTime.js          # בדיקות ניהול זמן
```

## תיעוד API

### נקודות קצה עיקריות

#### 1. דיווח סכסוך
```http
POST /api/v7/dispute/report
Content-Type: application/json

{
  "contractAddress": "0x...",
  "evidenceCID": "bafybeiexampleevidencecid000000000000000",
  "disputeQuestion": "What is the appropriate resolution?",
  "contractText": "Rental agreement terms...",
  "evidenceText": "Evidence description...",
  "dueDate": "2024-01-15T00:00:00Z",
  "baseAmount": 1000,
  "lateFeeBps": 500
}
```

#### 2. הגשת ערעור
```http
POST /api/v7/dispute/appeal
Content-Type: application/json

{
  "disputeId": "original_dispute_id",
  "appealReason": "Disagreement with initial decision",
  "newEvidenceCID": "bafybeiexamplenewevidencecid000000000000",
  "contractAddress": "0x..."
}
```

#### 3. חישוב תשלום
```http
POST /api/v7/rent/calculate-payment
Content-Type: application/json

{
  "baseAmount": 1000,
  "dueDate": "2024-01-15T00:00:00Z",
  "lateFeeBps": 500,
  "gracePeriodDays": 5
}
```

#### 4. בדיקת תקינות המערכת
```http
GET /api/v7/arbitration/health
```

### תשובות API

#### תשובה מוצלחת לדיווח סכסוך:
```json
{
  "success": true,
  "processingId": "v7_1759268660684_abc123def",
  "status": "completed",
  "evidence": {
    "isValid": true,
  "cid": "bafybeiexampleevidencecid000000000000000",
    
    
    "digest": "0x1234...",
    "validatedAt": 1759268660684
  },
  "timeData": {
    "enabled": true,
    "calculated": true,
    "lateFee": 50,
    "totalPayment": 1050,
    "daysLate": 10
  },
  "arbitration": {
    "enabled": true,
    "available": true,
    "result": {
      "final_verdict": "LANDLORD_FAVOR",
      "reimbursement_amount_dai": 750,
      "rationale_summary": "Based on evidence and contract terms..."
    }
  }
}
```

## הגדרת משתני סביבה

קובץ `.env`:

```bash
# הגדרות שרת
NODE_ENV=development
SERVER_PORT=3001

# שירות בוררות LLM
LLM_ARBITRATOR_URL=http://localhost:8000
LLM_ARBITRATOR_TIMEOUT=30000


# Helia
HELIA_GATEWAY_URL=https://helia.io/api/
HELIA_TIMEOUT=10000

# Dev / Helia control
# If true, the server will accept a dev-only endpoint to remove evidence created during tests.
# WARNING: set ALLOW_DEV_CLEANUP=true only in isolated dev environments.
ALLOW_DEV_CLEANUP=false

# When false, the start script will not automatically spawn an external `helia daemon`.
# If true (default), start-v7 will attempt to auto-start an external helia daemon when none is found.
HELIA_AUTO_START=true

# If true, start-v7 will try to start an in-process Helia node when no external Helia API is reachable.
# This is now the default behavior for local dev (START_INPROC_HELIA=true).
START_INPROC_HELIA=true

# Blockchain
RPC_URL=http://localhost:8545
PRIVATE_KEY=your_private_key_here

# עמלות ברירת מחדל
DEFAULT_LATE_FEE_BPS=500
DEFAULT_GRACE_PERIOD_DAYS=3
```

## אינטגרציה עם Frontend

### שימוש ב-React/Frontend

```javascript
// services/v7Backend.js
const V7_API_BASE = 'http://localhost:3001/api/v7';

export async function reportDispute(disputeData) {
  const response = await fetch(`${V7_API_BASE}/dispute/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(disputeData)
  });
  
  return await response.json();
}

export async function calculatePayment(paymentData) {
  const response = await fetch(`${V7_API_BASE}/rent/calculate-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(paymentData)
  });
  
  return await response.json();
}
```

### דוגמת שימוש ב-Component

```jsx
import { reportDispute, calculatePayment } from '../services/v7Backend';

function DisputeForm() {
  const handleSubmitDispute = async (formData) => {
    try {
      const result = await reportDispute({
        contractAddress: formData.contractAddress,
        evidenceCID: formData.evidenceCID,
        disputeQuestion: formData.question,
        dueDate: formData.dueDate,
        baseAmount: formData.amount,
        lateFeeBps: 500
      });
      
      if (result.success) {
        console.log('Dispute processed:', result.processingId);
        // Handle successful processing
      }
    } catch (error) {
      console.error('Dispute failed:', error);
    }
  };
  
  // JSX rendering...
}
```

## בדיקות (Testing)

### הרצת כל הבדיקות
```bash
npm test
```

### הרצת בדיקות ספציפיות
```bash
# בדיקות אימות ראיות
npm run test:evidence

# בדיקות בוררות LLM
npm run test:llm

# בדיקות ניהול זמן
npm run test:time
```

### דוגמת בדיקה ידנית
```bash
# בדיקת תקינות המערכת
curl http://localhost:3001/api/v7/arbitration/health

# בדיקת חישוב תשלום
curl -X POST http://localhost:3001/api/v7/rent/calculate-payment \
  -H "Content-Type: application/json" \
  -d '{"baseAmount": 1000, "dueDate": "2024-01-01T00:00:00Z", "lateFeeBps": 500}'
```

## פתרון בעיות נפוצות

### 1. שירות הבוררות לא זמין
```
⚠️ LLM API unavailable, using fallback
```
**פתרון**: המערכת עובדת במצב סימולציה. לאינטגרציה מלאה, הגדר שירות Python FastAPI.

### 2. IPFS CID לא תקין
```
❌ Evidence validation failed: Invalid CID format
```
**פתרון**: וודא שה-CID בפורמט תקין (מתחיל ב-Qm או bafk).

### 3. חישובי זמן שגויים
```
Missing dueDate or baseAmount
```
**פתרון**: וודא שכל השדות הנדרשים קיימים בבקשה.

## פיתוח והרחבה

### הוספת מודול חדש
1. צור קובץ חדש ב-`modules/`
2. יצא פונקציות עיקריות
3. הוסף אינטגרציה ב-`v7Integration.js`
4. עדכן נקודות קצה ב-`index.js`

### הוספת בדיקות
1. צור קובץ בדיקה ב-`tests/`
2. השתמש ב-Jest לבדיקות יחידה
3. הוסף סקריפט ב-`package.json`

## התקנה מתקדמת

### עם Docker
```bash
# בניית image
docker build -t v7-backend .

# הרצה
docker run -p 3001:3001 -v $(pwd)/.env:/app/.env v7-backend
```

### עם PM2 (Production)
```bash
# התקנת PM2
npm install -g pm2

# הפעלה
pm2 start ecosystem.config.js

# ניטור
pm2 monit
```

## תחזוקה

### לוגים
```bash
# צפייה בלוגים בזמן אמת
tail -f logs/v7-backend.log

# ניקוי לוגים ישנים
npm run clean:logs
```

### בדיקות תקופתיות
```bash
# בדיקת תקינות שירותים
npm run health:check

# עדכון תלויות
npm audit fix
```

---

## תמיכה

לשאלות או בעיות, אנא צור issue בתוך הפרויקט או פנה לתיעוד המלא ב-README הראשי.

מערכת V7 Backend מספקת בסיס חזק עבור פתרונות בוררות מתקדמים עם אינטגרציה מלאה של בינה מלאכותית וטכנולוגיות מבוזרות.