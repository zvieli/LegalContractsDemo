# Tools Directory - V7 AI Arbitration

This directory contains the V7 implementation tools for the AI-powered arbitration system.

## V7 Architecture Components

### 1. AI Arbitrator API (`arbitrator_api.py`)
- **Purpose**: FastAPI server that provides AI-powered legal arbitration
- **Technology**: Python + Ollama (free local LLM) + Agno framework
- **Models**: llama3.1:8b (main analysis) + openhermes (embeddings)
- **Features**: 
  - Multi-agent legal team (Researcher, Analyst, Strategist, Team Lead)
  - In-memory knowledge base from contract/evidence text
  - Structured JSON output for smart contracts

**Setup**:
```bash
# Install Ollama and models
ollama run llama3.1:8b
ollama run openhermes

# Install Python dependencies  
pip install fastapi uvicorn agno[ollama] pydantic

# Run the API server
uvicorn arbitrator_api:app --host 0.0.0.0 --port 8000
```

### 2. Chainlink Functions JavaScript (`chainlink_arbitrator.js`)
- **Purpose**: Chainlink Functions script that calls the AI Arbitrator API
- **Technology**: JavaScript (runs in Chainlink DON environment)
- **Security Features**:
  - Failure code return (MAX_UINT256-1)

**Key Security Mitigations**:
- **4.4 (Financial Precision)**: BigInt conversion with proper rounding
- **4.5 (Error Resilience)**: Comprehensive error handling with FAILURE_CODE
- **4.6 (Memory Security)**: Explicit cleanup of sensitive variables

# Tools Directory - V7 AI Arbitration

This directory contains the V7 implementation tools for the AI-powered arbitration system.

## V7 Architecture Components (New)

### 1. AI Arbitrator API (`arbitrator_api.py`) ⭐ NEW
- **Purpose**: FastAPI server that provides AI-powered legal arbitration
- **Technology**: Python + Ollama (free local LLM) + Agno framework
- **Models**: llama3.1:8b (main analysis) + openhermes (embeddings)
- **Features**: 

**Setup**:
```bash
# Install Ollama and models
ollama run llama3.1:8b
ollama run openhermes

# Run the API server
## V7 Tools Directory

כל הכלים הישנים הועברו ל-tools/legacy/.
השתמשו רק בקבצים הבאים עבור מערכת V7:

- arbitrator_api.py
- chainlink_arbitrator.js
- evidence-endpoint-v7.js
- test_arbitrator.py
- docker-compose.yml
- requirements.txt

## כל קובץ ישן בתיקיית legacy אינו נתמך יותר!
uvicorn arbitrator_api:app --host 0.0.0.0 --port 8000

### 2. Chainlink Functions JavaScript (`chainlink_arbitrator.js`) ⭐ NEW
- **Purpose**: Chainlink Functions script that calls the AI Arbitrator API
  - JSON validation and error recovery
  - Financial precision (DAI to Wei conversion)
  - Memory cleanup (sensitive data removal)
  - Failure code return (MAX_UINT256-1)

**Key Security Mitigations**:
- **4.4 (Financial Precision)**: BigInt conversion with proper rounding
- **4.5 (Error Resilience)**: Comprehensive error handling with FAILURE_CODE
- **4.6 (Memory Security)**: Explicit cleanup of sensitive variables

### 3. Docker Development Stack ⭐ NEW
```bash
# Start full development environment
npm run arbitrator-docker

# Or manually
cd tools/
docker-compose up -d
```

## Legacy Components (Compatibility)

### ⚠️ Deprecated Evidence Endpoint (`evidence-endpoint.js`)
- **Status**: Deprecated, kept for test compatibility only
- **Purpose**: Old evidence processing server (pre-V7)
- **Migration**: Use `arbitrator_api.py` for new development
- **Usage**: `npm run evidence-server` (for legacy tests only)

### ⚠️ Admin Tools (`admin/`)
- **Status**: Minimal compatibility files only
- **Purpose**: Support legacy decrypt tests
- **Migration**: Not needed in V7 (Chainlink handles security)

## Development Workflows

### V7 Development (Recommended):
```bash
# 1. Start AI arbitration stack
npm run arbitrator-docker

# 2. Test V7 core functionality  
npx hardhat test test/NDA.test.js

# 3. Test AI API directly
cd tools && python test_arbitrator.py

# 4. Deploy with V7 arbitration
npx hardhat run scripts/deploy.js
```

### Legacy Support (Testing only):
```bash
# For compatibility with older tests
npm run evidence-server
npx hardhat test test/evidence.e2e.test.js
```

## V7 Data Flow
3. **AI Processing**: JavaScript calls `arbitrator_api.py` with HTTP request
4. **Legal Analysis**: Multi-agent AI team analyzes contract vs evidence
## API Contract

### Input (to arbitrator_api.py):
  "dispute_question": "Specific arbitration query..."
}
```
  "reimbursement_amount_dai": 150,
  "rationale_summary": "Legal reasoning summary..."
}
```

## Development vs Production

### Development:
- API URL: `http://host.docker.internal:8000/arbitrate`
- Local Ollama models
- Test mode in ArbitrationContractV2

### Production:
- API URL: Replace with public FastAPI endpoint
- Hosted Ollama or cloud LLM service
- Real Chainlink Functions subscription & DON ID
- Production router addresses

## Key Dependencies

- **Smart Contracts**: ArbitrationContractV2.sol (Chainlink Functions client)
- **Backend**: Python 3.8+, FastAPI, Ollama, Agno framework
- **Blockchain**: Chainlink Functions, hardhat for testing
- **Frontend**: React app consumes contract ABIs

## Security Notes

- All sensitive data (contract text, evidence) is processed in-memory only
- No persistent storage of arbitration data
- Chainlink Functions provides secure off-chain computation
- Financial precision guaranteed through BigInt arithmetic
- Error resilience with comprehensive fallback handling