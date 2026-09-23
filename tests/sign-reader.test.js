'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const Core = require('../drive-core');

function readerHarness() {
  const crops = [];
  const pixels = new Uint8ClampedArray(320 * 180 * 4);
  for (const left of [20,200]) for (let y=20;y<80;y++) for (let x=left;x<left+40;x++) {
    pixels.fill(240,(y*320+x)*4,(y*320+x)*4+4);
  }
  let canvasCount=0;
  const sandbox = {setTimeout,clearTimeout,window:{DriveAssistCore:Core},document:{createElement(){
    const id=canvasCount++;
    return {width:0,height:0,getContext:()=>({
      drawImage(...args){if(id===2)crops.push(args)},
      getImageData:()=>({width:320,height:180,data:pixels}),
    })};
  }}};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../sign-reader'),'utf8'),sandbox);
  return {crops,root:sandbox.window,reader:new sandbox.window.DriveAssistSignReader()};
}

test('OCR crops stay tied to the snapshot when camera dimensions change mid-read', async () => {
  const {reader,crops}=readerHarness();
  const video={videoWidth:1280,videoHeight:720};
  reader.ready=true;
  reader.worker={recognize:async()=>{video.videoWidth=640;video.videoHeight=480;return {data:{text:'STOP',confidence:90}}}};
  await reader.read(video);
  assert.equal(crops.length,2);
  assert.equal(crops[0][3],crops[1][3]);
  assert.ok(crops[1][1]>700,'second crop must still use the 1280px snapshot');
});

test('closing during initialization terminates the late worker and releases canvases', async () => {
  const {reader,root}=readerHarness();let finish;let terminated=0;
  root.Tesseract={createWorker:()=>new Promise(resolve=>{finish=resolve})};
  const pending=reader.initialize();reader.close();
  finish({terminate:async()=>{terminated++}});
  await pending;
  assert.equal(terminated,1);
  assert.equal(reader.ready,false);
  assert.equal(reader.worker,null);
  assert.equal(reader.snapshot.width,0);
});
