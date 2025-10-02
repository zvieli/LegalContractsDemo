#!/usr/bin/env python3
"""
ArbiTrust V7 AI Arbitrator API
FastAPI server with Ollama LLM integration for automated legal decision making

This service receives arbitration requests from Chainlink Functions and returns
structured legal decisions using local LLM models.
"""

import os
import json
import asyncio
from typing import Dict, Any, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import httpx

# Configuration
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:latest")
API_PORT = int(os.getenv("API_PORT", "8000"))

app = FastAPI(title="ArbiTrust V7 AI Arbitrator", version="7.0.0")

class ArbitrationRequest(BaseModel):
    contract_address: str
    case_id: int
    dispute_type: str
    evidence_hash: str
    requested_amount: int  # in wei
    reporter: str
    respondent: str
    context: Optional[Dict[str, Any]] = None

class ArbitrationResponse(BaseModel):
    approve: bool
    applied_amount: int  # in wei
    beneficiary: str
    classification: str
    rationale: str
    confidence: float

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "version": "7.0.0"}

@app.post("/arbitrate", response_model=ArbitrationResponse)
async def arbitrate_dispute(request: ArbitrationRequest) -> ArbitrationResponse:
    """
    Main arbitration endpoint - processes dispute and returns AI decision
    """
    try:
        # Construct prompt for LLM
        prompt = _build_arbitration_prompt(request)
        
        # Query Ollama LLM
        llm_response = await _query_ollama(prompt)
        
        # Parse and validate response
        decision = _parse_llm_response(llm_response, request)
        
        return decision
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Arbitration failed: {str(e)}")

def _build_arbitration_prompt(request: ArbitrationRequest) -> str:
    """Build structured prompt for legal arbitration"""
    
    prompt = f"""
You are an AI arbitrator for blockchain-based legal disputes. Analyze the following case:

CONTRACT: {request.contract_address}
CASE ID: {request.case_id}
DISPUTE TYPE: {request.dispute_type}
EVIDENCE HASH: {request.evidence_hash}
REQUESTED AMOUNT: {request.requested_amount} wei ({request.requested_amount / 1e18:.6f} ETH)
REPORTER: {request.reporter}
RESPONDENT: {request.respondent}

INSTRUCTIONS:
1. Analyze the dispute based on standard legal principles
2. Consider evidence authenticity (cryptographic hash: {request.evidence_hash})
3. Determine if the claim should be approved or rejected
4. If approved, specify the exact amount to award (up to requested amount)
5. Identify the beneficiary (reporter or respondent)
6. Classify the dispute type (Damage, Breach, Payment, etc.)
7. Provide clear rationale for your decision

RESPONSE FORMAT (JSON only):
{{
    "approve": true/false,
    "applied_amount": <amount_in_wei>,
    "beneficiary": "<ethereum_address>",
    "classification": "<dispute_category>",
    "rationale": "<detailed_explanation>",
    "confidence": <0.0_to_1.0>
}}

Provide only the JSON response, no additional text.
"""
    
    return prompt.strip()

async def _query_ollama(prompt: str) -> str:
    """Query Ollama LLM with the arbitration prompt"""
    
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.1,  # Low temperature for consistent legal decisions
            "top_p": 0.9,
            "repeat_penalty": 1.1
        }
    }
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json=payload
            )
            response.raise_for_status()
            
            result = response.json()
            return result.get("response", "").strip()
            
        except httpx.RequestError as e:
            raise Exception(f"Ollama request failed: {e}")
        except httpx.HTTPStatusError as e:
            raise Exception(f"Ollama HTTP error: {e.response.status_code}")

def _parse_llm_response(llm_response: str, request: ArbitrationRequest) -> ArbitrationResponse:
    """Parse and validate LLM response into structured decision"""
    
    try:
        # Extract JSON from response (handle potential extra text)
        json_start = llm_response.find('{')
        json_end = llm_response.rfind('}') + 1
        
        if json_start == -1 or json_end == 0:
            raise ValueError("No JSON found in LLM response")
            
        json_str = llm_response[json_start:json_end]
        decision = json.loads(json_str)
        
        # Validate required fields
        required_fields = ["approve", "applied_amount", "beneficiary", "classification", "rationale", "confidence"]
        for field in required_fields:
            if field not in decision:
                raise ValueError(f"Missing required field: {field}")
        
        # Validate amount constraints
        applied_amount = int(decision["applied_amount"])
        if applied_amount < 0:
            applied_amount = 0
        elif applied_amount > request.requested_amount:
            applied_amount = request.requested_amount
            
        # Validate beneficiary address
        beneficiary = decision["beneficiary"].lower()
        if beneficiary not in [request.reporter.lower(), request.respondent.lower()]:
            # Default to reporter if invalid beneficiary
            beneficiary = request.reporter
            
        # Ensure confidence is within bounds
        confidence = float(decision["confidence"])
        confidence = max(0.0, min(1.0, confidence))
        
        return ArbitrationResponse(
            approve=bool(decision["approve"]),
            applied_amount=applied_amount,
            beneficiary=beneficiary,
            classification=str(decision["classification"]),
            rationale=str(decision["rationale"]),
            confidence=confidence
        )
        
    except (json.JSONDecodeError, ValueError, KeyError) as e:
        # Fallback decision if parsing fails
        return ArbitrationResponse(
            approve=False,
            applied_amount=0,
            beneficiary=request.respondent,
            classification="Processing Error",
            rationale=f"Failed to parse LLM response: {str(e)}",
            confidence=0.0
        )

if __name__ == "__main__":
    import uvicorn
    
    print(f"🚀 Starting ArbiTrust V7 AI Arbitrator")
    print(f"📡 Ollama URL: {OLLAMA_BASE_URL}")
    print(f"🤖 Model: {OLLAMA_MODEL}")
    print(f"🌐 Port: {API_PORT}")
    
    uvicorn.run(
        "arbitrator_api:app",
        host="0.0.0.0",
        port=API_PORT,
        reload=True
    )