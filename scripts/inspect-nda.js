#!/usr/bin/env node
// Quick inspection script for an NDA contract created by the factory.
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { JsonRpcProvider, Contract } from 'ethers';

async function main() {
  const rpc = process.argv[2] || 'http://127.0.0.1:8545';
  const jf = JSON.parse(await fs.readFile(path.join(process.cwd(),'front','public','utils','contracts','ContractFactory.json'),'utf8'));
  const factoryAddr = jf.contracts.ContractFactory;
  const provider = new JsonRpcProvider(rpc);
  const factory = new Contract(factoryAddr, ['function getContractsByCreator(address) view returns (address[])','function getAllContracts() view returns (address[])'], provider);
  const accounts = await provider.listAccounts();
  const creator = accounts[0];
  console.log('Using creator', creator);
  const created = await factory.getContractsByCreator(creator);
  console.log('Created contracts by creator:', created);
  if (!created || created.length === 0) {
    console.error('No created contracts found');
    return;
  }
  const ndaAddr = created[0];
  console.log('Inspecting NDA at', ndaAddr);
  const ndaAbi = [
    'function partyA() view returns (address)',
    'function partyB() view returns (address)',
    'function expiryDate() view returns (uint256)',
    'function penaltyBps() view returns (uint16)',
    'function minDeposit() view returns (uint256)',
    'function active() view returns (bool)',
    'function getContractStatus() view returns (bool,uint256,uint256,uint256)',
    'function getCasesCount() view returns (uint256)',
    'function getCase(uint256) view returns (address,address,uint256,string,bool,bool,uint256,uint256)'
  ];
  const nda = new Contract(ndaAddr, ndaAbi, provider);
  try {
    const partyA = await nda.partyA();
    const partyB = await nda.partyB();
    const expiry = await nda.expiryDate();
    const penalty = await nda.penaltyBps();
    const minDep = await nda.minDeposit();
    const active = await nda.active();
    console.log({ partyA, partyB, expiry: expiry.toString(), penalty: Number(penalty), minDep: minDep.toString(), active });
  } catch (e) { console.error('Basic getters failed', e); }
  try {
    const status = await nda.getContractStatus();
    console.log('status raw:', status);
  } catch (e) { console.error('getContractStatus failed', e); }
  try {
    const cnt = await nda.getCasesCount();
    console.log('cases count', cnt.toString());
    for (let i=0;i<Number(cnt);i++){
      try{ const c = await nda.getCase(i); console.log('case',i,c); }catch(e){ console.error('getCase',i,'failed',e); }
    }
  } catch (e) { console.error('cases read failed', e); }
}

main().catch(e=>{ console.error('fatal', e); process.exit(1); });
