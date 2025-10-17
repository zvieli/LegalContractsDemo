const { ethers } = require("hardhat");

async function main() {
  // כתובת החוזה לבדיקה
  const contractAddress = "0xb75e2Cd72378873876bffB5F2062825bA8065E31";
  // כתובת החותם (החלף לפי הצורך)
  const signer = await ethers.getSigner("0x90F79bf6EB2c4f870365E785982E1f101E93b906");

  // טען את החוזה
  const contract = await ethers.getContractAt("EnhancedRentContract", contractAddress, signer);

  // דיאגנוסטיקה: הדפס את כל המאפיינים של contract
  console.log("\n--- contract properties ---");
  console.log(Object.keys(contract));

  // בדוק אם contract.interface קיים
  if (!contract.interface) {
    console.error("contract.interface is undefined!");
    return;
  }

  // דיאגנוסטיקה: הדפס את כל המאפיינים של contract.interface
  console.log("\n--- contract.interface properties ---");
  console.log(Object.keys(contract.interface));

  // בדוק אם fragments קיים
  if (!contract.interface.fragments) {
    console.error("contract.interface.fragments is undefined!");
    return;
  }

  // הדפס את כל החתימות של הפונקציות מה-ABI
  console.log("\nContract ABI function signatures:");
  contract.interface.fragments
    .filter(f => f.type === 'function')
    .forEach(f => {
      console.log(f.format());
    });

  // קריאות דמו לפונקציות מרכזיות מהחוזה האב (TemplateRentContract)
  console.log("\n--- Demo calls to TemplateRentContract functions via EnhancedRentContract ---");

  // 1. בדיקת סטטוס חתימה
  try {
    const isSigned = await contract.isFullySigned();
    console.log("isFullySigned:", isSigned);
  } catch (err) {
    console.error("isFullySigned failed:", err.message || err);
  }

  // 2. קריאה לפונקציה hashMessage (view)
  try {
    const hash = await contract.hashMessage();
    console.log("hashMessage:", hash);
  } catch (err) {
    console.error("hashMessage failed:", err.message || err);
  }

  // 3. קריאה לפונקציה getDisputesCount (view)
  try {
    const count = await contract.getDisputesCount();
    console.log("getDisputesCount:", count.toString());
  } catch (err) {
    console.error("getDisputesCount failed:", err.message || err);
  }

  // 4. קריאה לפונקציה payRent (טרנזקציה דמה, תיכשל כי אין חתימה/הרשאות)
  try {
    const tx = await contract.payRent(1);
    console.log("payRent tx sent:", tx.hash);
    const receipt = await tx.wait();
    console.log("payRent tx mined, status:", receipt.status);
  } catch (err) {
    console.error("payRent call failed (צפוי):", err.message || err);
  }

  // 5. קריאה לפונקציה withdrawPayments (טרנזקציה דמה)
  try {
    const tx = await contract.withdrawPayments();
    console.log("withdrawPayments tx sent:", tx.hash);
    const receipt = await tx.wait();
    console.log("withdrawPayments tx mined, status:", receipt.status);
  } catch (err) {
    console.error("withdrawPayments call failed (צפוי):", err.message || err);
  }

  // 6. קריאה לפונקציה reportDispute (טרנזקציה דמה)
  try {
    const tx = await contract.reportDispute(0, 1, "test");
    console.log("reportDispute tx sent:", tx.hash);
    const receipt = await tx.wait();
    console.log("reportDispute tx mined, status:", receipt.status);
  } catch (err) {
    console.error("reportDispute call failed (צפוי):", err.message || err);
  }

  // 7. קריאה לפונקציה resolveDisputeFinal (טרנזקציה דמה)
  try {
    const tx = await contract.resolveDisputeFinal(0, true, 1, signer.address, "class", "rationale");
    console.log("resolveDisputeFinal tx sent:", tx.hash);
    const receipt = await tx.wait();
    console.log("resolveDisputeFinal tx mined, status:", receipt.status);
  } catch (err) {
    console.error("resolveDisputeFinal call failed (צפוי):", err.message || err);
  }

  // 8. קריאה לפונקציה signRent (טרנזקציה דמה)
  try {
    const dummySignature = "0x" + "0".repeat(130);
    const tx = await contract.signRent(dummySignature);
    console.log("signRent tx sent:", tx.hash);
    const receipt = await tx.wait();
    console.log("signRent tx mined, status:", receipt.status);
  } catch (err) {
    console.error("signRent call failed (צפוי):", err.message || err);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
