import { Worker } from 'node:worker_threads';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const entry=(await readdir('dist/assets')).find(name=>/^export\.worker-.*\.js$/.test(name));
if(!entry)throw new Error('Build the frontend before verifying the export worker.');
const workerUrl=pathToFileURL(resolve('dist/assets',entry)).href;
// Execute the production browser-worker bundle with a worker_threads messaging shim.
// This verifies the bundle and PDF result, not browser CSP or browser rendering.
const worker=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:(value,options)=>parentPort.postMessage(value,options?.transfer)};import(${JSON.stringify(workerUrl)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});}).catch(error=>{throw error;});`,{eval:true});
const doc=await PDFDocument.create();doc.addPage([595,842]);const original=await doc.save();
const edit={id:'worker-test',page:1,kind:'text',matrix:[1,0,0,1,50,700],text:'Worker export verified',size:14,width:200,height:20,color:'#202824',background:'#ffffff',family:'Helvetica',bold:false,italic:false};
await new Promise((resolve,reject)=>{
 const timeout=setTimeout(()=>{worker.terminate();reject(new Error('Export worker timed out.'));},15000);
 worker.on('error',error=>{clearTimeout(timeout);reject(error);});
 worker.on('message',async result=>{
  if(result.ready){const copy=original.slice();worker.postMessage({bytes:copy,edits:[edit]},[copy.buffer]);return;}
  clearTimeout(timeout);
  try{if(result.error)throw new Error(result.error);const pdf=await PDFDocument.load(result.bytes);if(pdf.getPageCount()!==1)throw new Error('Wrong page count');await worker.terminate();console.log('Production export worker passed: transferable PDF input, successful real PDF output.');resolve();}catch(error){await worker.terminate();reject(error);}
 });
});
