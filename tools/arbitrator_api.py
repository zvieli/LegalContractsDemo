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