// Chainlink Functions V7 - JavaScript
// AI Arbitrator קורא ל-FastAPI endpoint ומחזיר סכום הפיצוי.
// מותאם לטיפול בכשלים ודיוק פיננסי (Mitigations 4.4, 4.5)

// כתובת ה-API של שרת FastAPI (לייצור - החלף בכתובת האמיתית)
const ARBITRATOR_API_URL = args[0] || "http://host.docker.internal:8000/arbitrate"; 

// קבועים לטיפול בכשלים
const FAILURE_CODE = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF") - BigInt(1); // MAX_UINT256 - 1
const DAI_TO_WEI_MULTIPLIER = BigInt("1000000000000000000"); // 10^18 for DAI to Wei conversion
const REQUEST_TIMEOUT_MS = 25000; // 25 seconds timeout

// 1. בדיקת פרמטרים
if (args.length < 4) {
    console.error("Error: Missing required arguments. Expected: [api_url, contract_text, evidence_text, dispute_question]");
    return Functions.encodeUint256(FAILURE_CODE);
}

const contractText = args[1];
const evidenceText = args[2]; 
const disputeQuestion = args[3];

// 2. בניית ה-Payload
const payload = {
    contract_text: contractText,
    evidence_text: evidenceText,
    dispute_question: disputeQuestion
};

let response;
let responseJson;

try {
    // 3. הגדרת בקשת HTTP עם timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    
    const request = Functions.makeHttpRequest({
        url: ARBITRATOR_API_URL,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            // אופציונלי: הוספת API Key
            // "Authorization": "Bearer YOUR_API_KEY"
        },
        data: payload,
        timeout: REQUEST_TIMEOUT_MS
    });

    // 4. ביצוע הקריאה
    response = await request;
    clearTimeout(timeoutId);

    // 5. בדיקת סטטוס HTTP
    if (response.error) {
        console.error(`HTTP Error: ${response.error.code} - ${response.error.message}`);
        return Functions.encodeUint256(FAILURE_CODE);
    }

    // 6. ניתוח JSON
    try {
        responseJson = response.data;
        if (typeof responseJson === 'string') {
            responseJson = JSON.parse(responseJson);
        }
    } catch (jsonError) {
        console.error(`JSON Parse Error: ${jsonError.message}`);
        return Functions.encodeUint256(FAILURE_CODE);
    }

    // 7. אימות המבנה הנדרש
    if (!responseJson || typeof responseJson !== 'object') {
        console.error("Invalid response structure: not an object");
        return Functions.encodeUint256(FAILURE_CODE);
    }

    // 8. חילוץ סכום ההכרעה
    const amount = responseJson.reimbursement_amount_dai;
    
    if (typeof amount !== 'number' || amount < 0 || !Number.isFinite(amount)) {
        console.error(`Invalid reimbursement amount: ${amount}`);
        return Functions.encodeUint256(FAILURE_CODE);
    }

    // 9. המרה לפורמט Wei עם דיוק פיננסי (Mitigation 4.4)
    try {
        // עיגול לסנטים (2 מקומות עשרוניים) לפני המרה ל-Wei
        const roundedAmount = Math.round(amount * 100) / 100;
        
        // המרה ל-Wei באמצעות BigInt
        const amountInCents = BigInt(Math.round(roundedAmount * 100));
        const weiAmount = amountInCents * (DAI_TO_WEI_MULTIPLIER / BigInt(100));
        
        // בדיקת overflow
        if (weiAmount >= FAILURE_CODE) {
            console.error("Amount too large, would cause overflow");
            return Functions.encodeUint256(FAILURE_CODE);
        }

        // 10. רישום להדה
        console.log(`Arbitration completed: verdict=${responseJson.final_verdict}, amount=${roundedAmount} DAI, wei=${weiAmount.toString()}`);
        
        return Functions.encodeUint256(weiAmount);

    } catch (conversionError) {
        console.error(`Amount conversion error: ${conversionError.message}`);
        return Functions.encodeUint256(FAILURE_CODE);
    }

} catch (networkError) {
    // 11. טיפול בכשלי רשת (Mitigation 4.5)
    console.error(`Network/Request Error: ${networkError.message || networkError}`);
    return Functions.encodeUint256(FAILURE_CODE);
} finally {
    // 12. ניקוי זיכרון (Mitigation 4.6)
    payload.contract_text = null;
    payload.evidence_text = null;
    payload.dispute_question = null;
    contractText = null;
    evidenceText = null;
    disputeQuestion = null;
}