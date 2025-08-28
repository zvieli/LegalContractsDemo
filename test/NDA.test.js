import pkg from "hardhat";
const { ethers } = pkg;
import { expect } from "chai";

// עוזר לחתימה EIP-712
async function signNDA(signer, contractAddress, expiryDate, penaltyBps, customClausesHash) {
  const network = await ethers.provider.getNetwork();
  const domain = {
    name: "NDATemplate",
    version: "1",
    chainId: Number(network.chainId),
    verifyingContract: contractAddress
  };

  const types = {
    NDA: [
      { name: "contractAddress", type: "address" },
      { name: "expiryDate", type: "uint256" },
      { name: "penaltyBps", type: "uint16" },
      { name: "customClausesHash", type: "bytes32" }
    ]
  };

  const value = { contractAddress, expiryDate, penaltyBps, customClausesHash };

  const msgParams = JSON.stringify({
    domain,
    message: value,
    primaryType: "NDA",
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      NDA: types.NDA
    }
  });

  return await signer.provider.send("eth_signTypedData_v4", [
    await signer.getAddress(),
    msgParams
  ]);
}

describe("NDATemplate", function () {
  let deployer, partyA, partyB, third, arbitrator;
  let nda, ndaWithArb;
  const clauseText = "If tenant leaks confidential info, penalty applies.";
  const clauseHash = ethers.keccak256(ethers.toUtf8Bytes(clauseText));

  beforeEach(async function () {
    [deployer, partyA, partyB, third, arbitrator] = await ethers.getSigners();

    const NDATemplatePro = await ethers.getContractFactory("NDATemplate");
    const expiry = Math.floor(Date.now() / 1000) + 24 * 3600;

    nda = await NDATemplatePro.deploy(
      await partyA.getAddress(),
      await partyB.getAddress(),
      expiry,
      1000,
      clauseHash,
      ethers.ZeroAddress,
      ethers.parseEther("0.1")
    );
    await nda.waitForDeployment();

    const expiry2 = Math.floor(Date.now() / 1000) + 24 * 3600;
    ndaWithArb = await NDATemplatePro.deploy(
      await partyA.getAddress(),
      await partyB.getAddress(),
      expiry2,
      1000,
      clauseHash,
      await arbitrator.getAddress(),
      ethers.parseEther("0.05")
    );
    await ndaWithArb.waitForDeployment();
  });

  it("should allow parties to sign via EIP712 and become fully signed", async function () {
    const contractAddress = await nda.getAddress();
    // הכן חתימות
    const expiryOnContract = Number((await nda.expiryDate())); // BigInt -> Number
    const penaltyBps = Number((await nda.penaltyBps()));

    const sigA = await signNDA(partyA, contractAddress, expiryOnContract, penaltyBps, clauseHash);
    const sigB = await signNDA(partyB, contractAddress, expiryOnContract, penaltyBps, clauseHash);

    // חתימה על ידי צד א' (מגיש החתימה יכול להיות כל אחד)
    await nda.connect(third).signNDA(sigA);
    expect(await nda.signedBy(await partyA.getAddress())).to.equal(true);
    expect(await nda.isFullySigned()).to.equal(false);

    // חתימה על ידי צד ב'
    await nda.connect(third).signNDA(sigB);
    expect(await nda.signedBy(await partyB.getAddress())).to.equal(true);
    expect(await nda.isFullySigned()).to.equal(true);
  });

  it("should accept deposits and allow reporting/voting flow (no arbitrator) and pay reporter from offender deposit", async function () {
    const minDep = await nda.minDeposit();
    // הפקדות לשני הצדדים
    await nda.connect(partyA).deposit({ value: ethers.parseEther("1") });
    await nda.connect(partyB).deposit({ value: ethers.parseEther("1") });

    expect(await nda.deposits(await partyA.getAddress())).to.equal(ethers.parseEther("1"));
    expect(await nda.deposits(await partyB.getAddress())).to.equal(ethers.parseEther("1"));

    // partyA מדווח על partyB
    const requested = ethers.parseEther("0.4");
    const caseId = await nda.connect(partyA).reportBreach(
      await partyB.getAddress(),
      requested,
      clauseHash
    ).then(tx => tx.wait()).then(r => {
      // נחפש את האירוע BreachReported והחזר את caseId מה־logs לא ניתן ישירות; קריאה ל-getCasesCount
      return;
    });

    const countBefore = await nda.getCasesCount();
    expect(countBefore).to.equal(1);

    // קבלת פרטי התיק
    const caseInfo = await nda.getCase(0);
    expect(caseInfo.reporter).to.equal(await partyA.getAddress());
    expect(caseInfo.offender).to.equal(await partyB.getAddress());
    expect(caseInfo.requestedPenalty).to.equal(requested);

    // הצבעת רוב: מכיוון שיש 2 צדדים בלבד, המואשם לא יצביע, המצביעים = 1 -> הצבעה אחת מאשרת תחזיר החלטה
    await nda.connect(partyA).voteOnBreach(0, true);

    // אחרי הצבעת רוב, התיק אמור להיות פתור ואושר
    const caseAfter = await nda.getCase(0);
    expect(caseAfter.resolved).to.equal(true);
    expect(caseAfter.approved).to.equal(true);

    // בוצע תשלום מהפקדון של המואשם (partyB) אל המדווח (partyA)
    // deposits[partyB] הופחתה ב-requested (או עד לפקדון)
    const depB = await nda.deposits(await partyB.getAddress());
    expect(depB).to.equal(ethers.parseEther("1") - requested);

    // reporter (partyA) קיבל את הפיצוי - לא בודקים balance chain-wide אבל אפשר לוודא שפונקציה _applyResolution רצה ע״י האירוע
    const casesCount = await nda.getCasesCount();
    expect(casesCount).to.equal(1);
  });

  it("should allow arbitrator to resolve a reported breach and apply penalty", async function () {
    // שימוש בחוזה עם בורר
    const nd = ndaWithArb;
    // הפקדון אצל offender (partyB)
    await nd.connect(partyB).deposit({ value: ethers.parseEther("0.5") });
    await nd.connect(partyA).deposit({ value: ethers.parseEther("0.5") });

    const requested = ethers.parseEther("0.3");
    await nd.connect(partyA).reportBreach(await partyB.getAddress(), requested, clauseHash);

    // עכשיו המגן/בורר מחליט
    await nd.connect(arbitrator).resolveByArbitrator(0, true);

    const c = await nd.getCase(0);
    expect(c.resolved).to.equal(true);
    expect(c.approved).to.equal(true);

    // deposits[partyB] הופחתה ב-requested או עד לגובהה
    const remaining = await nd.deposits(await partyB.getAddress());
    expect(remaining).to.equal(ethers.parseEther("0.5") - requested);
  });

  it("should allow withdraw after deactivate and all cases resolved", async function () {
    // הפקדות
    await nda.connect(partyA).deposit({ value: ethers.parseEther("0.2") });
    await nda.connect(partyB).deposit({ value: ethers.parseEther("0.2") });

    // דיווח על הפרה וסיום על ידי הצבעת רוב
    await nda.connect(partyA).reportBreach(await partyB.getAddress(), ethers.parseEther("0.05"), clauseHash);
    await nda.connect(partyA).voteOnBreach(0, true);

    // כבר הוחלו קנסות והמחויבויות הסתיימו - כעת ננטרל את החוזה (admin = deployer)
    // ה־deployer הוא admin; ה־deployer בפריסה שלנו הוא כתובת deployer (הראשון ב-getSigners)
    // בקונסטרקטור admin שווה ל-msg.sender של הפריסה - בפריסה שלנו זה 'deployer'.
    await nda.connect(deployer).deactivate("end");

    // ודא שניתן למשוך (canWithdraw)
    expect(await nda.canWithdraw()).to.equal(true);

    const beforeBalance = await ethers.provider.getBalance(await partyA.getAddress());
    // משיכה של סכום קטן
    const tx = await nda.connect(partyA).withdrawDeposit(ethers.parseEther("0.05"));
    await tx.wait();

    // deposits ירד
    const rem = await nda.deposits(await partyA.getAddress());
    expect(rem).to.equal(ethers.parseEther("0.2") - ethers.parseEther("0.05"));
  });
});




