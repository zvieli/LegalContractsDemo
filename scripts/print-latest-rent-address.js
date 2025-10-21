import hre from 'hardhat';
const { ethers } = hre;

async function main() {
  // חפש את כל הכתובות של EnhancedRentContract בפריסה האחרונה
  const deployments = await ethers.getContractFactory("EnhancedRentContract");
  // נסה למצוא את כל הכתובות מה-artifacts (אם יש)
  // אם אתה משתמש ב-hardhat-deploy, אפשר גם לטעון דרך deployments.getAll()
  // כאן ננסה פשוט להדפיס דוגמה לטעינה ידנית
  console.log("אם אתה משתמש ב-hardhat-deploy, נסה: npx hardhat deployments --network localhost");
  console.log("אם יש לך קובץ כתובות/פריסה, פתח אותו והעתק את הכתובת העדכנית.");
}

main().catch(console.error);
