#!/usr/bin/env node
import fs from 'fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const datasetPath = process.argv[2];
const schemaPath = process.argv[3];
if(!datasetPath||!schemaPath){
  console.error('Usage: validate.js <dataset.jsonl> <schema.json>');
  process.exit(1);
}
const ajv = new Ajv({allErrors:true});
addFormats(ajv); // enable date-time & other formats
const schema = JSON.parse(fs.readFileSync(schemaPath,'utf8'));
const validate = ajv.compile(schema);
const lines = fs.readFileSync(datasetPath,'utf8').trim().split(/\r?\n/);
let ok = 0, fail = 0;
for(let i=0;i<lines.length;i++){
  const raw = lines[i].trim();
  if(!raw) continue;
  let obj;
  try { obj = JSON.parse(raw); } catch(e){
    fail++;
    console.error('Line', i+1, 'JSON parse error:', e.message);
    continue;
  }
  if(validate(obj)) {
    ok++;
  } else {
    fail++;
    console.error('Line', i+1, 'schema errors:', validate.errors?.map(er=>`${er.instancePath} ${er.message}`).join('; '));
  }
}
console.log('Validated', ok, 'records; failed', fail);
if(fail>0) process.exit(1);
