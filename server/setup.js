#!/usr/bin/env node

/**
 * V7 Backend Setup and Initialization Script
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 ArbiTrust V7 Backend Setup\n');

// Create necessary directories
const directories = [
  'logs',
  'test',
  'modules', 
  'config',
  'uploads'
];

console.log('📁 Creating directories...');
directories.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`  ✅ Created: ${dir}/`);
  } else {
    console.log(`  ℹ️  Exists: ${dir}/`);
  }
});

// Copy environment template if .env doesn't exist
const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, '.env.example');

console.log('\n🔧 Environment configuration...');
if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
  fs.copyFileSync(envExamplePath, envPath);
  console.log('  ✅ Created .env from template');
  console.log('  ⚠️  Please review and update .env with your settings');
} else if (fs.existsSync(envPath)) {
  console.log('  ℹ️  .env already exists');
} else {
  console.log('  ❌ .env.example not found');
}

// Create startup script
const startupScript = `#!/bin/bash

# ArbiTrust V7 Backend Startup Script

echo "🚀 Starting ArbiTrust V7 Backend..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ and try again."
    exit 1
fi

# Check if Python FastAPI is running (for LLM)
echo "🔍 Checking LLM Arbitrator API..."
if curl -s http://localhost:8000/api/v7/arbitration/health > /dev/null; then
    echo "✅ LLM Arbitrator API is running"
else
    echo "⚠️  LLM Arbitrator API not running at http://localhost:8000"
    echo "   Start it with: cd ../tools && python arbitrator_api.py"
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Run tests
echo "🧪 Running quick tests..."
npm run test:evidence
npm run test:time

# Start the server
echo "🌟 Starting V7 Backend Server..."
npm start
`;

fs.writeFileSync(path.join(__dirname, 'start.sh'), startupScript);
fs.chmodSync(path.join(__dirname, 'start.sh'), '755');
console.log('  ✅ Created startup script: start.sh');

// Create README
const readme = `# ArbiTrust V7 Backend

## Overview

The V7 Backend provides enhanced evidence management, LLM arbitration integration, and time-based contract management for the ArbiTrust platform.

## Key Features

- **Evidence Validation**: IPFS/Helia-based evidence validation with CID support
- **LLM Arbitration**: Integration with Python FastAPI LLM service
- **Time Management**: Late fee calculation and payment scheduling
- **API Endpoints**: RESTful API for frontend integration

## Quick Start

1. **Setup Environment**:
   \`\`\`bash
   cp .env.example .env
   # Edit .env with your configuration
   \`\`\`

2. **Install Dependencies**:
   \`\`\`bash
   npm install
   \`\`\`

3. **Start LLM Service** (in separate terminal):
   \`\`\`bash
   cd ../tools
   python arbitrator_api.py
   \`\`\`

4. **Start Backend**:
   \`\`\`bash
   npm start
   # or: ./start.sh
   \`\`\`

## API Endpoints

### Evidence Management
- \`POST /api/v7/dispute/report\` - Report dispute with evidence CID
- \`POST /api/v7/dispute/appeal\` - Submit appeal with evidence CID
- \`GET /api/v7/debug/evidence/:cid\` - Validate evidence CID

### Time Management  
- \`POST /api/v7/rent/calculate-payment\` - Calculate payment with late fees
- \`GET /api/v7/debug/time/:timestamp\` - Get time-based data

### LLM Integration
- \`POST /api/v7/llm/callback\` - Handle LLM arbitration responses

### System
-- \`GET /api/v7/arbitration/health\` - Health check

## Testing

\`\`\`bash
# Run all tests
npm test

# Run specific test modules
npm run test:evidence
npm run test:llm  
npm run test:time
\`\`\`

## Development

\`\`\`bash
# Start in development mode with auto-reload
npm run dev
\`\`\`

## Architecture

\`\`\`
server/
├── index.js              # Main server file
├── modules/
│   ├── evidenceValidator.js    # IPFS evidence validation
│   ├── llmArbitration.js       # LLM arbitration logic
│   ├── timeManagement.js       # Time and fee calculations
│   └── arbitratorAPI.js        # LLM API integration
├── test/                # Test modules
└── config/              # Configuration files
\`\`\`

## Configuration

Key environment variables:

- \`ARBITRATOR_API_URL\`: LLM API endpoint (default: http://localhost:8000)
- \`PORT\`: Server port (default: 3001)
- \`RPC_URL\`: Blockchain RPC endpoint
- \`CHAINLINK_SIMULATION\`: Enable simulation mode for development

## Integration with Frontend

The backend provides APIs consumed by the V7 frontend:

- TimeCountdown component uses \`/api/v7/rent/calculate-payment\`
- AppealFlow component uses \`/api/v7/dispute/appeal\`
- Evidence validation uses \`/api/v7/debug/evidence/:cid\`

## Production Deployment

1. Set \`NODE_ENV=production\` in .env
2. Configure proper RPC endpoints
3. Set up LLM service with production URLs
4. Use process manager (PM2) for server management

\`\`\`bash
# Using PM2
npm install -g pm2
pm2 start index.js --name "arbitrust-v7"
\`\`\`

## Troubleshooting

- **LLM API not responding**: Check if FastAPI service is running on port 8000
- **Evidence validation fails**: Verify IPFS gateway accessibility
- **Time calculations incorrect**: Check system timezone and NTP sync

## Support

See main project documentation at \`../docs/\` for additional information.
`;

fs.writeFileSync(path.join(__dirname, 'README.md'), readme);
console.log('  ✅ Created README.md');

// Create gitignore
const gitignore = `# Dependencies
node_modules/
npm-debug.log*

# Environment
.env
.env.local
.env.production

# Logs
logs/
*.log

# Runtime data
pids/
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/

# Uploads
uploads/

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db

# Build outputs
dist/
build/
`;

fs.writeFileSync(path.join(__dirname, '.gitignore'), gitignore);
console.log('  ✅ Created .gitignore');

console.log('\n✅ V7 Backend setup complete!');
console.log('\nNext steps:');
console.log('1. Review and update .env configuration');
console.log('2. Install dependencies: npm install');
console.log('3. Start LLM service: cd ../tools && python arbitrator_api.py');
console.log('4. Start backend: npm start or ./start.sh');
console.log('5. Test endpoints: curl http://localhost:3001/api/v7/arbitration/health');