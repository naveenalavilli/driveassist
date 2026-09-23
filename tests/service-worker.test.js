'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function worker() {
  const scope = 'https://example.com/driveassist/';
  const cacheData = new Map();
  const listeners = {};
  const network = [];
  const absolute = (request) => new URL(typeof request === 'string' ? request : request.url, scope).href;
  const caches = {
    keys: async () => [...cacheData.keys()],
    delete: async (key) => cacheData.delete(key),
    open: async (name) => {
      if (!cacheData.has(name)) cacheData.set(name,new Map());
      const entries = cacheData.get(name);
      return {
        addAll: async (requests) => requests.forEach(request=>entries.set(absolute(request),new Response('installed shell'))),
        put: async (request,response) => entries.set(absolute(request),response),
        match: async (request,options={}) => {
          let url=absolute(request);
          if (options.ignoreSearch) url=url.split('?')[0];
          return entries.get(url)?.clone();
        },
      };
    },
  };
  const sandbox = {
    self:{registration:{scope},location:{origin:'https://example.com'},clients:{claim:async()=>{}},
      addEventListener:(type,handler)=>{listeners[type]=handler}},
    caches, URL, Response, AbortController, setTimeout, clearTimeout,
    Request:class {constructor(url){this.url=absolute(url)}},
    fetch:async(request)=>{network.push(absolute(request));return new Response('new server content')},
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'),sandbox);
  const run=code=>vm.runInContext(code,sandbox);
  return {run,caches,cacheData,network,listeners,async dispatch(type,extras={}){
    const waits=[];let response;
    listeners[type]({...extras,waitUntil:p=>waits.push(p),respondWith:p=>{response=p}});
    const result=await response;await Promise.all(waits);return result;
  }};
}

test('shell installation does not depend on external model downloads', async () => {
  const w=worker();await w.dispatch('install');
  assert.equal(w.network.length,0);
  assert.ok(w.cacheData.get(w.run('VERSION')).size>10);
});

test('navigation serves the installed shell consistently even with query parameters', async () => {
  const w=worker();await w.dispatch('install');
  const response=await w.dispatch('fetch',{request:{url:'https://example.com/driveassist/?source=home',method:'GET',mode:'navigate'}});
  assert.equal(await response.text(),'installed shell');
  assert.equal(w.network.length,0);
});

test('activation preserves model assets and other apps sharing the origin', async () => {
  const w=worker();
  const old=w.run('CACHE_PREFIX')+'shell-old';
  for(const key of [old,w.run('ASSET_CACHE'),'driveassist:https://example.com/other/:shell-v1']) await w.caches.open(key);
  await w.dispatch('activate');
  assert.equal(w.cacheData.has(old),false);
  assert.equal(w.cacheData.has(w.run('ASSET_CACHE')),true);
  assert.equal(w.cacheData.has('driveassist:https://example.com/other/:shell-v1'),true);
});

test('a failed navigation does not overwrite the offline shell', async () => {
  const w=worker();await w.dispatch('install');
  w.run("fetch=async()=>{throw new Error('offline')}");
  const response=await w.dispatch('fetch',{request:{url:'https://example.com/driveassist/unknown',method:'GET',mode:'navigate'}});
  assert.equal(await response.text(),'installed shell');
});

test('storage failures do not break an otherwise successful model response', async () => {
  const w=worker();
  w.run("const originalOpen=caches.open; caches.open=async(name)=>({...await originalOpen(name),put:async()=>{throw new Error('quota')}})");
  const response=await w.dispatch('fetch',{request:{url:'https://cdn.jsdelivr.net/model.bin',method:'GET',mode:'cors'}});
  assert.equal(await response.text(),'new server content');
});
