// Integration checks use in-memory sheets; no real data is written.
require('./check-accounts-ledger.cjs');
const assert=require('node:assert/strict');
const Module=require('node:module');
const {allocatePayment,attachShipmentPayments,paymentFingerprint}=require('../lib/shipmentPayments.ts');
const {calcTotalPaid}=require('../lib/calculations.ts');
const {buildAccounts}=require('../lib/accountsLedger.ts');
const {planSplitPayments}=require('../lib/splitPayments.ts');
const base={minerName:'Customer',customerId:'C1',status:'Dispatched',shipmentId:'s1',dispatchDate:'2026-11-01',dateOfLive:'2026-10-01',currency:'AED',modeOfPayment:'Bank Transfer AED',grams:1,clientRate:100,freeSf:'TRUE'};
let records=[{...base,id:2,rowKey:'key-a',itemDescription:'Ring'},{...base,id:3,rowKey:'key-b',itemDescription:'Chain'}];
let stored=[],writes=0,authorized=true,loseAcknowledgement=false,keyWrites=0;
const load=Module._load;
Module._load=function(name,...args){
 if(name==='server-only')return {};
 if(name==='./authz')return {requireRole:async()=>{if(!authorized)throw Error('Forbidden');return 'staff@example.test'}};
 if(name==='./recordStore')return {
   readDatabase:async()=>({records:records.map(r=>({...r})),headers:new Set(),aliases:{}}),
   newRowKey:()=>`generated-${++keyWrites}`,
   ensureOptionalColumns:async()=>{},
   writeRowsByCells:async(_,updates)=>{for(const u of updates){records.find(r=>r.id===u.rowNumber).rowKey=u.patch['Row Key'];}return updates.length},
 };
 if(name==='./shipmentPaymentStore')return {readShipmentPayments:async()=>stored,PAYMENT_TAB:'Shipment Payments',PAYMENT_HEADERS:['Payment ID','Payment JSON']};
 if(name==='./appTabs')return {getAppTab:async()=>({addRow:async row=>{writes++;stored.push(JSON.parse(row['Payment JSON']));if(loseAcknowledgement){loseAcknowledgement=false;throw Error('Connection interrupted after save')}}})};
 if(name==='./row-mapper')return {databaseRecordToRow:r=>r};
 return load.call(this,name,...args);
};
const {addShipmentPayment}=require('../lib/google-sheets/shipmentPayments.ts');
const make=(id,extra={})=>({id,accountKey:'customer:C1',batchKey:'s1',scope:'shipment',amountAED:200.01,date:'2026-11-05',method:'Bank transfer',reference:'ref',items:records.map(r=>({id:r.id,rowKey:r.rowKey,fingerprint:paymentFingerprint(r)})),...extra});
(async()=>{
 const input=make('11111111-1111-4111-8111-111111111111');
 const p=await addShipmentPayment(input);
 assert.equal(writes,1);assert.equal(p.allocations.reduce((s,a)=>s+Math.round(a.amountAED*100),0),20001);
 assert.equal(records[0].downpayment,undefined);
 await addShipmentPayment(input);assert.equal(writes,1,'retry cannot append another payment');
 await assert.rejects(()=>addShipmentPayment({...input,amountAED:201}),/different details/);
 const projected=attachShipmentPayments(records,[p,p]);
 assert.equal(projected.reduce((s,r)=>s+calcTotalPaid(r),0),200.01,'repeated ledger IDs count once');
 assert.equal(buildAccounts(projected)[0].credit,0.01,'charges must not subtract virtual payments twice');
 assert.equal(attachShipmentPayments(projected,[p])[0].shipmentPaymentAED,projected[0].shipmentPaymentAED,'projection is idempotent');
 const selected=make('22222222-2222-4222-8222-222222222222',{scope:'items',amountAED:50,items:[input.items[1]]});
 const second=await addShipmentPayment(selected);assert.equal(second.allocations.length,1);assert.equal(second.allocations[0].rowKey,'key-b');
 const legacy=attachShipmentPayments([{...records[0],downpayment:'20'},records[1]],[p,second]);
 assert.equal(Math.round(legacy.reduce((s,r)=>s+calcTotalPaid(r),0)*100),27001,'legacy and new payments added once');
 const split=planSplitPayments({...projected[0],downpayment:'20',grams:2},1,'active');
 assert.ok(Number(split.child.downpayment||0)<=20,'virtual payment never copied to editable fields by splitting');
 await assert.rejects(()=>addShipmentPayment(make('33333333-3333-4333-8333-333333333333',{items:[input.items[0]]})),/shipment items changed/);
 await assert.rejects(()=>addShipmentPayment(make('44444444-4444-4444-8444-444444444444',{accountKey:'customer:other'})),/Customer changed/);
 await assert.rejects(()=>addShipmentPayment(make('55555555-5555-4555-8555-555555555555',{amountAED:-1})),/Check the payment/);
 const original=records[0];records[0]={...original,status:'Cancelled'};
 await assert.rejects(()=>addShipmentPayment(make('66666666-6666-4666-8666-666666666666')),/Selected items changed/);records[0]=original;
 authorized=false;await assert.rejects(()=>addShipmentPayment(input),/Forbidden/);authorized=true;
 assert.throws(()=>attachShipmentPayments([records[0],{...records[0],id:9}],[p]),/duplicate Row Keys/);
 assert.throws(()=>allocatePayment(10,[]),/Invalid payment/);
 const retry=make('77777777-7777-4777-8777-777777777777');
 loseAcknowledgement=true;
 await assert.rejects(()=>addShipmentPayment(retry),/Connection interrupted/);
 const afterFailure=writes;
 await addShipmentPayment(retry);assert.equal(writes,afterFailure,'lost acknowledgement retry must not duplicate saved money');
 records=records.map(r=>({...r,rowKey:''}));
 const oldRows=make('88888888-8888-4888-8888-888888888888');
 const backfilled=await addShipmentPayment(oldRows);
 assert.equal(keyWrites,2);assert.ok(backfilled.allocations.every(a=>a.rowKey.startsWith('generated-')));
 await addShipmentPayment(oldRows);assert.equal(keyWrites,2,'retry after backfill retains original payment identity');
 console.log('Shipment payment integration checks passed: persistence, retry, scope, cents, legacy totals, splits, stale records, authorization.');
})().catch(e=>{console.error(e);process.exitCode=1});
