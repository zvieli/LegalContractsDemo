#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { ethers } from 'ethers';

async function main(){
  const root = process.cwd();
  const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  // listAccounts is reliable for the local Hardhat node; use addresses from it
  // Use provider.listAccounts to get two different unlocked signers from Hardhat node
  const accounts = await provider.listAccounts();
  if(!accounts || accounts.length < 2) throw new Error('Need at least 2 unlocked accounts on the local node');
  // Coerce account items to strings (some providers may return objects)
  const landlordAddress = typeof accounts[0] === 'string' ? accounts[0] : (accounts[0]?.address || String(accounts[0]));
  const tenantAddress = typeof accounts[1] === 'string' ? accounts[1] : (accounts[1]?.address || String(accounts[1]));
  if(String(landlordAddress).toLowerCase() === String(tenantAddress).toLowerCase()) throw new Error('Landlord and tenant addresses are identical; need two different accounts');
  const signerLandlord = provider.getSigner(landlordAddress);
  const signerTenant = provider.getSigner(tenantAddress);

  const mockContractsPath = path.join(root, 'legal-contracts-frontend','src','utils','contracts','MockContracts.json');
  const factoryJsonPath = path.join(root, 'legal-contracts-frontend','src','utils','contracts','ContractFactory.json');
  const factoryAbiPath = path.join(root, 'legal-contracts-frontend','src','utils','contracts','ContractFactoryABI.json');
  const templateAbiPath = path.join(root, 'artifacts','contracts','Rent','TemplateRentContract.sol','TemplateRentContract.json');
  const mockERC20ArtifactPath = path.join(root, 'artifacts','contracts','Rent','MockERC20.sol','MockERC20.json');

  const [mockContractsRaw, factoryJsonRaw, factoryAbiRaw, templateAbiRaw, mockERC20Raw] = await Promise.all([
    fs.readFile(mockContractsPath, 'utf8'),
    fs.readFile(factoryJsonPath, 'utf8'),
    fs.readFile(factoryAbiPath, 'utf8'),
    fs.readFile(templateAbiPath, 'utf8'),
    fs.readFile(mockERC20ArtifactPath, 'utf8')
  ]);

  const mockContracts = JSON.parse(mockContractsRaw);
  const factoryJson = JSON.parse(factoryJsonRaw);
  const factoryAbi = JSON.parse(factoryAbiRaw).abi;
  const templateAbi = JSON.parse(templateAbiRaw).abi;
  const mockERC20Abi = JSON.parse(mockERC20Raw).abi;

  const factoryAddress = factoryJson.contracts?.ContractFactory || mockContracts.contracts?.ContractFactory;
  if(!factoryAddress) throw new Error('ContractFactory address not found in frontend JSONs');

  console.log('Using Factory at', factoryAddress);

  // We'll encode function calls and send raw eth_sendTransaction via the provider
  const factoryIface = new ethers.Interface(factoryAbi);
  const rentAmount = ethers.parseEther('0.01'); // rent amount (in wei) used as example
  const priceFeed = mockContracts.contracts?.MockPriceFeed;
  if(!priceFeed) throw new Error('MockPriceFeed address not found in MockContracts.json');

  console.log('Creating rent contract via factory: landlord=', landlordAddress, 'tenant=', tenantAddress, 'rentAmount=', rentAmount.toString(), 'priceFeed=', priceFeed);

  const createData = factoryIface.encodeFunctionData('createRentContract', [tenantAddress, rentAmount, priceFeed]);
  const txHash = await provider.send('eth_sendTransaction', [{ from: landlordAddress, to: factoryAddress, data: createData }]);
  console.log('createRentContract tx hash:', txHash);
  const receipt = await provider.waitForTransaction(txHash);
  console.log('createRentContract mined, status=', receipt.status);

  // parse event to find created address
  const iface = new ethers.Interface(factoryAbi);
  let createdAddress = null;
  for(const log of receipt.logs){
    try{
      const parsed = iface.parseLog(log);
      if(parsed && parsed.name === 'RentContractCreated'){
        // event RentContractCreated(address contractAddress, address landlord, address tenant)
        createdAddress = parsed.args[0] || parsed.args.contractAddress;
        break;
      }
    }catch(e){ /* ignore */ }
  }

  if(!createdAddress){
    console.error('RentContractCreated event not found in receipt logs. Full logs:');
    console.error(receipt.logs);
    process.exit(1);
  }

  console.log('Created rent contract at', createdAddress);

  // Approve MockERC20 from tenant to allow rent contract to transfer tokens
  const mockERC20Address = mockContracts.contracts?.MockERC20;
  if(!mockERC20Address) throw new Error('MockERC20 address not found in MockContracts.json');

  // Ensure tenant has tokens: transfer some from landlord/deployer to tenant, then approve
  const token = new ethers.Contract(mockERC20Address, mockERC20Abi, provider);
  const tokenIface = new ethers.Interface(mockERC20Abi);
  const decimals = await token.decimals();
  const transferAmount = ethers.parseUnits('1000', Number(decimals));
  const transferData = tokenIface.encodeFunctionData('transfer', [tenantAddress, transferAmount]);
  console.log('Transferring', transferAmount.toString(), 'tokens from landlord', landlordAddress, 'to tenant', tenantAddress);
  const transferTxHash = await provider.send('eth_sendTransaction', [{ from: landlordAddress, to: mockERC20Address, data: transferData }]);
  console.log('transfer tx hash:', transferTxHash);
  await provider.waitForTransaction(transferTxHash);
  console.log('transfer mined');

  const approveAmount = ethers.parseUnits('1000', Number(decimals));
  const approveData = tokenIface.encodeFunctionData('approve', [createdAddress, approveAmount]);
  console.log('Tenant approving', approveAmount.toString(), 'tokens to spender', createdAddress);
  const approveTxHash = await provider.send('eth_sendTransaction', [{ from: tenantAddress, to: mockERC20Address, data: approveData }]);
  console.log('approve tx hash:', approveTxHash);
  await provider.waitForTransaction(approveTxHash);
  console.log('approve mined');

  // Pay rent with token: call payRentWithToken on the created rent contract as tenant
  const rentIface = new ethers.Interface(templateAbi);
  const payAmount = ethers.parseUnits('10', Number(decimals));
  const payData = rentIface.encodeFunctionData('payRentWithToken', [mockERC20Address, payAmount]);
  console.log('Calling payRentWithToken(', mockERC20Address, ',', payAmount.toString(), ') from tenant');
  const payTxHash = await provider.send('eth_sendTransaction', [{ from: tenantAddress, to: createdAddress, data: payData }]);
  console.log('pay tx hash:', payTxHash);
  const payReceipt = await provider.waitForTransaction(payTxHash);
  console.log('payRentWithToken mined, status=', payReceipt.status);

  // Check balances
  const landlordAddr = landlordAddress;
  const tenantBalance = await token.balanceOf(tenantAddress);
  const landlordBalance = await token.balanceOf(landlordAddr);

  console.log('Final tenant token balance:', tenantBalance.toString());
  console.log('Final landlord token balance:', landlordBalance.toString());

  console.log('\nE2E flow completed.');
}

main().catch(err=>{console.error('Error in e2e_flow:', err); process.exit(1);});
