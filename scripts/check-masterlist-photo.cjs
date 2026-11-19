// Setup: npm install --prefix .ocr-test --no-save --package-lock=false @napi-rs/canvas
// Run: node scripts/check-masterlist-photo.cjs "path/to/Nov-14-AMBIE.jpeg"
// Exercises real OCR locally; does not upload the image or write business records.
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),ts=require('typescript'),Module=require('module');
const root=path.resolve(__dirname,'..');
const realT=require('tesseract.js'); let worker;
const canvas=require('../.ocr-test/node_modules/@napi-rs/canvas');
global.document={createElement:()=>canvas.createCanvas(1,1)};
global.createImageBitmap=async file=>canvas.loadImage(Buffer.from(await file.arrayBuffer()));
global.ImageData=canvas.ImageData;
Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>null,setItem(){},removeItem(){}},configurable:true});
const load=Module._load;
Module._load=function(name,...args){
 if(name==='./tenancy'||name==='@/lib/tenancy')return {getMyContext:async()=>({activeTenant:{tenantId:'crown-ab12',displayName:'Crown'}})};
 if(name==='tesseract.js')return {createWorker:async()=>{
   worker=await realT.createWorker('eng',1,{langPath:path.join(root,'public/ocr'),gzip:true,cacheMethod:'none'});
   return {setParameters:(...a)=>worker.setParameters(...a),recognize:(c,...a)=>worker.recognize(c.toBuffer('image/png'),...a)};
 }};
 return load.call(this,name,...args);
};
const resolve=Module._resolveFilename;
Module._resolveFilename=function(name,...a){return resolve.call(this,name.startsWith('@/')?path.join(root,name.slice(2)):name,...a)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
(async()=>{
const {DEFAULT_MASTERLIST_MAPPING}=require('../lib/masterlistMapping.ts');
const m={...DEFAULT_MASTERLIST_MAPPING,priceMode:'rate_plus_mc',dataStartRow:6,rateCell:'F4',liverCell:'A1',columns:{...DEFAULT_MASTERLIST_MAPPING.columns,mc:'Q',goldRate:'R'}};
if(!process.argv[2])throw Error('Pass the path to the Nov 14 AMBIE source photo.');
const data=fs.readFileSync(process.argv[2]);
const result=await require('../lib/masterlistOcr.ts').parseMasterlistImage({arrayBuffer:async()=>data},m,[],true);
assert.equal(result.rows.length,13);
for(const [code,grams,gold,mc,rate,amount,category] of [
 ['AMB06','0.62','357','30','387',239.94,'Special Price'],
 ['AMB07','1.6','357','25','382',611.2,'Gold Normal'],
 ['AMB08','1.43','357','23','380',543.4,'Gold Normal'],
 ['AMB13','1','468','30','498',498,'Special Price'],
]) {
 const row=result.rows.find(r=>r.orderId===code);assert.ok(row,code);
 assert.deepEqual([row.grams,row.goldRate,row.mc,row.clientRate,row.sourceAmount,row.category],[grams,gold,mc,rate,amount,category],code);
}
console.log('Actual JPEG OCR regression passed: 13 rows; Janine MC 30/23, rates 387/380, amounts 239.94/543.40; gold bar rate 468.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(worker)await worker.terminate()});
