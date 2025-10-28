#!/usr/bin/env node
import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';

async function main(){
  console.log('Creating helia...');
  const helia = await createHelia();
  console.log('Helia created');
  const u = await unixfs(helia);
  console.log('unixfs factory called. Type of u:', typeof u);
  console.log('unixfs keys:', Object.keys(u).join(', '));
  console.log('types: add', typeof u.add, 'addAll', typeof u.addAll, 'write', typeof u.write, 'cat', typeof u.cat);
  try{
    if(typeof u.add==='function'){
      console.log('Trying u.add...');
      const res = await u.add({ path: 'test.txt', content: Buffer.from('hello') });
      console.log('add result keys:', Object.keys(res));
      console.log('add result cid:', res.cid && res.cid.toString && res.cid.toString());
    } else if(typeof u.addAll === 'function'){
      console.log('Trying u.addAll...');
      const res = await u.addAll([{ path:'test.txt', content: Buffer.from('hello') }]);
      console.log('addAll result type:', typeof res);
      if(Array.isArray(res)) console.log('addAll last cid:', res[res.length-1].cid && res[res.length-1].cid.toString && res[res.length-1].cid.toString());
      else console.log('addAll result keys', Object.keys(res));
    } else if(typeof u.write === 'function'){
      console.log('Trying u.write...');
      const cid = await u.write('test.txt', Buffer.from('hello'));
      console.log('write cid:', cid && cid.toString && cid.toString());
    } else {
      console.log('No add/addAll/write available');
    }
  }catch(e){
    console.error('Error calling unixfs API:', e && e.message ? e.message : e);
  }
  try{
    console.log('Trying cat api...');
    if(typeof u.cat === 'function'){
      console.log('u.cat exists');
    }
  }catch(e){}
  process.exit(0);
}

main().catch(e=>{ console.error(e); process.exit(2); });
