# V7 E2E Tests - Refactored for Current UI

## Overview
הטסטים E2E עודכנו במלואם כדי לעבוד עם הסלקטורים והמבנה החדש של ה-UI של V7. הטסטים מתמקדים בוולידציה של תקינות ה-UI ולא בשינוי שלו.

## Updated Test Files

### 1. `v7-complete-flow.e2e.spec.ts` (חדש)
**מטרה**: בדיקה מקיפה של כל תהליך המשתמש ב-V7
**מה נבדק**:
- ✅ עמוד הבית והאלמנטים העיקריים
- ✅ זיהוי משתמש רגיל vs אדמין
- ✅ דשבורד אדמין מלא (סטטוס סנכרון, כרטיסי סיכום, טבלת טרנזקציות, משיכת כספים)
- ✅ ניווט בין דפים
- ✅ עיצוב רספונסיבי
- ✅ מבנה נגישות

### 2. `ui-validation-v7.e2e.spec.ts` (חדש)
**מטרה**: בדיקת מצבי UI במהלך תהליך בוררות V7
**מה נבדק**:
- ✅ אלמנטי UI של V7
- ✅ דשבורד אדמין ופונקציונליות משיכה
- ✅ ניווט לדשבורד חוזים
- ✅ פיצ'רים ייחודיים ל-V7 (בוררות LLM, הגשת ראיות)
- ✅ עיצוב רספונסיבי ונגישות

### 3. `simple-check.e2e.spec.ts` (עודכן)
**מטרה**: בדיקה בסיסית של חוזים + UI
**מה נוסף**:
- ✅ בדיקת אלמנטי UI בסיסיים של V7
- ✅ זיהוי דשבורד אדמין vs משתמש רגיל
- ✅ בדיקת כפתורי ניווט

### 4. `template.rent.e2e.spec.ts` (עודכן)
**מטרה**: בדיקת תהליך בוררות מלא עם חוזה שכירות
**מה עודכן**:
- ✅ תואם ל-V7 architecture
- ✅ משתמש בסלקטורים החדשים
- ✅ בדיקת תהליך בוררות מלא

## Key UI Selectors Used

### Home Page
```typescript
'[data-testid="home-title"]'          // כותרת עיקרית
'[data-testid="home-hero-section"]'   // קטע הירו
'[data-testid="create-contract-btn"]' // כפתור יצירת חוזה
'[data-testid="browse-contracts-btn"]'// כפתור עיון חוזים
'[data-testid="home-features-section"]' // קטע תכונות
'[data-testid="feature-card-X"]'      // כרטיסי תכונות
```

### Admin Dashboard
```typescript
'[data-testid="admin-dashboard"]'     // דשבורד אדמין עיקרי
'[data-testid="sync-status"]'         // סטטוס סנכרון
'[data-testid="refresh-sync-btn"]'    // כפתור רענון
'[data-testid="summary-dai"]'         // כרטיס סיכום DAI
'[data-testid="summary-eth"]'         // כרטיס סיכום ETH
'[data-testid="transactions-table"]'  // טבלת טרנזקציות
'[data-testid="open-withdraw-modal"]' // כפתור פתיחת חלון משיכה
'[data-testid="withdraw-modal"]'      // חלון משיכת כספים
'[data-testid="withdraw-address-input"]' // שדה כתובת
'[data-testid="withdraw-amount-input"]'  // שדה סכום
'[data-testid="withdraw-token-select"]'  // בחירת טוקן
'[data-testid="confirm-withdraw-btn"]'   // אישור משיכה
```

### Regular User Elements
```typescript
'[data-testid="dashboard-card"]'      // כרטיס דשבורד
'[data-testid="contract-placeholder"]' // placeholder חוזה
'[data-testid="view-details-btn"]'    // כפתור פרטים
'[data-testid="connect-wallet-hint"]' // הודעת חיבור ארנק
```

## Running the Tests

### Prerequisites
```bash
# וודא שה-hardhat node רץ
npm run node

# וודא שהחוזים deployed
npm run deploy:localhost

# וודא שהפרונט רץ
npm run dev
```

### Individual Tests
```bash
# טסט מלא של V7
npx playwright test v7-complete-flow.e2e.spec.ts --headed

# בדיקת UI validation
npx playwright test ui-validation-v7.e2e.spec.ts --headed

# בדיקה בסיסית
npx playwright test simple-check.e2e.spec.ts --headed

# טסט חוזה שכירות מלא
npx playwright test template.rent.e2e.spec.ts --headed
```

### All V7 Tests
```bash
npx playwright test --grep "V7" --headed
```

## Test Philosophy

### ✅ מה הטסטים כן עושים:
- בודקים שהסלקטורים קיימים ותקינים
- מוודאים שהתכונות נגישות למשתמש
- בודקים זרימות ניווט
- מאמתים תקינות תצוגה בגדלי מסך שונים
- בודקים הכלת שגיאות

### ❌ מה הטסטים לא עושים:
- לא משנים את ה-UI
- לא דורשים סלקטורים ספציפיים שלא קיימים
- לא יוצרים תלות בעיצוב מסוים
- לא כופים מבנה UI מסוים

## Maintenance

כשמוסיפים תכונות חדשות:
1. הוסף `data-testid` מתאים לאלמנטים חדשים
2. עדכן את הטסטים לכלול את התכונה החדשה
3. וודא שהטסטים עדיין עוברים

כשמשנים UI:
1. עדכן רק את הסלקטורים הרלוונטיים
2. שמור על התאמה לפונקציונליות הקיימת
3. הרץ את כל הטסטים לוודא תקינות

## Debugging

אם טסט נכשל:
1. בדוק שהפרונט רץ על http://localhost:5173
2. בדוק שהחוזים deployed בהצלחה
3. בדוק שהסלקטורים תואמים לקוד הנוכחי
4. הרץ עם `--headed` לראות מה קורה בדפדפן