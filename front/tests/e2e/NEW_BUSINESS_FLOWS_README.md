# מדריך לבדיקות E2E חדשות - זרימות עסקיות מורכבות

## 📋 סקירה כללית

הבדיקות החדשות האלו מתמקדות בתרחישים עסקיים מורכבים שנוצרו כדי לכסות פערים בבדיקות הקיימות. הן מדמות אינטראקציות אמיתיות בין משתמשים מרובים ובודקות תרחישי קצה קריטיים.

## 🎯 כיסוי הבדיקות החדשות

### 1. בדיקות רב-משתמשים (`business-flows-multi-user.e2e.spec.ts`)

#### **E2E-NEW-01: סיום חוזה מוקדם בהסכמה מלאה**
- **מטרה:** בדיקת זרימת סיום חוזה לפני מועדו עם שחרור פיקדון יחסי
- **תרחיש:**
  1. יצירת חוזה שכירות עם פיקדון 2 ETH
  2. קידום זמן לאמצע תקופת החוזה
  3. השוכר מגיש בקשה לסיום מוקדם דרך UI
  4. המשכיר מאשר את הבקשה
  5. אימות On-chain של שחרור פיקדון יחסי לשני הצדדים

#### **E2E-NEW-02: תצוגת סטטוס במקביל בזמן סכסוך**
- **מטרה:** בדיקת עדכוני סטטוס בזמן אמת באמצעות WebSockets
- **תרחיש:**
  1. יצירת חוזה והגשת מחלוקת ע"י המשכיר
  2. פתיחת שני Playwright contexts נפרדים (אחד לכל ארנק)
  3. השוכר מגיש ראיה חדשה ומעלה CID
  4. אימות שהמשכיר רואה עדכון מיידי של "Evidence Submitted"

### 2. בדיקות תשלומים ו-LLM (`payment-complexity-llm.e2e.spec.ts`)

#### **E2E-NEW-03: תשלום מאוחר עם חישוב קנס אוטומטי**
- **מטרה:** בדיקת אינטגרציה עם V7 API לחישוב קנסות איחור
- **תרחיש:**
  1. יצירת חוזה עם קנס איחור 5%
  2. קידום זמן אחרי מועד התשלום
  3. השוכר לוחץ על כפתור תשלום
  4. המודאל מציג 1.05 ETH (כולל קנס) מחושב דרך V7 API
  5. ביצוע תשלום ואימות On-chain

#### **E2E-NEW-04: תשלום כפוי לאחר הפסד בבוררות LLM**
- **מטרה:** בדיקת זרימת תשלום כפוי לפי פסיקת LLM
- **תרחיש:**
  1. יצירת חוזה והגשת סכסוך
  2. השוכר מגיש ערעור עם ראיות חלשות
  3. הפעלת LLM Arbitrator שמפסיק לטובת המשכיר
  4. UI מציג כפתור "שלם את סכום הפסיקה"
  5. השוכר משלם ואימות סגירת מחלוקת

#### **E2E-NEW-05: זרימת כשל LLM מלאה ו-Fallback**
- **מטרה:** בדיקת יציבות המערכת כשהבורר הראשי (Ollama) לא זמין
- **תרחיש:**
  1. כיבוי שירות Ollama
  2. יצירת חוזה והגשת סכסוך
  3. הפעלת בוררות עם כשל צפוי
  4. אימות שהמערכת נופלת לבורר הסימולציה (JS Simulator)
  5. אימות שההחלטה מתקבלת ולא נתקעת

## 🔧 הגדרת הסביבה

### דרישות מוקדמות
```bash
# וודא שכל השירותים פועלים:
# 1. Hardhat Network
npm run node

# 2. Contract Deployment
npm run deploy:localhost

# 3. V7 Backend Server (פורט 3001)
cd server && node index.js

# 4. Frontend Development Server
cd front && npm run dev

# 5. Ollama Service (עבור בדיקות LLM)
ollama serve
```

### הרצת הבדיקות החדשות
```bash
cd front

# הרצת בדיקות רב-משתמשים
npx playwright test tests/e2e/business-flows-multi-user.e2e.spec.ts

# הרצת בדיקות תשלומים ו-LLM
npx playwright test tests/e2e/payment-complexity-llm.e2e.spec.ts

# הרצת כל הבדיקות החדשות
npx playwright test tests/e2e/business-flows-multi-user.e2e.spec.ts tests/e2e/payment-complexity-llm.e2e.spec.ts
```

## 📊 נתוני ביצועים צפויים

### זמני ריצה משוערים:
- **E2E-NEW-01:** ~45 שניות (כולל advancing blockchain time)
- **E2E-NEW-02:** ~30 שניות (WebSocket updates)
- **E2E-NEW-03:** ~50 שניות (V7 API calls + blockchain transactions)
- **E2E-NEW-04:** ~90 שניות (LLM processing time)
- **E2E-NEW-05:** ~60 שניות (failure detection + fallback)

### משאבי Gas צפויים:
- יצירת חוזה: ~800,000 gas
- תשלום עם קנס: ~150,000 gas
- הגשת ראיה: ~100,000 gas
- בוררות LLM: ~200,000 gas

## 🐛 טיפול בשגיאות נפוצות

### 1. שגיאת חיבור לV7 Backend
```bash
Error: connect ECONNREFUSED 127.0.0.1:3001
```
**פתרון:** וודא שה-V7 Backend רץ על פורט 3001:
```bash
cd server && node index.js
```

### 2. שגיאת Ollama לא זמין
```bash
Error: Ollama service not responding
```
**פתרון:** הפעל את שירות Ollama:
```bash
ollama serve
```

### 3. שגיאת MetaMask Wallet Switching
```bash
Error: Cannot switch wallet context
```
**פתרון:** וודא שהארנקים מוגדרים ב-`WALLETS.txt` ושהרשת Hardhat מחוברת ב-MetaMask.

### 4. בעיות זמן Blockchain
```bash
Error: Block time not advancing
```
**פתרון:** אתחל את רשת Hardhat:
```bash
npx hardhat node --reset
```

## 📈 ניתוח כיסוי חדש

### אזורים שנוספו לכיסוי:
1. **אינטראקציות רב-משתמשים:** עדכונים בזמן אמת בין צדדי חוזה
2. **תשלומים מורכבים:** חישובי קנסות דינמיים דרך API
3. **בוררות LLM:** תרחישי הצלחה וכשל של מערכת הבוררות
4. **מנגנוני Fallback:** יציבות מערכת במצבי כשל
5. **סיום חוזה מוקדם:** זרימות שונות מברירת המחדל

### פערים שעדיין קיימים:
- בדיקות אבטחה מתקדמות (security penetration)
- תרחישי רשת לא יציבה (network instability)
- עומסי קצה (load testing)
- נגישות מתקדמת (advanced accessibility)

## 🚀 הרחבות עתידיות

### בדיקות מתוכננות:
1. **E2E-NEW-06:** תרחיש עומס גבוה עם משתמשים מרובים
2. **E2E-NEW-07:** בדיקות אבטחה - ניסיונות מניפולציה
3. **E2E-NEW-08:** תרחישי כשל רשת ו-recovery
4. **E2E-NEW-09:** בדיקות PWA - offline functionality
5. **E2E-NEW-10:** בדיקות נגישות מתקדמות (screen readers, keyboard navigation)

---

**📝 הערה:** הבדיקות האלו משלימות את הכיסוי הטכני המצוין הקיים ומוסיפות ממד עסקי חשוב לאמינות המערכת.