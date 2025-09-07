import { expect } from "chai";
import { fileURLToPath, pathToFileURL } from "url";
import path from "path";

// Direct invocation test of Worker fetch handler (no wrangler spawn) for deterministic coverage.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("AI Worker Arbitration Endpoint (direct module invocation)", function () {
  it("produces expected roadmap classification & penalty", async () => {
  const workerModPath = path.join(__dirname, "..", "server", "src", "index.js");
  const worker = await import(pathToFileURL(workerModPath).href);
    const requestedPenaltyWei = BigInt("400000000000000000");
    const evidenceText = "Roadmap milestone timeline releasePlan";
    const expectedFactor = 93; // base 80 + bump(roadmap=5) + category weight(roadmap=8)
    const expectedPenaltyWei = (requestedPenaltyWei * BigInt(expectedFactor)) / 100n;

    const body = {
      reporter: "0x1111111111111111111111111111111111111111",
      offender: "0x2222222222222222222222222222222222222222",
      requestedPenaltyWei: requestedPenaltyWei.toString(),
      evidenceText,
      evidenceHash: evidenceText.toLowerCase().replace(/\s+/g,'-')
    };

    const req = new Request('https://example.test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const resp = await worker.default.fetch(req, {});
    expect(resp.status).to.equal(200);
    const json = await resp.json();
    for (const k of ["approve","penaltyWei","beneficiary","guilty","classification","rationale"]) {
      expect(json).to.have.property(k);
    }
    expect(json.classification).to.equal('roadmap');
    expect(json.penaltyWei).to.equal(expectedPenaltyWei.toString());
    expect(json.approve).to.equal(true);
    expect(json.rationale).to.include('cat=roadmap');
  });
});
