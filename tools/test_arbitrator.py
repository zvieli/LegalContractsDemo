#!/usr/bin/env python3
"""
V7 AI Arbitrator API Test Script
Tests the arbitrator API with sample data
"""

import json
import requests
import time

# Configuration
API_URL = "http://localhost:8000/arbitrate"
TIMEOUT = 30

# Sample test data
SAMPLE_CONTRACT = """
RENTAL AGREEMENT

Property: 123 Main Street, Apartment 2B
Landlord: Alice Johnson  
Tenant: Bob Smith
Monthly Rent: $1,200 USD
Security Deposit: $2,400 USD
Lease Term: 12 months (Jan 1, 2024 - Dec 31, 2024)

TERMS:
1. Rent is due on the 1st of each month
2. Late fees: $50 for payments after the 5th
3. No pets allowed without written permission
4. Tenant responsible for utilities except water/sewer
5. 30-day notice required for lease termination
"""

SAMPLE_EVIDENCE = """
DISPUTE EVIDENCE SUBMITTED:

From Tenant (Bob Smith):
- Email dated March 3rd showing rent payment attempt failed due to landlord's bank error
- Bank statement showing $1,200 was debited from tenant's account on March 1st
- Photos of water damage in bathroom from leaky pipes (landlord's responsibility)

From Landlord (Alice Johnson):  
- Notice dated March 6th claiming rent is late and demanding $50 late fee
- Photos showing apartment in good condition (taken Feb 15th, before water damage)
- Bank statement showing no rent payment received for March

DISPUTE: Landlord claims tenant owes $50 late fee for March rent payment
"""

SAMPLE_QUESTION = "Is the tenant liable for the $50 late fee given the evidence of bank processing failure and the landlord's bank error?"

def test_arbitrator_api():
    """Test the AI arbitrator API"""
    
    print("🤖 Testing V7 AI Arbitrator API...")
    print(f"API URL: {API_URL}")
    
    payload = {
        "contract_text": SAMPLE_CONTRACT,
        "evidence_text": SAMPLE_EVIDENCE,
        "dispute_question": SAMPLE_QUESTION
    }
    
    try:
        print("\n📤 Sending arbitration request...")
        start_time = time.time()
        
        response = requests.post(
            API_URL,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=TIMEOUT
        )
        
        elapsed_time = time.time() - start_time
        print(f"⏱️  Response time: {elapsed_time:.2f} seconds")
        
        if response.status_code == 200:
            result = response.json()
            print("\n✅ Arbitration completed successfully!")
            print(f"📋 Verdict: {result['final_verdict']}")
            print(f"💰 Reimbursement: ${result['reimbursement_amount_dai']} DAI")
            print(f"📝 Rationale: {result['rationale_summary']}")
            return True
        else:
            print(f"\n❌ API Error: {response.status_code}")
            print(f"Response: {response.text}")
            return False
            
    except requests.exceptions.Timeout:
        print(f"\n⏰ Request timed out after {TIMEOUT} seconds")
        return False
    except requests.exceptions.ConnectionError:
        print(f"\n🔌 Connection failed - is the API server running?")
        print("Start server with: uvicorn arbitrator_api:app --host 0.0.0.0 --port 8000")
        return False
    except Exception as e:
        print(f"\n💥 Unexpected error: {e}")
        return False

def check_dependencies():
    """Check if required services are available"""
    print("🔍 Checking dependencies...")
    
    # Check Ollama
    try:
        ollama_response = requests.get("http://localhost:11434/api/tags", timeout=5)
        if ollama_response.status_code == 200:
            models = ollama_response.json().get("models", [])
            model_names = [m["name"] for m in models]
            print(f"✅ Ollama running with models: {model_names}")
        else:
            print("⚠️  Ollama service check failed")
    except:
        print("❌ Ollama not accessible - run: ollama run llama3.1:8b")
    
    # Check API server
    try:
        health_response = requests.get("http://localhost:8000/docs", timeout=5)
        if health_response.status_code == 200:
            print("✅ FastAPI server is running")
        else:
            print("⚠️  FastAPI server check failed")
    except:
        print("❌ FastAPI server not accessible")

if __name__ == "__main__":
    print("🧑‍⚖️ V7 AI Arbitrator Test Suite")
    print("=" * 50)
    
    check_dependencies()
    print("\n" + "=" * 50)
    
    success = test_arbitrator_api()
    
    print("\n" + "=" * 50)
    if success:
        print("🎉 Test completed successfully!")
    else:
        print("😞 Test failed - check the logs above")