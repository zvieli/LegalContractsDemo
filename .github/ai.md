מפרט מערכת בוררות אוטומטית (AI-Powered Arbitration V7) - סופימסמך זה מאגד את כל ההחלטות הארכיטקטוניות העדכניות, המגדיר מערכת בוררות אוטומטית, אסינכרונית, מאובטחת וממומנת על ידי פיקדון (Arbitration Bond).1. מבט כללי (Overview High Level)המערכת מחליפה את האמון ב- באמון במודל AI מקומי המופעל באופן מאובטח באמצעות Chainlink Functions.Smart Contracts: ArbitrationServiceV2 (הדיספאצ'ר) + ArbitrationContract (לקוח Chainlink). השינוי המרכזי ב-V7 הוא אכיפת אבטחת  ו- מחמירות.Template Contracts: חוזי יעד (NDA / שכירות). חובה: הטמעת מודל  (פיקדון משותף מראש) להבטחת אכיפה.AI Arbitrator (FastAPI): Python מריץ Ollama (LLM חינמי) + . המימוש הסופי של הקוד הוטמע בסעיף 6.Chainlink: Chainlink Functions (JavaScript). הגשר המאובטח, נדרשת התאמה לטיפול בכשלים מספריים ().2. מודל פיקדון משותף (Critical Financial Model - Arbitration Bond)כדי להבטיח כיסוי עלויות Chainlink ויכולת אכיפה מלאה, חובה על חוזי היעד להחזיק פיקדון מראש.2.1. דרישה ל-מטרה: להבטיח כיסוי עלויות LINK ואבטחת כספי פיצוי.יישום: כל חוזה  מחויב לדרוש משני הצדדים ( ו-) להפקיד סכום קבוע בזמן יצירת או מימון החוזה.גורל הפיקדון: הפיצוי נלקח מתוך הפיקדון הנעול בחוזה.2.2. מקרה קצה: הכלל: אם סכום הפיצוי () גדול מסך הפיקדון הזמין (), החוזה חייב להעביר את כל יתרת הפיקדון לזוכה ולפלוט אירוע .3. זרימת הנתונים המלאה (Full Data Flow: AI Arbitration Request)הפלואו מחולק לפאזת בקשה סינכרונית ופאזת אכיפה אסינכרונית מאובטחת:הגשת הבקשה:  שולח את ה- (ראיות, חוזה) ל-. (סיכון: פרטיות, הנתונים עוזבים את המכשיר ב-).אחסון ושיגור:  מאחסן מיפוי:  ל- ומפעיל . (בדיקה: תקינות ה-).יצירת בקשת Chainlink:  יוצר בקשת .הפעלת Oracle ו-: קוד ה- נטען ומחלץ את  מ-.קריאת AI ועיבוד:  שולח  מאובטח ל- (Ollama). ה- מחזיר  עם . (*סיכון: ה- חייב לטפל ב- וב- לא תקין - Mitigation 4.5).המרה וקידוד ABI קריטי: המרת  ל- (כפול ) באמצעות BigInt ועיגול נכון ב-. קידוד ל-. (*סיכון: דיוק פיננסי - Mitigation 4.4).Callback מאובטח:  שולח טרנזקציה הקוראת ל-.עיבוד התוצאה ובדיקת אבטחה:  מפענח את התוצאה וקורא ל-. חובה לבצע בדיקת  ().אכיפה סופית:  בודק  (מניעת שידור חוזר - ) וקורא ל-. הכספים מועברים מהפיקדון הנעול.4. סיכונים קריטיים ופתרונות מובנים (Mitigations)Mitigation 4.2 (Callback מזויף / הפעלה כפולה): שימוש במיפוי  ובדיקת  קשיחה ב-.Mitigation 4.4 (דיוק פיננסי): שימוש ב- והבטחת עיגול נכון ב- לפני הכפלה ל-.Mitigation 4.5 (עמידות): קוד ה- חייב להחזיר FAILURE_CODE (קוד מספרי מוסכם) במקרה של כשל  או כשל  לא תקין.Mitigation 4.6 (חשיפת Plaintext): חובה למחוק משתנים המכילים  (כגון ) מזיכרון ה- באופן מפורש (באמצעות ) מיד לאחר השימוש.5. מימוש קוד AI Arbitrator ו-Chainlinkלהלן קטעי הקוד המדויקים למימוש מערכת הבוררות:5.1. AI Arbitrator (Python / FastAPI) - arbitrator_api.pyקובץ זה מממש את ה-, משתמש במודלי Ollama, ויוצר צוות סוכנים () לניתוח. בלוק ה- המיועד ל-Mitigation 4.6 נכלל.

```
import json
import os
import tempfile
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from agno.agent import Agent
from agno.knowledge.inmemory import InMemoryKnowledgeBase
from agno.models.ollama import Ollama
from agno.embedder.ollama import OllamaEmbedder

# --- 1. הגדרות מודל Ollama (חינם) ---
# ודא ש-Ollama פועל והמודלים 'llama3.1:8b' ו-'openhermes' זמינים.
OLLAMA_BASE_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
LLM_MODEL = "llama3.1:8b"
EMBEDDER_MODEL = "openhermes"

# --- 2. מודלי Pydantic (קלט/פלט) ---

class ArbitrationInput(BaseModel):
    """מבנה הקלט המצופה מ-Chainlink Functions."""
    contract_text: str = Field(description="הטקסט המלא של החוזה המקורי.")
    evidence_text: str = Field(description="הראיות שהוגשו על ידי הצדדים.")
    dispute_question: str = Field(description="השאילתה הספציפית לבוררות (למשל: האם צד א' הפר את סעיף 3.4?).")

class ArbitrationOutput(BaseModel):
    """מבנה הפלט המובנה הנדרש עבור ה-Smart Contract."""
    final_verdict: str = Field(description="PARTY_A_WINS, PARTY_B_WINS, or DRAW.")
    reimbursement_amount_dai: int = Field(description="סכום הפיצוי (DAI) המומלץ. 0 אם אין קנס.")
    rationale_summary: str = Field(description="סיכום הנימוק להחלטה.")


app = FastAPI(
    title="Local AI Arbitrator API",
    description="Stateless endpoint powered by Ollama for free arbitration logic.",
)


def initialize_legal_team(knowledge_base):
    """אתחול צוות הסוכנים עם מודלי Ollama המקומיים."""
    try:
        ollama_llm = Ollama(id=LLM_MODEL, base_url=OLLAMA_BASE_URL)
        
        # סוכנים (Agent definitions)
        legal_researcher = Agent(
            name="Legal Researcher",
            role="Legal research specialist, focuses on external context and precedents.",
            model=ollama_llm,
            knowledge=knowledge_base,
            search_knowledge=True,
            instructions=["Find and cite external legal context relevant to the evidence and contract."],
            markdown=True
        )

        contract_analyst = Agent(
            name="Contract Analyst",
            role="Contract analysis specialist, compares evidence against contract clauses.",
            model=ollama_llm,
            knowledge=knowledge_base,
            search_knowledge=True,
            instructions=["Thoroughly review the contract text, identify key terms, and reference specific clauses in relation to the evidence."],
            markdown=True
        )

        legal_strategist = Agent(
            name="Legal Strategist", 
            role="Legal strategy specialist, determines the final verdict and necessary financial actions.",
            model=ollama_llm,
            knowledge=knowledge_base,
            search_knowledge=True,
            instructions=["Based on Analyst and Researcher input, develop a final verdict (PARTY_A_WINS/B_WINS/DRAW) and determine the reimbursement amount. Output the final decision ONLY in the required JSON structure."],
            markdown=True
        )

        # Team Lead (Focuses on JSON output structure)
        legal_team_lead = Agent(
            name="Legal Team Lead",
            role="Legal team coordinator and final decision maker.",
            model=ollama_llm,
            team=[legal_researcher, contract_analyst, legal_strategist],
            knowledge=knowledge_base,
            search_knowledge=True,
            instructions=[
                "Coordinate analysis.",
                "Provide the final comprehensive response.",
                "The FINAL output MUST be a single JSON object matching the required ArbitrationOutput structure, including the reimbursement amount."
            ],
            markdown=False # חשוב: Markdown False כדי לקבל JSON נקי
        )
        return legal_team_lead
    
    except Exception as e:
        raise Exception(f"Failed to initialize Ollama Agents: {e}")


@app.post("/arbitrate", response_model=ArbitrationOutput)
async def run_arbitration(data: ArbitrationInput):
    """
    HTTP Endpoint לקריאת בוררות.
    משתמש בטקסט קלט ליצירת KnowledgeBase זמני.
    """
    
    # 1. יצירת Knowledge Base זמני מתוך הטקסט (מחליף את קריאת PDF)
    try:
        ollama_embedder = OllamaEmbedder(model=EMBEDDER_MODEL, base_url=OLLAMA_BASE_URL)
        
        # מכיל את הטקסט של החוזה והראיות
        full_document_text = f"CONTRACT: {data.contract_text}\n\nEVIDENCE: {data.evidence_text}"
        
        # יצירת Knowledge Base מתוך הטקסט בזיכרון (InMemory, ללא צורך ב-Qdrant חיצוני)
        knowledge_base = InMemoryKnowledgeBase(
            content=full_document_text,
            embedder=ollama_embedder,
            chunk_size=512, # חלוקה לגודל צ'אנק סביר
        )
        knowledge_base.load()
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process knowledge base: {str(e)}")


    # 2. אתחול הצוות והרצתו
    try:
        legal_team = initialize_legal_team(knowledge_base)
        
        # הפרומפט הסופי ל-Team Lead
        final_query = f"""
        Dispute Query: {data.dispute_question}
        
        Instructions to Team Lead: Analyze the CONTRACT and EVIDENCE based on the query. 
        Your FINAL output must be a single JSON object representing the ArbitrationOutput model.
        """

        # הרצת הצוות
        response = legal_team.run(final_query)
        
        # 3. ניתוח ואימות הפלט
        # הפלט של legal_team.run() הוא אובייקט, נניח שהוא מכיל את ה-JSON string
        if not response.content:
             raise Exception("AI did not return content.")

        # ניקוי המחרוזת והמרה ל-JSON (מודלי AI אוהבים להוסיף ```json)
        json_string = response.content.strip().replace("```json", "").replace("```", "")
        final_verdict = json.loads(json_string) 

        # 4. ודא שהנתונים תואמים למבנה הפלט
        parsed_output = ArbitrationOutput(**final_verdict)
        return parsed_output

    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail=f"AI output was not valid JSON: {response.content[:200]}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")
    
# --- הוראות להפעלה (Ollama חייב להיות מופעל) ---
# 1. הורידו את המודלים: ollama run llama3.1:8b; ollama run openhermes
# 2. התקינו תלויות: pip install fastapi uvicorn agno[ollama] pydantic
# 3. הריצו: uvicorn arbitrator_api:app --host 0.0.0.0 --port 8000

```
5.2. Chainlink Functions (JavaScript) - chainlink_caller.js (דורש התאמה)


```

// Chainlink Function - JavaScript
// קורא ל-AI Arbitrator API (FastAPI) ומחלץ את סכום הקנס.

// כתובת ה-API הציבורית של שרת FastAPI
const ARBITRATOR_API_URL = "https://YOUR_PUBLIC_API_DOMAIN/arbitrate"; 

// 1. קבלת נתונים מה-Smart Contract (דרך מערך args)
// args[0]: contract_text (טקסט החוזה)
// args[1]: evidence_text (טקסט הראיות)
// args[2]: dispute_question (השאילתה)

if (args.length !== 3) {
    throw Error("Please provide contract_text, evidence_text, and dispute_question in the arguments array.");
}

const contractText = args[0];
const evidenceText = args[1];
const disputeQuestion = args[2];

// 2. בניית ה-Payload לבקשת POST
const payload = {
    contract_text: contractText,
    evidence_text: evidenceText,
    dispute_question: disputeQuestion
};

// 3. הגדרת הבקשה
const request = Functions.make</fetch>(ARBITRATOR_API_URL, {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        // אופציונלי: הוספת API Key לאבטחת ה-FastAPI Endpoint
    },
    body: JSON.stringify(payload)
});

// 4. ביצוע הקריאה
const response = await request;

if (response.error) {
    // זורק שגיאה אם ה-API נכשל (למשל, 403, 500)
    throw Error(`AI Arbitration API Error: ${response.error.message}`);
}

// 5. ניתוח הפלט
const responseJson = await response.json();

// 6. חילוץ סכום ההכרעה (הוא חייב להיות int)
const amount = responseJson.reimbursement_amount_dai;

if (typeof amount !== 'number' || amount < 0) {
    throw Error(`Invalid or non-numeric reimbursement amount returned: ${amount}`);
}

// 7. המרה לפורמט הנדרש של Solidity (uint256) והחזרה
return Functions.encodeUint256(amount);

```

שימו לב: קובץ זה הוא הבסיס שסופק על ידי המשתמש. הוא דורש התאמה דחופה לטפל ב-
Timeout
 ובדיוק פיננסי כפי שנדרש ב-
Mitigation 4.5
 ו-
4.4
 (ראו סעיף 5.3).

5.3. דרישת התאמה קריטית ל-Chainlink JS (Action Item)
דרישה מפורשת לקופיילוט:
על הקוד ב**chainlink_caller.js** להיות מותאם לסטנדרט האבטחה והעמידות של 
V7
 (כפי שמומש בקובץ chainlink_arbitrator.js המקורי שנוצר על ידי קופיילוט). יש לבצע את ההתאמות הבאות:

הטמעת טיפול בכשלים (Mitigation 4.5): להחליף את כל קריאות ה-
throw Error
 בבלוק 
try/catch
 ולהחזיר את FAILURE_CODE (
MAX_UINT256−1
) במקרה של כשל 
HTTP
 או 
JSON
 לא תקין.

דיוק פיננסי (Mitigation 4.4): להטמיע את לוגיקת ההמרה ל-
Wei
 באמצעות BigInt (כולל עיגול לסנטים), כדי להבטיח דיוק פיננסי מלא.

עדכון Endpoint: החלפת ה-
Placeholder
 
https://YOUR_PUBLIC_API_DOMAIN/arbitrate
 בכתובת סופית לאחר פריסת שרת ה-
FastAPI
 (בסביבת פיתוח, לרוב תהיה זו כתובת פנימית כמו 
[http://host.docker.internal:8000](http://host.docker.internal:8000)
).

אנא אמץ את קטעי הקוד שסופקו וודא כי ההתאמות ל-
ENDPOINT
 ולוגיקת הטיפול בכשלים מתבצעות על בסיס קובץ ה-JavaScript שבסעיף 5.2, כפי שנדרש בסעיף 5.3.

## 6. כלי פיתוח V7 (Development Tools)

הכלים המעודכנים של V7 נמצאים בתיקייה `tools/` (הכלים הישנים הועברו ל-`tools/legacy/`):

### 6.1. ממומש ומוכן לשימוש
- **`arbitrator_api.py`** - שרת FastAPI המושלם כפי שמוגדר בסעיף 5.1
- **`chainlink_arbitrator.js`** - קוד Chainlink Functions המותאם עם כל ה-Mitigations
- **`test_arbitrator.py`** - סקריפט בדיקה לבדיקת ה-API מקומית
- **`docker-compose.yml`** - הפעלה מקומית של Ollama + FastAPI
- **`requirements.txt`** - תלויות Python נדרשות

### 6.2. הוראות הפעלה מקומית

```bash
# 1. הפעלת Ollama + API בDocker
cd tools/
docker-compose up -d

# 2. בדיקת המערכת (אחרי הורדת המודלים)
python test_arbitrator.py

# 3. גישה לAPI docs
# http://localhost:8000/docs
```

### 6.3. ניקוי מלוגיקת העבר

כל הכלים מגרסאות קודמות (ECIES ידני, evidence endpoints, admin decrypt) הועברו ל-`tools/legacy/` ואינם נדרשים יותר ב-V7. הארכיטקטורה החדשה פשוטה ובטוחה יותר.