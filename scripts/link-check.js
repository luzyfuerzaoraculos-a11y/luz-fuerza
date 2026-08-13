const fs = require('fs');
const http = require('http');
const path = require('path');
const index = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const hrefs = Array.from(index.matchAll(/(?:href|src)="([^"]+)"/g)).map(m=>m[1]);
const internal = hrefs.filter(u=>!/^([a-z]+:|#)/i.test(u));
const unique = [...new Set(internal)];
const base = 'http://localhost:3000';
(async ()=>{
  for(const u of unique){
    const url = u.startsWith('/')? base+u : base+'/'+u.replace(/^\/?/,'');
    await new Promise((res)=>{
      const req = http.request(url, {method:'HEAD'}, (r)=>{
        console.log(r.statusCode, url);
        res();
      });
      req.on('error', (e)=>{ console.log('ERR', url, e.message); res(); });
      req.end();
    });
  }
})();
